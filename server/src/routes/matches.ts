import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, gt, inArray, lt, ne, count, type SQL } from 'drizzle-orm';
import { db, type Tx } from '../db/index.js';
import { matches, matchParticipants, scoreHistory, users, reservations, courts, tournamentMatches } from '../db/schema.js';
import { ah, parse, notFound, forbidden, badRequest, conflict, paging } from '../lib/http.js';
import { requireAuth, requireRole, STAFF_UP, isStaff, isAdmin, type AuthUser } from '../lib/auth.js';
import { audit, notify } from '../lib/audit.js';
import { addMinutes } from '../lib/time.js';
import { applyRally, initialState, undo, callout, validateFinalMatch, type ScoreState, type ScoringConfig, type Side } from '../services/scoring.js';
import { finalizeMatch, reverseRatings, writeGames, applyRatings } from '../services/matches.js';
import { courtConflicts, checkOpeningHours } from '../services/booking.js';
import { assertCorrectable, rollbackProgression, onTournamentMatchDecided } from '../services/tournament.js';

export const r = Router();
r.use(requireAuth);
type Match = typeof matches.$inferSelect;
const cfgOf = (m: Match): ScoringConfig => ({ format: m.format, scoring: m.scoring, targetScore: m.targetScore, winBy: m.winBy, bestOf: m.bestOf });

async function load(id: string) {
  const m = await db.query.matches.findFirst({ where: eq(matches.id, id), with: { court: { columns: { id: true, name: true } }, participants: { with: { user: { columns: { id: true, fullName: true } } } }, games: true } });
  if (!m) throw notFound('Match');
  return m;
}

/** Friendly: participants, the official or staff may score. Competitive: only the official or staff. */
function canScore(u: AuthUser, m: { category: string; officialId: string | null; participants: { userId: string }[] }) {
  if (isStaff(u) || m.officialId === u.id) return true;
  return m.category === 'FRIENDLY' && m.participants.some((p) => p.userId === u.id);
}

async function playerConflicts(q: Tx | typeof db, userIds: string[], start: Date, end: Date, ignoreMatchId?: string) {
  const w = [inArray(matchParticipants.userId, userIds), inArray(matches.status, ['SCHEDULED', 'IN_PROGRESS']), lt(matches.startAt, end), gt(matches.endAt, start)];
  if (ignoreMatchId) w.push(ne(matches.id, ignoreMatchId));
  const hits = await q.select({ name: users.fullName }).from(matchParticipants).innerJoin(matches, eq(matches.id, matchParticipants.matchId)).innerJoin(users, eq(users.id, matchParticipants.userId)).where(and(...w));
  return [...new Set(hits.map((h) => h.name))];
}

/** A court is usable for a match if it's free, or the only overlap is a booking owned by one of the players. */
async function checkCourt(tx: Tx, courtId: string, start: Date, end: Date, playerIds: string[], ignoreMatchId?: string) {
  const [court] = await tx.select().from(courts).where(eq(courts.id, courtId)).for('update');
  if (!court || court.status !== 'ACTIVE') throw badRequest('That court is not available');
  await checkOpeningHours(tx, courtId, start, end);
  const own = await tx.select({ id: reservations.id, userId: reservations.userId }).from(reservations)
    .where(and(eq(reservations.courtId, courtId), inArray(reservations.status, ['PENDING', 'CONFIRMED', 'CHECKED_IN']), lt(reservations.startAt, end), gt(reservations.endAt, start)));
  const foreign = own.filter((x) => !playerIds.includes(x.userId));
  if (foreign.length) throw conflict('That court is booked by someone else at that time.');
  const why = await courtConflicts(tx, courtId, start, end, own[0]?.id, ignoreMatchId);
  if (why && !why.startsWith('That time overlaps')) throw conflict(why);
}

const createSchema = z.object({
  format: z.enum(['SINGLES', 'DOUBLES']),
  category: z.enum(['FRIENDLY', 'COMPETITIVE']).default('FRIENDLY'),
  courtId: z.string().uuid().nullable().optional(),
  startAt: z.coerce.date(),
  durationMinutes: z.number().int().min(15).max(240).default(60),
  scoring: z.enum(['SIDE_OUT', 'RALLY']).default('SIDE_OUT'),
  targetScore: z.number().int().min(5).max(25).default(11),
  winBy: z.union([z.literal(1), z.literal(2)]).default(2),
  bestOf: z.union([z.literal(1), z.literal(3), z.literal(5)]).default(1),
  side1: z.array(z.string().uuid()).min(1).max(2),
  side2: z.array(z.string().uuid()).min(1).max(2),
  officialId: z.string().uuid().nullable().optional(),
});

r.post('/', ah(async (req, res) => {
  const b = parse(createSchema, req.body);
  const size = b.format === 'SINGLES' ? 1 : 2;
  if (b.side1.length !== size || b.side2.length !== size) throw badRequest(`${b.format === 'SINGLES' ? 'Singles' : 'Doubles'} needs ${size} player(s) per side`);
  const all = [...b.side1, ...b.side2];
  if (new Set(all).size !== all.length) throw badRequest('A player can only appear once in a match');
  if (!isStaff(req.user)) {
    if (b.category === 'COMPETITIVE') throw forbidden('Only staff can schedule competitive matches');
    if (!all.includes(req.user!.id)) throw forbidden('You can only schedule friendly matches you play in');
  }
  const start = b.startAt, end = addMinutes(start, b.durationMinutes);
  if (start < addMinutes(new Date(), -5)) throw badRequest('Choose a start time in the future');
  const found = await db.select({ id: users.id, status: users.status }).from(users).where(inArray(users.id, all));
  if (found.length !== all.length || found.some((f) => f.status !== 'ACTIVE')) throw badRequest('Every player must have an active account');
  if (b.officialId) {
    const [o] = await db.select().from(users).where(eq(users.id, b.officialId));
    if (!o || !['SUPER_ADMIN', 'CLUB_ADMIN', 'STAFF', 'COACH'].includes(o.role)) throw badRequest('The official must be a staff member or coach');
    if (all.includes(b.officialId)) throw badRequest('The official cannot also be a player');
  }
  const m = await db.transaction(async (tx) => {
    const busy = await playerConflicts(tx, all, start, end);
    if (busy.length) throw conflict(`Already playing another match then: ${busy.join(', ')}`);
    if (b.courtId) await checkCourt(tx, b.courtId, start, end, all);
    const [row] = await tx.insert(matches).values({ format: b.format, category: b.category, courtId: b.courtId ?? null, startAt: start, endAt: end, scoring: b.scoring, targetScore: b.targetScore, winBy: b.winBy, bestOf: b.bestOf, officialId: b.officialId ?? null }).returning();
    await tx.insert(matchParticipants).values([...b.side1.map((u) => ({ matchId: row.id, userId: u, side: 1 })), ...b.side2.map((u) => ({ matchId: row.id, userId: u, side: 2 }))]);
    await notify(all.filter((u) => u !== req.user!.id), { type: 'MATCH_SCHEDULED', title: 'You have a new match', body: `${b.category === 'COMPETITIVE' ? 'Competitive' : 'Friendly'} ${b.format.toLowerCase()} match scheduled.`, link: `/app/matches/${row.id}` }, tx);
    await audit(req, 'match.create', 'match', row.id, b, tx);
    return row;
  });
  res.status(201).json({ match: m });
}));

r.get('/', ah(async (req, res) => {
  const qs = parse(z.object({ status: z.string().optional(), mine: z.enum(['1', '0']).optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional() }), req.query);
  const { page, pageSize, offset } = paging(req.query);
  const w: SQL[] = [];
  if (qs.status) w.push(inArray(matches.status, qs.status.split(',') as any));
  if (qs.from) w.push(gt(matches.startAt, qs.from));
  if (qs.to) w.push(lt(matches.startAt, qs.to));
  if (qs.mine === '1' || !isStaff(req.user)) {
    const mine = db.select({ id: matchParticipants.matchId }).from(matchParticipants).where(eq(matchParticipants.userId, req.user!.id));
    if (qs.mine === '1' || req.user!.role === 'PLAYER') w.push(inArray(matches.id, mine));
  }
  const where = w.length ? and(...w) : undefined;
  const items = await db.query.matches.findMany({ where, with: { court: { columns: { name: true } }, participants: { with: { user: { columns: { id: true, fullName: true } } } }, games: true }, orderBy: [desc(matches.startAt)], limit: pageSize, offset });
  const [{ total }] = await db.select({ total: count() }).from(matches).where(where);
  res.json({ items, total, page, pageSize });
}));

r.get('/:id', ah(async (req, res) => {
  const m = await load(req.params.id);
  const history = await db.select({ h: scoreHistory, actor: users.fullName }).from(scoreHistory).innerJoin(users, eq(users.id, scoreHistory.actorId)).where(eq(scoreHistory.matchId, m.id)).orderBy(desc(scoreHistory.createdAt)).limit(50);
  const [tm] = await db.select({ tournamentId: tournamentMatches.tournamentId }).from(tournamentMatches).where(eq(tournamentMatches.matchId, m.id));
  const st = m.liveState as ScoreState | null;
  res.json({
    match: { ...m, liveState: st ? { ...st, log: undefined, rallies: st.log.length } : null },
    call: st ? callout(cfgOf(m), st) : null,
    canScore: canScore(req.user!, { ...m, participants: m.participants }),
    canCorrect: isAdmin(req.user) || (isStaff(req.user) && m.category === 'FRIENDLY'),
    tournamentId: tm?.tournamentId ?? null,
    history: history.map((x) => ({ ...x.h, actorName: x.actor, before: undefined, after: undefined })),
  });
}));

async function scoringTx<T>(req: Express.Request, id: string, fn: (tx: Tx, m: Match) => Promise<T>) {
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(matches).where(eq(matches.id, id)).for('update'); // one score update at a time
    if (!m) throw notFound('Match');
    const ps = await tx.select().from(matchParticipants).where(eq(matchParticipants.matchId, id));
    if (!canScore(req.user!, { ...m, participants: ps })) throw forbidden('You are not allowed to score this match');
    return fn(tx, m);
  });
}

r.post('/:id/start', ah(async (req, res) => {
  const { firstServingSide } = parse(z.object({ firstServingSide: z.union([z.literal(1), z.literal(2)]).default(1) }), req.body);
  const out = await scoringTx(req, req.params.id, async (tx, m) => {
    if (m.status !== 'SCHEDULED') throw badRequest('Only a scheduled match can be started');
    const [tm] = await tx.select().from(tournamentMatches).where(eq(tournamentMatches.matchId, m.id));
    if (tm && (!tm.team1Id || !tm.team2Id)) throw badRequest('Both teams must be decided first');
    const st = initialState(cfgOf(m), firstServingSide as Side);
    await tx.update(matches).set({ status: 'IN_PROGRESS', liveState: st }).where(eq(matches.id, m.id));
    await tx.insert(scoreHistory).values({ matchId: m.id, actorId: req.user!.id, action: 'START', after: st });
    return { call: callout(cfgOf(m), st) };
  });
  res.json(out);
}));

r.post('/:id/rally', ah(async (req, res) => {
  const { winner } = parse(z.object({ winner: z.union([z.literal(1), z.literal(2)]) }), req.body);
  const out = await scoringTx(req, req.params.id, async (tx, m) => {
    if (m.status !== 'IN_PROGRESS' || !m.liveState) throw badRequest('Start the match before scoring rallies');
    const before = m.liveState as ScoreState;
    let st: ScoreState;
    try { st = applyRally(cfgOf(m), before, winner as Side); } catch (e) { throw badRequest((e as Error).message); }
    await tx.update(matches).set({ liveState: st }).where(eq(matches.id, m.id));
    await tx.insert(scoreHistory).values({ matchId: m.id, actorId: req.user!.id, action: `RALLY_SIDE_${winner}`, after: { games: st.games } });
    await writeGames(tx, m.id, st.games.filter((g) => g.s1 || g.s2 || g.winner));
    if (st.completed) await finalizeMatch(tx, { ...m, liveState: st }, st.winnerSide!, st.games);
    return { state: { ...st, log: undefined }, call: callout(cfgOf(m), st) };
  });
  res.json(out);
}));

r.post('/:id/undo', ah(async (req, res) => {
  const out = await scoringTx(req, req.params.id, async (tx, m) => {
    if (m.status !== 'IN_PROGRESS' || !m.liveState) throw badRequest('Undo is only available during live scoring');
    let st: ScoreState;
    try { st = undo(cfgOf(m), m.liveState as ScoreState); } catch (e) { throw badRequest((e as Error).message); }
    await tx.update(matches).set({ liveState: st }).where(eq(matches.id, m.id));
    await writeGames(tx, m.id, st.games.filter((g) => g.s1 || g.s2 || g.winner));
    await tx.insert(scoreHistory).values({ matchId: m.id, actorId: req.user!.id, action: 'UNDO', after: { games: st.games } });
    return { state: { ...st, log: undefined }, call: callout(cfgOf(m), st) };
  });
  res.json(out);
}));

const gamesSchema = z.object({ games: z.array(z.object({ s1: z.number().int().min(0).max(99), s2: z.number().int().min(0).max(99) })).min(1).max(5), reason: z.string().trim().max(300).optional() });

/** Enter a final result after play (when live rally scoring was not used). */
r.post('/:id/result', ah(async (req, res) => {
  const b = parse(gamesSchema, req.body);
  const out = await scoringTx(req, req.params.id, async (tx, m) => {
    if (!['SCHEDULED', 'IN_PROGRESS'].includes(m.status)) throw badRequest('This match already has a result. Use a correction instead.');
    const [tm] = await tx.select().from(tournamentMatches).where(eq(tournamentMatches.matchId, m.id));
    if (tm && (!tm.team1Id || !tm.team2Id)) throw badRequest('Both teams must be decided first');
    let v; try { v = validateFinalMatch(cfgOf(m), b.games); } catch (e) { throw badRequest((e as Error).message); }
    await tx.insert(scoreHistory).values({ matchId: m.id, actorId: req.user!.id, action: 'FINAL_RESULT', after: { games: v.games } });
    await finalizeMatch(tx, m, v.winner, v.games);
    return { winnerSide: v.winner };
  });
  res.json(out);
}));

/** Correct a completed match's score. Audited; ratings and brackets are recalculated. */
r.post('/:id/correct', requireRole(...STAFF_UP), ah(async (req, res) => {
  const b = parse(gamesSchema.extend({ reason: z.string().trim().min(5, 'Explain the correction').max(300) }), req.body);
  const out = await db.transaction(async (tx) => {
    const [m] = await tx.select().from(matches).where(eq(matches.id, req.params.id)).for('update');
    if (!m) throw notFound('Match');
    if (m.status !== 'COMPLETED') throw badRequest('Only completed matches can be corrected');
    if (m.category === 'COMPETITIVE' && !isAdmin(req.user)) throw forbidden('Only administrators can correct competitive results');
    let v; try { v = validateFinalMatch(cfgOf(m), b.games); } catch (e) { throw badRequest((e as Error).message); }
    const before = await tx.query.matchScores.findMany({ where: (s, { eq: e }) => e(s.matchId, m.id) });
    const tm = await assertCorrectable(tx, m.id);
    await reverseRatings(tx, m);
    const winnerChanged = m.winnerSide !== v.winner;
    if (tm && winnerChanged) await rollbackProgression(tx, m.id);
    await writeGames(tx, m.id, v.games);
    const [u] = await tx.update(matches).set({ winnerSide: v.winner, ratingApplied: false }).where(eq(matches.id, m.id)).returning();
    await applyRatings(tx, u, v.winner);
    if (tm && winnerChanged) await onTournamentMatchDecided(tx, m.id, v.winner);
    await tx.insert(scoreHistory).values({ matchId: m.id, actorId: req.user!.id, action: 'CORRECTION', before: before.map((g) => ({ s1: g.side1Score, s2: g.side2Score })), after: v.games, reason: b.reason });
    await audit(req, 'match.score_correction', 'match', m.id, { before: before.map((g) => `${g.side1Score}-${g.side2Score}`), after: v.games.map((g) => `${g.s1}-${g.s2}`), reason: b.reason }, tx);
    return { winnerSide: v.winner };
  });
  res.json(out);
}));

r.post('/:id/schedule', requireRole(...STAFF_UP), ah(async (req, res) => {
  const b = parse(z.object({ courtId: z.string().uuid().nullable(), startAt: z.coerce.date(), durationMinutes: z.number().int().min(15).max(240).default(60), officialId: z.string().uuid().nullable().optional() }), req.body);
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(matches).where(eq(matches.id, req.params.id)).for('update');
    if (!m) throw notFound('Match');
    if (m.status !== 'SCHEDULED') throw badRequest('Only scheduled matches can be moved');
    const end = addMinutes(b.startAt, b.durationMinutes);
    const ps = (await tx.select().from(matchParticipants).where(eq(matchParticipants.matchId, m.id))).map((p) => p.userId);
    const busy = await playerConflicts(tx, ps, b.startAt, end, m.id);
    if (busy.length) throw conflict(`Already playing another match then: ${busy.join(', ')}`);
    if (b.courtId) await checkCourt(tx, b.courtId, b.startAt, end, ps, m.id);
    await tx.update(matches).set({ courtId: b.courtId, startAt: b.startAt, endAt: end, ...(b.officialId !== undefined && { officialId: b.officialId }) }).where(eq(matches.id, m.id));
    await notify(ps, { type: 'MATCH_SCHEDULED', title: 'Match time updated', body: 'Your match has a new court or start time.', link: `/app/matches/${m.id}` }, tx);
    await audit(req, 'match.schedule', 'match', m.id, b, tx);
  });
  res.json({ ok: true });
}));

r.post('/:id/cancel', ah(async (req, res) => {
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(matches).where(eq(matches.id, req.params.id)).for('update');
    if (!m) throw notFound('Match');
    const ps = await tx.select().from(matchParticipants).where(eq(matchParticipants.matchId, m.id));
    const [tm] = await tx.select().from(tournamentMatches).where(eq(tournamentMatches.matchId, m.id));
    if (tm) throw badRequest('Tournament matches cannot be cancelled individually');
    if (!isStaff(req.user) && !(m.category === 'FRIENDLY' && ps.some((p) => p.userId === req.user!.id))) throw forbidden();
    if (m.status !== 'SCHEDULED') throw badRequest('Only scheduled matches can be cancelled');
    await tx.update(matches).set({ status: 'CANCELLED' }).where(eq(matches.id, m.id));
    await notify(ps.map((p) => p.userId).filter((u) => u !== req.user!.id), { type: 'MATCH_CANCELLED', title: 'Match cancelled', body: 'A match you were in has been cancelled.', link: `/app/matches/${m.id}` }, tx);
    await audit(req, 'match.cancel', 'match', m.id, null, tx);
  });
  res.json({ ok: true });
}));
void asc;
