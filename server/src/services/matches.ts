import { and, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../db/index.js';
import { matches, matchParticipants, matchScores, rankings, ratingHistory } from '../db/schema.js';
import { eloDelta, START_RATING } from './rating.js';
import type { Game, Side } from './scoring.js';
import { onTournamentMatchDecided } from './tournament.js';
import { notify } from '../lib/audit.js';

type Match = typeof matches.$inferSelect;

async function ratingOf(tx: Tx, userId: string, format: 'SINGLES' | 'DOUBLES') {
  const [r] = await tx.insert(rankings).values({ userId, format, rating: START_RATING }).onConflictDoNothing().returning();
  if (r) return r;
  const [e] = await tx.select().from(rankings).where(and(eq(rankings.userId, userId), eq(rankings.format, format))).for('update');
  return e;
}

/** Apply Elo once for a completed competitive match. */
export async function applyRatings(tx: Tx, m: Match, winnerSide: Side) {
  if (m.category !== 'COMPETITIVE' || m.ratingApplied) return;
  const ps = await tx.select().from(matchParticipants).where(eq(matchParticipants.matchId, m.id));
  const side = (s: number) => ps.filter((p) => p.side === s).map((p) => p.userId);
  const a = await Promise.all(side(1).map((u) => ratingOf(tx, u, m.format)));
  const b = await Promise.all(side(2).map((u) => ratingOf(tx, u, m.format)));
  const d = eloDelta(a.map((x) => x.rating), b.map((x) => x.rating), winnerSide === 1);
  for (const [list, delta, won] of [[a, d.a, winnerSide === 1], [b, d.b, winnerSide === 2]] as const) {
    for (const r of list) {
      const rating = r.rating + delta;
      await tx.update(rankings).set({ rating, wins: r.wins + (won ? 1 : 0), losses: r.losses + (won ? 0 : 1) }).where(eq(rankings.id, r.id));
      await tx.insert(ratingHistory).values({ userId: r.userId, matchId: m.id, format: m.format, won, delta, ratingAfter: rating });
    }
  }
  await tx.update(matches).set({ ratingApplied: true }).where(eq(matches.id, m.id));
}

/** Reverse a match's rating changes (used before a score correction). */
export async function reverseRatings(tx: Tx, m: Match) {
  if (!m.ratingApplied) return;
  const hist = await tx.select().from(ratingHistory).where(eq(ratingHistory.matchId, m.id));
  for (const h of hist) {
    const [r] = await tx.select().from(rankings).where(and(eq(rankings.userId, h.userId), eq(rankings.format, h.format))).for('update');
    await tx.update(rankings).set({ rating: r.rating - h.delta, wins: r.wins - (h.won ? 1 : 0), losses: r.losses - (h.won ? 0 : 1) }).where(eq(rankings.id, r.id));
  }
  await tx.delete(ratingHistory).where(eq(ratingHistory.matchId, m.id));
  await tx.update(matches).set({ ratingApplied: false }).where(eq(matches.id, m.id));
}

export async function writeGames(tx: Tx, matchId: string, games: Game[]) {
  await tx.delete(matchScores).where(eq(matchScores.matchId, matchId));
  if (games.length) await tx.insert(matchScores).values(games.map((g, i) => ({ matchId, gameNumber: i + 1, side1Score: g.s1, side2Score: g.s2, winnerSide: g.winner })));
}

/** Mark a match complete, write game scores, update rankings and tournament progression. */
export async function finalizeMatch(tx: Tx, m: Match, winnerSide: Side, games: Game[]) {
  await writeGames(tx, m.id, games);
  const [u] = await tx.update(matches).set({ status: 'COMPLETED', winnerSide }).where(eq(matches.id, m.id)).returning();
  await applyRatings(tx, u, winnerSide);
  await onTournamentMatchDecided(tx, m.id, winnerSide);
  const ps = await tx.select({ userId: matchParticipants.userId }).from(matchParticipants).where(eq(matchParticipants.matchId, m.id));
  const score = games.map((g) => `${g.s1}-${g.s2}`).join(', ');
  await notify(ps.map((p) => p.userId), { type: 'MATCH_RESULT', title: 'Match result posted', body: `Final score: ${score}.`, link: `/app/matches/${m.id}` }, tx);
  void inArray;
}
