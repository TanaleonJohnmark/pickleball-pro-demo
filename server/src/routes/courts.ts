import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, gt, gte, inArray, lt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { courts, courtSchedules, courtMaintenance, reservations, users } from '../db/schema.js';
import { ah, parse, notFound, conflict, badRequest } from '../lib/http.js';
import { requireRole, ADMIN, STAFF_UP, isStaff, isAdmin } from '../lib/auth.js';
import { audit, notify } from '../lib/audit.js';
import { availability, ACTIVE_RES } from '../services/booking.js';

export const r = Router();
const hhmm = z.string().regex(/^([01]\d|2[0-4]):[0-5]\d$/, 'Use HH:MM');
const scheduleSchema = z.array(z.object({ dayOfWeek: z.number().int().min(0).max(6), openTime: hhmm, closeTime: hhmm }))
  .refine((a) => a.every((s) => s.openTime < s.closeTime), 'Closing time must be after opening time')
  .refine((a) => new Set(a.map((s) => s.dayOfWeek)).size === a.length, 'Each day can appear only once');
const baseCourt = z.object({
  name: z.string().trim().min(1).max(60),
  location: z.string().trim().min(1).max(120),
  surface: z.string().trim().max(60).default('Hard court'),
  indoor: z.boolean().default(false),
  capacity: z.number().int().min(2).max(8).default(4),
  hourlyPriceCents: z.number().int().min(0).max(10_000_000),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  slotMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]).default(30),
  minDurationMinutes: z.number().int().min(15).max(720).default(60),
  maxDurationMinutes: z.number().int().min(15).max(720).default(180),
  description: z.string().max(1000).nullable().optional(),
  photoUrl: z.string().url().max(500).nullable().optional().or(z.literal('')),
});
const courtSchema = baseCourt.refine((c) => c.maxDurationMinutes >= c.minDurationMinutes, { message: 'Maximum duration must be at least the minimum', path: ['maxDurationMinutes'] })
  .refine((c) => c.minDurationMinutes % c.slotMinutes === 0 && c.maxDurationMinutes % c.slotMinutes === 0, { message: 'Durations must be multiples of the slot length', path: ['minDurationMinutes'] });

r.get('/', ah(async (req, res) => {
  const all = isStaff(req.user) && req.query.all === '1';
  const list = await db.query.courts.findMany({ where: all ? undefined : eq(courts.status, 'ACTIVE'), with: { schedules: { orderBy: asc(courtSchedules.dayOfWeek) } }, orderBy: asc(courts.name) });
  res.json({ courts: list });
}));

r.get('/:id', ah(async (req, res) => {
  const c = await db.query.courts.findFirst({ where: eq(courts.id, req.params.id), with: { schedules: { orderBy: asc(courtSchedules.dayOfWeek) }, maintenance: { where: gt(courtMaintenance.endAt, new Date()), orderBy: asc(courtMaintenance.startAt) } } });
  if (!c || (c.status !== 'ACTIVE' && !isStaff(req.user))) throw notFound('Court');
  res.json({ court: c });
}));

r.get('/:id/availability', ah(async (req, res) => {
  const date = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), req.query).date;
  res.json(await availability(req.params.id, date));
}));

r.get('/:id/reservations', requireRole(...STAFF_UP), ah(async (req, res) => {
  const list = await db.select({ r: reservations, player: users.fullName }).from(reservations).innerJoin(users, eq(users.id, reservations.userId))
    .where(eq(reservations.courtId, req.params.id)).orderBy(desc(reservations.startAt)).limit(200);
  res.json({ reservations: list.map((x) => ({ ...x.r, playerName: x.player })) });
}));

r.post('/', requireRole(...ADMIN), ah(async (req, res) => {
  const b = { ...parse(courtSchema, req.body), schedules: parse(scheduleSchema.default([]), req.body.schedules) };
  const court = await db.transaction(async (tx) => {
    const { schedules, ...data } = b;
    const [c] = await tx.insert(courts).values({ ...data, photoUrl: data.photoUrl || null }).returning();
    if (schedules.length) await tx.insert(courtSchedules).values(schedules.map((s) => ({ ...s, courtId: c.id })));
    await audit(req, 'court.create', 'court', c.id, { name: c.name }, tx);
    return c;
  });
  res.status(201).json({ court });
}));

r.patch('/:id', requireRole(...STAFF_UP), ah(async (req, res) => {
  // Staff may only switch availability; everything else is admin-only.
  const b: Partial<z.infer<typeof baseCourt>> = isAdmin(req.user) ? parse(baseCourt.partial(), req.body)
    : parse(z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) }).strict(), req.body);
  const [c] = await db.update(courts).set({ ...b, ...(b.photoUrl === '' && { photoUrl: null }) }).where(eq(courts.id, req.params.id)).returning();
  if (!c) throw notFound('Court');
  if (c.maxDurationMinutes < c.minDurationMinutes) throw badRequest('Maximum duration must be at least the minimum');
  await audit(req, 'court.update', 'court', c.id, b);
  res.json({ court: c });
}));

r.put('/:id/schedules', requireRole(...ADMIN), ah(async (req, res) => {
  const schedules = parse(scheduleSchema, req.body.schedules);
  await db.transaction(async (tx) => {
    await tx.delete(courtSchedules).where(eq(courtSchedules.courtId, req.params.id));
    if (schedules.length) await tx.insert(courtSchedules).values(schedules.map((s) => ({ ...s, courtId: req.params.id })));
    await audit(req, 'court.schedule', 'court', req.params.id, schedules, tx);
  });
  res.json({ ok: true });
}));

r.post('/:id/maintenance', requireRole(...ADMIN), ah(async (req, res) => {
  const b = parse(z.object({ startAt: z.coerce.date(), endAt: z.coerce.date(), reason: z.string().trim().min(2).max(200), cancelConflicts: z.boolean().default(false) })
    .refine((x) => x.endAt > x.startAt, 'End must be after start'), req.body);
  const result = await db.transaction(async (tx) => {
    const hits = await tx.select().from(reservations).where(and(eq(reservations.courtId, req.params.id), inArray(reservations.status, [...ACTIVE_RES]), lt(reservations.startAt, b.endAt), gt(reservations.endAt, b.startAt)));
    if (hits.length && !b.cancelConflicts) throw conflict(`${hits.length} booking(s) fall inside this window. Confirm to cancel them and notify the players.`);
    for (const h of hits) {
      await tx.update(reservations).set({ status: 'CANCELLED', cancelledAt: new Date(), cancelReason: `Court maintenance: ${b.reason}` }).where(eq(reservations.id, h.id));
      await notify(h.userId, { type: 'BOOKING_CANCELLED', title: `Booking ${h.reference} cancelled`, body: `The court is closed for maintenance (${b.reason}). ${h.paymentStatus === 'PAID' ? 'The front desk will process your refund.' : ''}`, link: `/app/reservations/${h.id}` }, tx);
    }
    const [m] = await tx.insert(courtMaintenance).values({ courtId: req.params.id, startAt: b.startAt, endAt: b.endAt, reason: b.reason }).returning();
    await audit(req, 'court.maintenance', 'court', req.params.id, { ...b, cancelled: hits.map((h) => h.reference) }, tx);
    return { maintenance: m, cancelled: hits.length };
  });
  res.status(201).json(result);
}));

r.delete('/maintenance/:mid', requireRole(...ADMIN), ah(async (req, res) => {
  const [m] = await db.delete(courtMaintenance).where(eq(courtMaintenance.id, req.params.mid)).returning();
  if (!m) throw notFound('Maintenance window');
  await audit(req, 'court.maintenance_remove', 'court', m.courtId, m);
  res.json({ ok: true });
}));

r.get('/:id/maintenance', requireRole(...STAFF_UP), ah(async (req, res) => {
  res.json({ maintenance: await db.select().from(courtMaintenance).where(and(eq(courtMaintenance.courtId, req.params.id), gte(courtMaintenance.endAt, new Date(Date.now() - 30 * 86400000)))).orderBy(asc(courtMaintenance.startAt)) });
}));
