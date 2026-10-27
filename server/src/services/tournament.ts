import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../db/index.js';
import { tournaments, tournamentTeams, tournamentBrackets, tournamentMatches, matches, matchParticipants, matchScores, rankings } from '../db/schema.js';
import { singleElimination, roundRobin, snakeGroups, standings, crossSeed, type PlannedMatch } from './bracket.js';
import { badRequest } from '../lib/http.js';
import { notify } from '../lib/audit.js';

type Team = typeof tournamentTeams.$inferSelect;
type T = typeof tournaments.$inferSelect;

async function teamPlayers(tx: Tx, teamId: string) {
  const [t] = await tx.select().from(tournamentTeams).where(eq(tournamentTeams.id, teamId));
  return [t.player1Id, t.player2Id].filter(Boolean) as string[];
}

/** Create the playable Match for a tournament match once both teams are known. */
export async function materialize(tx: Tx, t: T, tmId: string) {
  const [tm] = await tx.select().from(tournamentMatches).where(eq(tournamentMatches.id, tmId));
  if (!tm.team1Id || !tm.team2Id || tm.matchId) return;
  const start = t.startDate > new Date() ? t.startDate : new Date();
  const [m] = await tx.insert(matches).values({ format: t.category, category: 'COMPETITIVE', startAt: start, endAt: new Date(start.getTime() + 3600000), status: 'SCHEDULED', isSample: t.isSample }).returning();
  const p1 = await teamPlayers(tx, tm.team1Id), p2 = await teamPlayers(tx, tm.team2Id);
  await tx.insert(matchParticipants).values([...p1.map((u) => ({ matchId: m.id, userId: u, side: 1 })), ...p2.map((u) => ({ matchId: m.id, userId: u, side: 2 }))]);
  await tx.update(tournamentMatches).set({ matchId: m.id }).where(eq(tournamentMatches.id, tm.id));
  await notify([...p1, ...p2], { type: 'MATCH_SCHEDULED', title: `${t.name}: your next match is set`, body: 'Check the bracket for your opponent. Court and time will be posted by the organisers.', link: `/app/tournaments/${t.id}` }, tx);
}

async function insertBracket(tx: Tx, t: T, name: string, kind: 'ELIMINATION' | 'ROUND_ROBIN', stage: number, plan: PlannedMatch[]) {
  const [b] = await tx.insert(tournamentBrackets).values({ tournamentId: t.id, name, kind, stage }).returning();
  const idByKey = new Map<string, string>();
  // insert from the final round backwards so next-match ids exist
  const ordered = [...plan].sort((a, z) => z.round - a.round || a.position - z.position);
  for (const p of ordered) {
    const next = p.next ? idByKey.get(`${p.next.round}:${p.next.position}`) : undefined;
    const [row] = await tx.insert(tournamentMatches).values({ tournamentId: t.id, bracketId: b.id, round: p.round, position: p.position, team1Id: p.t1, team2Id: p.t2, nextMatchId: next ?? null, nextSlot: p.next?.slot ?? null }).returning();
    idByKey.set(`${p.round}:${p.position}`, row.id);
  }
  // round-1 byes advance immediately; real pairings get playable matches
  const firstRound = await tx.select().from(tournamentMatches).where(and(eq(tournamentMatches.bracketId, b.id), eq(tournamentMatches.round, 1)));
  for (const m of firstRound) {
    if (kind === 'ELIMINATION' && (!m.team1Id || !m.team2Id)) {
      const w = m.team1Id ?? m.team2Id;
      await tx.update(tournamentMatches).set({ isBye: true, winnerTeamId: w }).where(eq(tournamentMatches.id, m.id));
      if (w && m.nextMatchId) await placeInNext(tx, t, m.nextMatchId, m.nextSlot!, w);
    } else await materialize(tx, t, m.id);
  }
  if (kind === 'ROUND_ROBIN') {
    const rest = await tx.select().from(tournamentMatches).where(and(eq(tournamentMatches.bracketId, b.id), sql`${tournamentMatches.round} > 1`));
    for (const m of rest) await materialize(tx, t, m.id);
  }
  return b;
}

async function placeInNext(tx: Tx, t: T, nextId: string, slot: number, teamId: string) {
  await tx.update(tournamentMatches).set(slot === 1 ? { team1Id: teamId } : { team2Id: teamId }).where(eq(tournamentMatches.id, nextId));
  await materialize(tx, t, nextId);
}

/** Seed teams by average all-time rating for the tournament's format. */
async function seededTeams(tx: Tx, t: T): Promise<Team[]> {
  const teams = await tx.select().from(tournamentTeams).where(eq(tournamentTeams.tournamentId, t.id));
  const ids = teams.flatMap((x) => [x.player1Id, x.player2Id]).filter(Boolean) as string[];
  const rs = ids.length ? await tx.select().from(rankings).where(and(inArray(rankings.userId, ids), eq(rankings.format, t.category))) : [];
  const rating = (u: string | null) => (u ? rs.find((r) => r.userId === u)?.rating ?? 1000 : null);
  const score = (x: Team) => { const v = [rating(x.player1Id), rating(x.player2Id)].filter((n): n is number => n !== null); return v.reduce((a, b) => a + b, 0) / v.length; };
  const sorted = teams.sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
  for (const [i, x] of sorted.entries()) await tx.update(tournamentTeams).set({ seed: i + 1 }).where(eq(tournamentTeams.id, x.id));
  return sorted;
}

export async function startTournament(tx: Tx, t: T) {
  if (t.status !== 'OPEN' && t.status !== 'DRAFT') throw badRequest('Only an open tournament can be started');
  if (t.format === 'DOUBLE_ELIMINATION') throw badRequest('Double elimination brackets are not available yet. Change the format to single elimination, round robin or group stage + knockout.');
  const teams = await seededTeams(tx, t);
  if (teams.length < 2) throw badRequest('At least 2 entries are needed to start');
  const ids = teams.map((x) => x.id);
  if (t.format === 'SINGLE_ELIMINATION') await insertBracket(tx, t, 'Main draw', 'ELIMINATION', 1, singleElimination(ids));
  else if (t.format === 'ROUND_ROBIN') await insertBracket(tx, t, 'Round robin', 'ROUND_ROBIN', 1, roundRobin(ids));
  else {
    const g = Math.max(2, Math.min(t.groupCount, Math.floor(teams.length / 2)));
    const groups = snakeGroups(ids, g);
    for (const [i, members] of groups.entries()) {
      const label = String.fromCharCode(65 + i);
      await tx.update(tournamentTeams).set({ groupLabel: label }).where(inArray(tournamentTeams.id, members));
      if (members.length >= 2) await insertBracket(tx, t, `Group ${label}`, 'ROUND_ROBIN', 1, roundRobin(members));
    }
  }
  await tx.update(tournaments).set({ status: 'IN_PROGRESS' }).where(eq(tournaments.id, t.id));
}

async function roundRobinStandings(tx: Tx, bracketId: string) {
  const tms = await tx.select().from(tournamentMatches).where(eq(tournamentMatches.bracketId, bracketId));
  const teamIds = [...new Set(tms.flatMap((m) => [m.team1Id, m.team2Id]).filter(Boolean) as string[])];
  const done = tms.filter((m) => m.winnerTeamId && m.matchId);
  const scores = done.length ? await tx.select().from(matchScores).where(inArray(matchScores.matchId, done.map((m) => m.matchId!))) : [];
  const results = done.map((m) => {
    const g = scores.filter((s) => s.matchId === m.matchId);
    return { t1: m.team1Id!, t2: m.team2Id!, winner: m.winnerTeamId!, p1: g.reduce((a, s) => a + s.side1Score, 0), p2: g.reduce((a, s) => a + s.side2Score, 0) };
  });
  return { table: standings(teamIds, results), complete: tms.every((m) => m.winnerTeamId) };
}
export { roundRobinStandings };

async function complete(tx: Tx, t: T, champion: string) {
  await tx.update(tournaments).set({ status: 'COMPLETED', championTeamId: champion }).where(eq(tournaments.id, t.id));
  const players = await teamPlayers(tx, champion);
  const all = await tx.select({ p1: tournamentTeams.player1Id, p2: tournamentTeams.player2Id }).from(tournamentTeams).where(eq(tournamentTeams.tournamentId, t.id));
  await notify(all.flatMap((x) => [x.p1, x.p2]).filter(Boolean) as string[], { type: 'TOURNAMENT_RESULT', title: `${t.name} is complete`, body: 'Final results and standings are posted.', link: `/app/tournaments/${t.id}` }, tx);
  void players;
}

/** Called when a tournament match's underlying Match completes. */
export async function onTournamentMatchDecided(tx: Tx, matchId: string, winnerSide: 1 | 2) {
  const [tm] = await tx.select().from(tournamentMatches).where(eq(tournamentMatches.matchId, matchId));
  if (!tm) return;
  const [t] = await tx.select().from(tournaments).where(eq(tournaments.id, tm.tournamentId)).for('update');
  const winner = winnerSide === 1 ? tm.team1Id! : tm.team2Id!;
  await tx.update(tournamentMatches).set({ winnerTeamId: winner }).where(eq(tournamentMatches.id, tm.id));
  const [bracket] = await tx.select().from(tournamentBrackets).where(eq(tournamentBrackets.id, tm.bracketId));

  if (bracket.kind === 'ELIMINATION') {
    if (tm.nextMatchId) return placeInNext(tx, t, tm.nextMatchId, tm.nextSlot!, winner);
    return complete(tx, t, winner); // the final has no next match
  }
  // round robin bracket
  if (t.format === 'ROUND_ROBIN') {
    const { table, complete: done } = await roundRobinStandings(tx, bracket.id);
    if (done) await complete(tx, t, table[0].teamId);
    return;
  }
  // group stage: when every group is finished, build the knockout stage
  const groups = await tx.select().from(tournamentBrackets).where(and(eq(tournamentBrackets.tournamentId, t.id), eq(tournamentBrackets.stage, 1)));
  const tables = [];
  for (const g of groups.sort((a, b) => a.name.localeCompare(b.name))) {
    const s = await roundRobinStandings(tx, g.id);
    if (!s.complete) return;
    tables.push(s.table.map((x) => x.teamId));
  }
  const [existing] = await tx.select().from(tournamentBrackets).where(and(eq(tournamentBrackets.tournamentId, t.id), eq(tournamentBrackets.stage, 2)));
  if (existing) return;
  await insertBracket(tx, t, 'Knockout', 'ELIMINATION', 2, singleElimination(crossSeed(tables)));
}

/** Corrections are only safe while the next round hasn't been played. */
export async function assertCorrectable(tx: Tx, matchId: string) {
  const [tm] = await tx.select().from(tournamentMatches).where(eq(tournamentMatches.matchId, matchId));
  if (!tm) return null;
  const [t] = await tx.select().from(tournaments).where(eq(tournaments.id, tm.tournamentId));
  if (t.status === 'COMPLETED') throw badRequest('The tournament is complete; its results are locked.');
  if (tm.nextMatchId) {
    const [next] = await tx.select().from(tournamentMatches).where(eq(tournamentMatches.id, tm.nextMatchId));
    if (next.matchId) {
      const [m] = await tx.select().from(matches).where(eq(matches.id, next.matchId));
      if (m.status !== 'SCHEDULED') throw badRequest('The next-round match has already started, so this result can no longer change.');
    }
  }
  return tm;
}

/** Undo a decided tournament match's progression so a corrected result can be applied. */
export async function rollbackProgression(tx: Tx, matchId: string) {
  const [tm] = await tx.select().from(tournamentMatches).where(eq(tournamentMatches.matchId, matchId));
  if (!tm?.winnerTeamId) return;
  await tx.update(tournamentMatches).set({ winnerTeamId: null }).where(eq(tournamentMatches.id, tm.id));
  if (tm.nextMatchId) {
    const [next] = await tx.select().from(tournamentMatches).where(eq(tournamentMatches.id, tm.nextMatchId));
    if (next.matchId) {
      await tx.update(tournamentMatches).set({ matchId: null }).where(eq(tournamentMatches.id, next.id));
      await tx.delete(matches).where(eq(matches.id, next.matchId));
    }
    await tx.update(tournamentMatches).set(tm.nextSlot === 1 ? { team1Id: null } : { team2Id: null }).where(eq(tournamentMatches.id, next.id));
  }
  // a knockout stage built from group results must be rebuilt
  const [bracket] = await tx.select().from(tournamentBrackets).where(eq(tournamentBrackets.id, tm.bracketId));
  if (bracket.kind === 'ROUND_ROBIN' && bracket.stage === 1) {
    const [ko] = await tx.select().from(tournamentBrackets).where(and(eq(tournamentBrackets.tournamentId, tm.tournamentId), eq(tournamentBrackets.stage, 2)));
    if (ko) {
      const koMatches = await tx.select().from(tournamentMatches).where(eq(tournamentMatches.bracketId, ko.id));
      const started = koMatches.filter((x) => x.matchId);
      if (started.length) {
        const ms = await tx.select().from(matches).where(inArray(matches.id, started.map((x) => x.matchId!)));
        if (ms.some((m) => m.status !== 'SCHEDULED')) throw badRequest('Knockout play has begun, so group results are locked.');
      }
      await tx.delete(tournamentBrackets).where(eq(tournamentBrackets.id, ko.id));
      if (started.length) await tx.delete(matches).where(inArray(matches.id, started.map((x) => x.matchId!)));
    }
  }
  void isNull; void asc;
}
