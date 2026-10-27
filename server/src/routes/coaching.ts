import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, gt, gte, lt, ne, count } from 'drizzle-orm';
import { db } from '../db/index.js';
import { coaches, coachingSessions, coachingEnrollments, coachNotes, users, courts } from '../db/schema.js';
import { ah, parse, notFound, forbidden, badRequest, conflict } from '../lib/http.js';
import { requireAuth, requireRole, ADMIN, isStaff, isAdmin } from '../lib/auth.js';
import { audit, notify } from '../lib/audit.js';
import { addMinutes } from '../lib/time.js';
import { courtConflicts, checkOpeningHours } from '../services/booking.js';

export const r = Router();

r.get('/coaches', ah(async (_req, res) => {
  const rows = await db.select({ id: coaches.id, userId: users.id, name: users.fullName, bio: coaches.bio, hourlyRateCents: coaches.hourlyRateCents }).from(coaches).innerJoin(users, eq(users.id, coaches.userId)).where(and(eq(coaches.active, true), eq(users.status, 'ACTIVE'))).orderBy(asc(users.fullName));
  res.json({ coaches: rows });
}));

r.post('/coaches', requireRole(...ADMIN), ah(async (req, res) => {
  const b = parse(z.object({ userId: z.string().uuid(), bio: z.string().max(1000).optional(), hourlyRateCents: z.number().int().min(0) }), req.body);
  const [u] = await db.select().from(users).where(eq(users.id, b.userId));
  if (!u) throw notFound('User');
  if (['SUPER_ADMIN', 'CLUB_ADMIN'].includes(u.role)) throw badRequest('Administrators cannot be converted to coaches here');
  const c = await db.transaction(async (tx) => {
    await tx.update(users).set({ role: 'COACH' }).where(eq(users.id, u.id));
    const [c] = await tx.insert(coaches).values({ userId: u.id, bio: b.bio, hourlyRateCents: b.hourlyRateCents }).onConflictDoUpdate({ target: coaches.userId, set: { bio: b.bio, hourlyRateCents: b.hourlyRateCents, active: true } }).returning();
    await audit(req, 'coach.create', 'coach', c.id, b, tx);
    return c;
  });
  res.status(201).json({ coach: c });
}));

r.use(requireAuth);
async function myCoach(userId: string) { const [c] = await db.select().from(coaches).where(eq(coaches.userId, userId)); return c ?? null; }

r.get('/sessions', ah(async (req, res) => {
  const mineOnly = req.query.mine === '1';
  const c = req.user!.role === 'COACH' ? await myCoach(req.user!.id) : null;
  const rows = await db.select({ s: coachingSessions, coach: users.fullName, court: courts.name }).from(coachingSessions)
    .innerJoin(coaches, eq(coaches.id, coachingSessions.coachId)).innerJoin(users, eq(users.id, coaches.userId)).leftJoin(courts, eq(courts.id, coachingSessions.courtId))
    .where(and(c && mineOnly ? eq(coachingSessions.coachId, c.id) : undefined, isStaff(req.user) || c ? undefined : gte(coachingSessions.startAt, new Date())))
    .orderBy(asc(coachingSessions.startAt)).limit(200);
  const enr = await db.select({ sessionId: coachingEnrollments.sessionId, n: count() }).from(coachingEnrollments).groupBy(coachingEnrollments.sessionId);
  const mine = await db.select().from(coachingEnrollments).where(eq(coachingEnrollments.playerId, req.user!.id));
  res.json({ sessions: rows.map((x) => ({ ...x.s, coachName: x.coach, courtName: x.court, enrolled: enr.find((e) => e.sessionId === x.s.id)?.n ?? 0, myEnrollment: mine.find((m) => m.sessionId === x.s.id) ?? null })) });
}));

r.get('/sessions/:id', ah(async (req, res) => {
  const s = await db.query.coachingSessions.findFirst({ where: eq(coachingSessions.id, req.params.id), with: { court: { columns: { name: true } }, coach: { with: { user: { columns: { fullName: true, id: true } } } } } });
  if (!s) throw notFound('Session');
  const canSeeRoster = isStaff(req.user) || s.coach.userId === req.user!.id;
  const roster = canSeeRoster ? await db.select({ e: coachingEnrollments, name: users.fullName }).from(coachingEnrollments).innerJoin(users, eq(users.id, coachingEnrollments.playerId)).where(eq(coachingEnrollments.sessionId, s.id)) : [];
  res.json({ session: s, roster: roster.map((x) => ({ ...x.e, playerName: x.name })) });
}));

const sessionSchema = z.object({ coachId: z.string().uuid().optional(), courtId: z.string().uuid().nullable().optional(), title: z.string().trim().min(3).max(80), kind: z.enum(['INDIVIDUAL', 'GROUP']), startAt: z.coerce.date(), durationMinutes: z.number().int().min(30).max(240), priceCents: z.number().int().min(0), capacity: z.number().int().min(1).max(16).default(1) });

r.post('/sessions', requireRole('CLUB_ADMIN', 'COACH'), ah(async (req, res) => {
  const b = parse(sessionSchema, req.body);
  let coachId = b.coachId;
  if (req.user!.role === 'COACH') { const c = await myCoach(req.user!.id); if (!c) throw forbidden('Your coach profile is not set up'); coachId = c.id; }
  if (!coachId) throw badRequest('Choose a coach');
  if (b.kind === 'INDIVIDUAL' && b.capacity !== 1) throw badRequest('Individual sessions have exactly one player');
  if (b.startAt < new Date()) throw badRequest('Choose a time in the future');
  const end = addMinutes(b.startAt, b.durationMinutes);
  const s = await db.transaction(async (tx) => {
    await tx.select().from(coaches).where(eq(coaches.id, coachId!)).for('update');
    const clash = await tx.select({ id: coachingSessions.id }).from(coachingSessions).where(and(eq(coachingSessions.coachId, coachId!), eq(coachingSessions.status, 'SCHEDULED'), lt(coachingSessions.startAt, end), gt(coachingSessions.endAt, b.startAt)));
    if (clash.length) throw conflict('The coach already has a session at that time');
    if (b.courtId) {
      await tx.select().from(courts).where(eq(courts.id, b.courtId)).for('update');
      await checkOpeningHours(tx, b.courtId, b.startAt, end);
      const why = await courtConflicts(tx, b.courtId, b.startAt, end); if (why) throw conflict(why);
    }
    const [s] = await tx.insert(coachingSessions).values({ coachId: coachId!, courtId: b.courtId ?? null, title: b.title, kind: b.kind, startAt: b.startAt, endAt: end, priceCents: b.priceCents, capacity: b.capacity }).returning();
    await audit(req, 'coaching.create', 'coaching_session', s.id, b, tx);
    return s;
  });
  res.status(201).json({ session: s });
}));

r.post('/sessions/:id/enroll', ah(async (req, res) => {
  const { playerId } = parse(z.object({ playerId: z.string().uuid().optional() }), req.body);
  const pid = playerId && isStaff(req.user) ? playerId : req.user!.id;
  const e = await db.transaction(async (tx) => {
    const [s] = await tx.select().from(coachingSessions).where(eq(coachingSessions.id, req.params.id)).for('update');
    if (!s || s.status !== 'SCHEDULED') throw badRequest('This session is not open for enrollment');
    if (s.startAt < new Date()) throw badRequest('This session has already started');
    const [{ n }] = await tx.select({ n: count() }).from(coachingEnrollments).where(eq(coachingEnrollments.sessionId, s.id));
    if (n >= s.capacity) throw conflict('This session is full');
    const [e] = await tx.insert(coachingEnrollments).values({ sessionId: s.id, playerId: pid, paymentStatus: s.priceCents === 0 ? 'PAID' : 'UNPAID' }).returning();
    const [c] = await tx.select().from(coaches).where(eq(coaches.id, s.coachId));
    await notify(c.userId, { type: 'COACHING', title: 'New student enrolled', body: `Someone joined "${s.title}".`, link: `/app/coaching/${s.id}` }, tx);
    await audit(req, 'coaching.enroll', 'coaching_session', s.id, { playerId: pid }, tx);
    return e;
  });
  res.status(201).json({ enrollment: e });
}));

r.delete('/sessions/:id/enroll', ah(async (req, res) => {
  const [e] = await db.select().from(coachingEnrollments).where(and(eq(coachingEnrollments.sessionId, req.params.id), eq(coachingEnrollments.playerId, req.user!.id)));
  if (!e) throw notFound('Enrollment');
  if (e.paymentStatus === 'PAID') {
    const [s] = await db.select().from(coachingSessions).where(eq(coachingSessions.id, e.sessionId));
    if (s.priceCents > 0) throw badRequest('This session is paid. Ask the front desk to cancel it and refund you.');
  }
  await db.delete(coachingEnrollments).where(eq(coachingEnrollments.id, e.id));
  res.json({ ok: true });
}));

async function ownSession(req: Express.Request, id: string) {
  const [s] = await db.select({ s: coachingSessions, coachUser: coaches.userId }).from(coachingSessions).innerJoin(coaches, eq(coaches.id, coachingSessions.coachId)).where(eq(coachingSessions.id, id));
  if (!s) throw notFound('Session');
  if (!isAdmin(req.user) && s.coachUser !== req.user!.id) throw forbidden();
  return s.s;
}

r.post('/sessions/:id/attendance', ah(async (req, res) => {
  const b = parse(z.object({ playerId: z.string().uuid(), attended: z.boolean() }), req.body);
  const s = await ownSession(req, req.params.id);
  const [e] = await db.update(coachingEnrollments).set({ attended: b.attended }).where(and(eq(coachingEnrollments.sessionId, s.id), eq(coachingEnrollments.playerId, b.playerId))).returning();
  if (!e) throw notFound('Enrollment');
  res.json({ ok: true });
}));

r.post('/sessions/:id/status', ah(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['COMPLETED', 'CANCELLED']) }), req.body);
  const s = await ownSession(req, req.params.id);
  if (s.status !== 'SCHEDULED') throw badRequest('This session is already closed');
  await db.update(coachingSessions).set({ status }).where(eq(coachingSessions.id, s.id));
  if (status === 'CANCELLED') {
    const es = await db.select().from(coachingEnrollments).where(eq(coachingEnrollments.sessionId, s.id));
    await notify(es.map((e) => e.playerId), { type: 'COACHING_CANCELLED', title: `"${s.title}" was cancelled`, body: 'Paid fees will be refunded by the front desk.', link: `/app/coaching/${s.id}` });
  }
  await audit(req, `coaching.${status.toLowerCase()}`, 'coaching_session', s.id);
  res.json({ ok: true });
}));

r.get('/my-players', requireRole('COACH'), ah(async (req, res) => {
  const c = await myCoach(req.user!.id); if (!c) return res.json({ players: [] });
  const rows = await db.selectDistinct({ id: users.id, name: users.fullName }).from(coachingEnrollments).innerJoin(coachingSessions, eq(coachingSessions.id, coachingEnrollments.sessionId)).innerJoin(users, eq(users.id, coachingEnrollments.playerId)).where(eq(coachingSessions.coachId, c.id));
  res.json({ players: rows });
}));

r.post('/notes', requireRole('COACH'), ah(async (req, res) => {
  const b = parse(z.object({ playerId: z.string().uuid(), note: z.string().trim().min(2).max(2000) }), req.body);
  const c = await myCoach(req.user!.id); if (!c) throw forbidden();
  const [link] = await db.select({ id: coachingEnrollments.id }).from(coachingEnrollments).innerJoin(coachingSessions, eq(coachingSessions.id, coachingEnrollments.sessionId)).where(and(eq(coachingSessions.coachId, c.id), eq(coachingEnrollments.playerId, b.playerId))).limit(1);
  if (!link) throw forbidden('You can only write notes for your own students');
  const [n] = await db.insert(coachNotes).values({ coachId: c.id, playerId: b.playerId, note: b.note }).returning();
  res.status(201).json({ note: n });
}));
void desc; void ne;
