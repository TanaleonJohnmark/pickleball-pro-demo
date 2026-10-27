import { Router } from 'express';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, ilike, inArray, notInArray, or, count, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, playerProfiles, reservations, courts, memberships, membershipPlans, matchParticipants, matches, tournamentRegistrations, tournaments, payments, rankings, sessions, coachingEnrollments, coachingSessions, coaches, coachNotes } from '../db/schema.js';
import { ah, parse, notFound, forbidden, conflict, paging } from '../lib/http.js';
import { requireAuth, requireRole, STAFF_UP, ADMIN, isStaff, isAdmin, hashPassword } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { expireMemberships } from '../services/membership.js';

export const r = Router();
r.use(requireAuth);

/** Players a coach may see: those enrolled in the coach's sessions. */
async function coachPlayerIds(userId: string) {
  const [c] = await db.select().from(coaches).where(eq(coaches.userId, userId));
  if (!c) return [];
  const rows = await db.selectDistinct({ id: coachingEnrollments.playerId }).from(coachingEnrollments).innerJoin(coachingSessions, eq(coachingSessions.id, coachingEnrollments.sessionId)).where(eq(coachingSessions.coachId, c.id));
  return rows.map((x) => x.id);
}

r.get('/', requireRole(...STAFF_UP, 'COACH'), ah(async (req, res) => {
  const q = parse(z.object({ q: z.string().max(80).optional(), skill: z.string().optional(), status: z.enum(['ACTIVE', 'SUSPENDED']).optional(), membership: z.enum(['member', 'none']).optional(), role: z.string().optional() }), req.query);
  const { page, pageSize, offset } = paging(req.query);
  await expireMemberships();
  const w: SQL[] = [inArray(users.role, (q.role && isStaff(req.user) ? q.role.split(',') : ['PLAYER']) as any)];
  if (req.user!.role === 'COACH') { const ids = await coachPlayerIds(req.user!.id); w.push(inArray(users.id, ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])); }
  if (q.q) w.push(or(ilike(users.fullName, `%${q.q}%`), ilike(users.email, `%${q.q}%`), ilike(users.phone, `%${q.q}%`))!);
  if (q.skill) w.push(inArray(playerProfiles.skillLevel, q.skill.split(',') as any));
  if (q.status) w.push(eq(users.status, q.status));
  const activeM = db.select({ id: memberships.userId }).from(memberships).where(eq(memberships.status, 'ACTIVE'));
  if (q.membership === 'member') w.push(inArray(users.id, activeM));
  if (q.membership === 'none') w.push(notInArray(users.id, activeM));
  const where = and(...w);
  const rows = await db.select({ id: users.id, fullName: users.fullName, email: users.email, phone: users.phone, status: users.status, role: users.role, createdAt: users.createdAt, skillLevel: playerProfiles.skillLevel, preferredFormat: playerProfiles.preferredFormat, avatarUrl: playerProfiles.avatarUrl })
    .from(users).leftJoin(playerProfiles, eq(playerProfiles.userId, users.id)).where(where).orderBy(asc(users.fullName)).limit(pageSize).offset(offset);
  const [{ total }] = await db.select({ total: count() }).from(users).leftJoin(playerProfiles, eq(playerProfiles.userId, users.id)).where(where);
  const ids = rows.map((x) => x.id);
  const ms = ids.length ? await db.select({ userId: memberships.userId, plan: membershipPlans.name, endDate: memberships.endDate }).from(memberships).innerJoin(membershipPlans, eq(membershipPlans.id, memberships.planId)).where(and(inArray(memberships.userId, ids), eq(memberships.status, 'ACTIVE'))) : [];
  const items = rows.map((x) => ({ ...x, email: req.user!.role === 'COACH' ? undefined : x.email, phone: req.user!.role === 'COACH' ? undefined : x.phone, membership: ms.find((m) => m.userId === x.id) ?? null }));
  res.json({ items, total, page, pageSize });
}));

/** Front desk: register a walk-in customer. Returns a one-time temporary password. */
r.post('/', requireRole(...STAFF_UP), ah(async (req, res) => {
  const b = parse(z.object({ fullName: z.string().trim().min(2).max(100), email: z.string().trim().toLowerCase().email(), phone: z.string().trim().max(30).optional(), skillLevel: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'COMPETITIVE']).default('BEGINNER') }), req.body);
  const [ex] = await db.select({ id: users.id }).from(users).where(eq(users.email, b.email));
  if (ex) throw conflict('A player with this email already exists');
  const temp = randomBytes(6).toString('base64url') + '7a';
  const u = await db.transaction(async (tx) => {
    const [u] = await tx.insert(users).values({ email: b.email, fullName: b.fullName, phone: b.phone, passwordHash: await hashPassword(temp), role: 'PLAYER' }).returning();
    await tx.insert(playerProfiles).values({ userId: u.id, skillLevel: b.skillLevel });
    await audit(req, 'player.create_walkin', 'user', u.id, { email: b.email }, tx);
    return u;
  });
  res.status(201).json({ player: { id: u.id, fullName: u.fullName, email: u.email }, temporaryPassword: temp });
}));

r.get('/:id', ah(async (req, res) => {
  const id = req.params.id;
  const self = id === req.user!.id;
  if (!self && !isStaff(req.user)) {
    if (req.user!.role !== 'COACH' || !(await coachPlayerIds(req.user!.id)).includes(id)) throw forbidden();
  }
  await expireMemberships();
  const [u] = await db.select({ id: users.id, fullName: users.fullName, email: users.email, phone: users.phone, role: users.role, status: users.status, createdAt: users.createdAt }).from(users).where(eq(users.id, id));
  if (!u) throw notFound('Player');
  const coachView = req.user!.role === 'COACH' && !self;
  const [profile] = await db.select().from(playerProfiles).where(eq(playerProfiles.userId, id));
  const ranks = await db.select().from(rankings).where(eq(rankings.userId, id));
  const myMatches = await db.select({ id: matches.id, startAt: matches.startAt, status: matches.status, format: matches.format, category: matches.category, winnerSide: matches.winnerSide, side: matchParticipants.side })
    .from(matchParticipants).innerJoin(matches, eq(matches.id, matchParticipants.matchId)).where(eq(matchParticipants.userId, id)).orderBy(desc(matches.startAt)).limit(25);
  const done = myMatches.filter((m) => m.status === 'COMPLETED');
  const stats = { played: done.length, wins: done.filter((m) => m.winnerSide === m.side).length };
  const base = { player: { ...u, email: coachView ? undefined : u.email, phone: coachView ? undefined : u.phone }, profile, rankings: ranks, stats, matches: myMatches };
  if (coachView) {
    const [c] = await db.select().from(coaches).where(eq(coaches.userId, req.user!.id));
    const notes = await db.select().from(coachNotes).where(and(eq(coachNotes.coachId, c.id), eq(coachNotes.playerId, id))).orderBy(desc(coachNotes.createdAt));
    return res.json({ ...base, notes });
  }
  const [bookings, mems, regs, pays] = await Promise.all([
    db.select({ r: reservations, court: courts.name }).from(reservations).innerJoin(courts, eq(courts.id, reservations.courtId)).where(eq(reservations.userId, id)).orderBy(desc(reservations.startAt)).limit(25),
    db.select({ m: memberships, plan: membershipPlans.name }).from(memberships).innerJoin(membershipPlans, eq(membershipPlans.id, memberships.planId)).where(eq(memberships.userId, id)).orderBy(desc(memberships.createdAt)),
    db.select({ id: tournaments.id, name: tournaments.name, status: tournaments.status, startDate: tournaments.startDate, paymentStatus: tournamentRegistrations.paymentStatus }).from(tournamentRegistrations).innerJoin(tournaments, eq(tournaments.id, tournamentRegistrations.tournamentId)).where(eq(tournamentRegistrations.userId, id)).orderBy(desc(tournaments.startDate)),
    db.select().from(payments).where(eq(payments.userId, id)).orderBy(desc(payments.paidAt)).limit(25),
  ]);
  res.json({ ...base, reservations: bookings.map((b) => ({ ...b.r, courtName: b.court })), memberships: mems.map((m) => ({ ...m.m, planName: m.plan })), tournaments: regs, payments: pays });
}));

r.patch('/:id', requireRole(...ADMIN), ah(async (req, res) => {
  const b = parse(z.object({ fullName: z.string().trim().min(2).max(100).optional(), phone: z.string().trim().max(30).nullable().optional(), skillLevel: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'COMPETITIVE']).optional(), preferredFormat: z.enum(['SINGLES', 'DOUBLES']).optional() }), req.body);
  const [target] = await db.select().from(users).where(eq(users.id, req.params.id));
  if (!target) throw notFound('Player');
  if (target.role !== 'PLAYER' && req.user!.role !== 'SUPER_ADMIN') throw forbidden('Only a super admin can edit staff accounts');
  await db.transaction(async (tx) => {
    if (b.fullName || b.phone !== undefined) await tx.update(users).set({ ...(b.fullName && { fullName: b.fullName }), ...(b.phone !== undefined && { phone: b.phone }) }).where(eq(users.id, target.id));
    const p = { ...(b.skillLevel && { skillLevel: b.skillLevel }), ...(b.preferredFormat && { preferredFormat: b.preferredFormat }) };
    if (Object.keys(p).length) await tx.insert(playerProfiles).values({ userId: target.id, ...p }).onConflictDoUpdate({ target: playerProfiles.userId, set: p });
    await audit(req, 'player.update', 'user', target.id, b, tx);
  });
  res.json({ ok: true });
}));

r.post('/:id/status', requireRole(...ADMIN), ah(async (req, res) => {
  const { status, reason } = parse(z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason: z.string().trim().max(200).optional() }), req.body);
  const [target] = await db.select().from(users).where(eq(users.id, req.params.id));
  if (!target) throw notFound('Player');
  if (target.id === req.user!.id) throw forbidden('You cannot change your own status');
  if (target.role !== 'PLAYER' && req.user!.role !== 'SUPER_ADMIN') throw forbidden('Only a super admin can suspend staff');
  await db.update(users).set({ status }).where(eq(users.id, target.id));
  if (status === 'SUSPENDED') await db.delete(sessions).where(eq(sessions.userId, target.id));
  await audit(req, `player.${status.toLowerCase()}`, 'user', target.id, { reason });
  res.json({ ok: true });
}));
void isAdmin;
