import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, inArray, count, or } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tournaments, tournamentTeams, tournamentRegistrations, tournamentBrackets, tournamentMatches, matches, matchScores, users, playerProfiles } from '../db/schema.js';
import { ah, parse, notFound, badRequest, conflict } from '../lib/http.js';
import { requireAuth, requireRole, ADMIN, isAdmin, isStaff } from '../lib/auth.js';
import { audit, notify } from '../lib/audit.js';
import { startTournament, roundRobinStandings } from '../services/tournament.js';

export const r = Router();

const base = z.object({
  name: z.string().trim().min(3).max(100),
  description: z.string().max(2000).nullable().optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  venue: z.string().trim().min(2).max(120),
  format: z.enum(['SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION', 'ROUND_ROBIN', 'GROUP_KNOCKOUT']),
  category: z.enum(['SINGLES', 'DOUBLES']),
  skillDivision: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'COMPETITIVE']).nullable().optional(),
  feeCents: z.number().int().min(0).default(0),
  maxParticipants: z.number().int().min(2).max(128),
  registrationDeadline: z.coerce.date(),
  groupCount: z.number().int().min(2).max(8).default(2),
});
const validate = (t: z.infer<typeof base>) => {
  if (t.endDate < t.startDate) throw badRequest('End date must be on or after the start date');
  if (t.registrationDeadline > t.startDate) throw badRequest('Registration must close before the tournament starts');
  if (t.format === 'DOUBLE_ELIMINATION') throw badRequest('Double elimination is not available yet. Choose another format.');
};

r.get('/', ah(async (req, res) => {
  const list = await db.select().from(tournaments).where(isStaff(req.user) ? undefined : inArray(tournaments.status, ['OPEN', 'IN_PROGRESS', 'COMPLETED'])).orderBy(desc(tournaments.startDate));
  const counts = await db.select({ id: tournamentTeams.tournamentId, n: count() }).from(tournamentTeams).groupBy(tournamentTeams.tournamentId);
  const mine = req.user ? await db.select({ id: tournamentRegistrations.tournamentId }).from(tournamentRegistrations).where(eq(tournamentRegistrations.userId, req.user.id)) : [];
  res.json({ tournaments: list.map((t) => ({ ...t, entries: counts.find((c) => c.id === t.id)?.n ?? 0, registered: mine.some((m) => m.id === t.id) })) });
}));

r.get('/:id', ah(async (req, res) => {
  const t = await db.query.tournaments.findFirst({ where: eq(tournaments.id, req.params.id) });
  if (!t || (t.status === 'DRAFT' && !isStaff(req.user))) throw notFound('Tournament');
  const teams = await db.select({ team: tournamentTeams, p1: users.fullName }).from(tournamentTeams).innerJoin(users, eq(users.id, tournamentTeams.player1Id)).where(eq(tournamentTeams.tournamentId, t.id)).orderBy(asc(tournamentTeams.seed), asc(tournamentTeams.name));
  const brackets = await db.select().from(tournamentBrackets).where(eq(tournamentBrackets.tournamentId, t.id)).orderBy(asc(tournamentBrackets.stage), asc(tournamentBrackets.name));
  const tms = await db.select({ tm: tournamentMatches, status: matches.status, courtId: matches.courtId, startAt: matches.startAt }).from(tournamentMatches).leftJoin(matches, eq(matches.id, tournamentMatches.matchId)).where(eq(tournamentMatches.tournamentId, t.id)).orderBy(asc(tournamentMatches.round), asc(tournamentMatches.position));
  const mids = tms.map((x) => x.tm.matchId).filter(Boolean) as string[];
  const scores = mids.length ? await db.select().from(matchScores).where(inArray(matchScores.matchId, mids)) : [];
  const standingsByBracket: Record<string, unknown> = {};
  for (const b of brackets.filter((x) => x.kind === 'ROUND_ROBIN')) standingsByBracket[b.id] = (await db.transaction((tx) => roundRobinStandings(tx, b.id))).table;
  const myReg = req.user ? (await db.select().from(tournamentRegistrations).where(and(eq(tournamentRegistrations.tournamentId, t.id), eq(tournamentRegistrations.userId, req.user.id))))[0] ?? null : null;
  res.json({
    tournament: t, myRegistration: myReg,
    teams: teams.map((x) => ({ ...x.team, player1Name: x.p1 })),
    brackets: brackets.map((b) => ({ ...b, standings: standingsByBracket[b.id] ?? null, matches: tms.filter((x) => x.tm.bracketId === b.id).map((x) => ({ ...x.tm, status: x.status, startAt: x.startAt, courtId: x.courtId, games: scores.filter((s) => s.matchId === x.tm.matchId).sort((a, z) => a.gameNumber - z.gameNumber) })) })),
  });
}));

r.post('/', requireRole(...ADMIN), ah(async (req, res) => {
  const b = parse(base, req.body); validate(b);
  const [t] = await db.insert(tournaments).values({ ...b, status: 'DRAFT' }).returning();
  await audit(req, 'tournament.create', 'tournament', t.id, { name: t.name });
  res.status(201).json({ tournament: t });
}));

r.patch('/:id', requireRole(...ADMIN), ah(async (req, res) => {
  const [t] = await db.select().from(tournaments).where(eq(tournaments.id, req.params.id));
  if (!t) throw notFound('Tournament');
  if (!['DRAFT', 'OPEN'].includes(t.status)) throw badRequest('A tournament can only be edited before it starts');
  const b = parse(base.partial(), req.body);
  const merged = { ...t, ...b } as z.infer<typeof base>; validate(merged);
  const [n] = await db.select({ n: count() }).from(tournamentTeams).where(eq(tournamentTeams.tournamentId, t.id));
  if (b.maxParticipants && b.maxParticipants < n.n) throw badRequest(`${n.n} entries are already registered`);
  if (b.category && b.category !== t.category && n.n) throw badRequest('Category cannot change after entries exist');
  const [u] = await db.update(tournaments).set(b).where(eq(tournaments.id, t.id)).returning();
  await audit(req, 'tournament.update', 'tournament', t.id, b);
  res.json({ tournament: u });
}));

r.post('/:id/status', requireRole(...ADMIN), ah(async (req, res) => {
  const { action } = parse(z.object({ action: z.enum(['open', 'close', 'start', 'cancel']) }), req.body);
  await db.transaction(async (tx) => {
    const [t] = await tx.select().from(tournaments).where(eq(tournaments.id, req.params.id)).for('update');
    if (!t) throw notFound('Tournament');
    if (action === 'open') { if (t.status !== 'DRAFT') throw badRequest('Only drafts can be opened'); await tx.update(tournaments).set({ status: 'OPEN' }).where(eq(tournaments.id, t.id)); }
    if (action === 'close') { if (t.status !== 'OPEN') throw badRequest('Only open tournaments can return to draft'); await tx.update(tournaments).set({ status: 'DRAFT' }).where(eq(tournaments.id, t.id)); }
    if (action === 'start') await startTournament(tx, t);
    if (action === 'cancel') {
      if (t.status === 'COMPLETED') throw badRequest('A completed tournament cannot be cancelled');
      await tx.update(tournaments).set({ status: 'CANCELLED' }).where(eq(tournaments.id, t.id));
      const ms = await tx.select({ id: tournamentMatches.matchId }).from(tournamentMatches).where(eq(tournamentMatches.tournamentId, t.id));
      const ids = ms.map((m) => m.id).filter(Boolean) as string[];
      if (ids.length) await tx.update(matches).set({ status: 'CANCELLED' }).where(and(inArray(matches.id, ids), inArray(matches.status, ['SCHEDULED', 'IN_PROGRESS'])));
      const regs = await tx.select({ u: tournamentRegistrations.userId }).from(tournamentRegistrations).where(eq(tournamentRegistrations.tournamentId, t.id));
      await notify(regs.map((x) => x.u), { type: 'TOURNAMENT_CANCELLED', title: `${t.name} was cancelled`, body: 'Paid registration fees will be refunded by the club.', link: `/app/tournaments/${t.id}` }, tx);
    }
    await audit(req, `tournament.${action}`, 'tournament', t.id, null, tx);
  });
  res.json({ ok: true });
}));

r.post('/:id/register', requireAuth, ah(async (req, res) => {
  const b = parse(z.object({ partnerEmail: z.string().trim().toLowerCase().email().optional(), teamName: z.string().trim().max(60).optional(), userId: z.string().uuid().optional() }), req.body);
  const playerId = b.userId && isStaff(req.user) ? b.userId : req.user!.id;
  const out = await db.transaction(async (tx) => {
    const [t] = await tx.select().from(tournaments).where(eq(tournaments.id, req.params.id)).for('update'); // serialize capacity checks
    if (!t) throw notFound('Tournament');
    if (t.status !== 'OPEN') throw badRequest('Registration is not open');
    if (new Date() > t.registrationDeadline) throw badRequest('The registration deadline has passed');
    const [{ n }] = await tx.select({ n: count() }).from(tournamentTeams).where(eq(tournamentTeams.tournamentId, t.id));
    if (n >= t.maxParticipants) throw conflict('This tournament is full');
    const ids = [playerId];
    let partner: { id: string; fullName: string } | null = null;
    if (t.category === 'DOUBLES') {
      if (!b.partnerEmail) throw badRequest('Doubles entries need a partner. Enter your partner\'s account email.');
      const [p] = await tx.select().from(users).where(eq(users.email, b.partnerEmail));
      if (!p || p.status !== 'ACTIVE') throw badRequest('No active player has that email');
      if (p.id === playerId) throw badRequest('Choose a different partner');
      partner = p; ids.push(p.id);
    }
    const existing = await tx.select().from(tournamentRegistrations).where(and(eq(tournamentRegistrations.tournamentId, t.id), inArray(tournamentRegistrations.userId, ids)));
    if (existing.length) throw conflict(existing.some((e) => e.userId === playerId) ? 'Already registered for this tournament' : 'Your partner is already registered with another team');
    if (t.skillDivision) {
      const profs = await tx.select().from(playerProfiles).where(inArray(playerProfiles.userId, ids));
      if (profs.length !== ids.length || profs.some((p) => p.skillLevel !== t.skillDivision)) throw badRequest(`This division is for ${t.skillDivision.toLowerCase()} players only`);
    }
    const [me] = await tx.select().from(users).where(eq(users.id, playerId));
    const [team] = await tx.insert(tournamentTeams).values({ tournamentId: t.id, name: b.teamName || (partner ? `${me.fullName.split(' ')[0]} / ${partner.fullName.split(' ')[0]}` : me.fullName), player1Id: playerId, player2Id: partner?.id ?? null }).returning();
    const pay = t.feeCents === 0 ? 'PAID' : 'UNPAID';
    await tx.insert(tournamentRegistrations).values(ids.map((u) => ({ tournamentId: t.id, userId: u, teamId: team.id, paymentStatus: pay as 'PAID' | 'UNPAID' })));
    await notify(ids, { type: 'TOURNAMENT_REGISTERED', title: `Registered for ${t.name}`, body: t.feeCents ? 'Pay the entry fee at the front desk to secure your place.' : 'You are in. Watch for the bracket.', link: `/app/tournaments/${t.id}` }, tx);
    await audit(req, 'tournament.register', 'tournament', t.id, { team: team.id, players: ids }, tx);
    return team;
  });
  res.status(201).json({ team: out });
}));

r.delete('/:id/register', requireAuth, ah(async (req, res) => {
  await db.transaction(async (tx) => {
    const [t] = await tx.select().from(tournaments).where(eq(tournaments.id, req.params.id));
    if (!t) throw notFound('Tournament');
    if (t.status !== 'OPEN') throw badRequest('You can only withdraw while registration is open');
    const [reg] = await tx.select().from(tournamentRegistrations).where(and(eq(tournamentRegistrations.tournamentId, t.id), eq(tournamentRegistrations.userId, req.user!.id)));
    if (!reg) throw notFound('Registration');
    const regs = await tx.select().from(tournamentRegistrations).where(eq(tournamentRegistrations.teamId, reg.teamId));
    if (regs.some((x) => x.paymentStatus === 'PAID') && t.feeCents > 0) throw badRequest('Your fee is paid. Ask the front desk to withdraw you and process a refund.');
    await tx.delete(tournamentTeams).where(eq(tournamentTeams.id, reg.teamId)); // cascades registrations
    await notify(regs.map((x) => x.userId).filter((u) => u !== req.user!.id), { type: 'TOURNAMENT_WITHDRAWN', title: `Your team withdrew from ${t.name}`, body: 'Your partner withdrew the entry.' }, tx);
    await audit(req, 'tournament.withdraw', 'tournament', t.id, { team: reg.teamId }, tx);
  });
  res.json({ ok: true });
}));

r.get('/:id/registrations', requireRole('CLUB_ADMIN', 'STAFF'), ah(async (req, res) => {
  const rows = await db.select({ reg: tournamentRegistrations, name: users.fullName, email: users.email, team: tournamentTeams.name })
    .from(tournamentRegistrations).innerJoin(users, eq(users.id, tournamentRegistrations.userId)).innerJoin(tournamentTeams, eq(tournamentTeams.id, tournamentRegistrations.teamId))
    .where(eq(tournamentRegistrations.tournamentId, req.params.id)).orderBy(asc(tournamentTeams.name));
  res.json({ registrations: rows.map((x) => ({ ...x.reg, playerName: x.name, email: x.email, teamName: x.team })) });
}));
void or; void isAdmin;
