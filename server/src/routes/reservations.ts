import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, gte, ilike, inArray, lt, or, gt, count, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { reservations, reservationParticipants, courts, users, matches, coachingSessions, courtMaintenance, coaches, payments } from '../db/schema.js';
import { ah, parse, notFound, forbidden, badRequest, paging } from '../lib/http.js';
import { requireAuth, requireRole, STAFF_UP, isStaff } from '../lib/auth.js';
import { audit, notify } from '../lib/audit.js';
import { reference } from '../lib/ids.js';
import { quote, courtConflicts } from '../services/booking.js';
import { getSettings } from '../services/settings.js';
import { localParts } from '../lib/time.js';

export const r = Router();
r.use(requireAuth);

const bookingSchema = z.object({
  courtId: z.string().uuid(),
  startAt: z.coerce.date(),
  durationMinutes: z.number().int().min(15).max(720),
  participants: z.number().int().min(1).max(8),
  userId: z.string().uuid().optional(), // staff booking on behalf of a player / walk-in
  guests: z.array(z.object({ name: z.string().trim().min(1).max(80), email: z.string().email().optional().or(z.literal('')) })).max(7).default([]),
  notes: z.string().max(500).optional(),
});

function ownerFor(req: Express.Request, requested?: string) {
  if (requested && requested !== req.user!.id) {
    if (!isStaff(req.user)) throw forbidden('Only staff can book for another player');
    return requested;
  }
  return req.user!.id;
}

const fmt = (d: Date) => { const p = localParts(d); const h = Math.floor(p.minutes / 60), m = p.minutes % 60; return `${p.ymd} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };

r.post('/quote', ah(async (req, res) => {
  const b = parse(bookingSchema, req.body);
  const userId = ownerFor(req, b.userId);
  const q = await quote({ ...b, userId, actorIsStaff: isStaff(req.user) });
  res.json({ courtName: q.court.name, startAt: q.startAt, endAt: q.endAt, basePriceCents: q.basePriceCents, discountCents: q.discountCents, totalPriceCents: q.totalPriceCents, discountReason: q.discountReason });
}));

r.post('/', ah(async (req, res) => {
  const b = parse(bookingSchema, req.body);
  const userId = ownerFor(req, b.userId);
  const [owner] = await db.select().from(users).where(eq(users.id, userId));
  if (!owner || owner.status !== 'ACTIVE') throw badRequest('That player account is not active');
  if (b.guests.length > b.participants - 1) throw badRequest('List at most one guest per extra participant');
  const created = await db.transaction(async (tx) => {
    // Serialize bookings per court: concurrent requests for the same court wait here.
    await tx.select({ id: courts.id }).from(courts).where(eq(courts.id, b.courtId)).for('update');
    const q = await quote({ ...b, userId, actorIsStaff: isStaff(req.user) }, tx);
    const [row] = await tx.insert(reservations).values({
      reference: reference('PB'), userId, courtId: b.courtId, createdById: req.user!.id,
      startAt: q.startAt, endAt: q.endAt, participants: b.participants,
      basePriceCents: q.basePriceCents, discountCents: q.discountCents, totalPriceCents: q.totalPriceCents,
      status: q.totalPriceCents === 0 ? 'CONFIRMED' : 'PENDING', paymentStatus: q.totalPriceCents === 0 ? 'PAID' : 'UNPAID', notes: b.notes,
    }).returning(); // the DB exclusion constraint is the final guard against overlaps
    if (b.guests.length) await tx.insert(reservationParticipants).values(b.guests.map((g) => ({ reservationId: row.id, name: g.name, email: g.email || null })));
    await notify(userId, { type: 'BOOKING_CREATED', title: `Booking ${row.reference} received`, body: `${q.court.name}, ${fmt(q.startAt)}. ${row.status === 'CONFIRMED' ? 'Confirmed.' : 'Pay at the front desk to confirm it.'}`, link: `/app/reservations/${row.id}` }, tx);
    await audit(req, 'reservation.create', 'reservation', row.id, { reference: row.reference, onBehalf: userId !== req.user!.id }, tx);
    return row;
  });
  res.status(201).json({ reservation: created });
}));

r.get('/', ah(async (req, res) => {
  const qs = parse(z.object({ status: z.string().optional(), courtId: z.string().uuid().optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(), q: z.string().max(80).optional(), scope: z.enum(['upcoming', 'past', 'all']).default('all') }), req.query);
  const { page, pageSize, offset } = paging(req.query);
  const w: SQL[] = [];
  if (!isStaff(req.user)) w.push(eq(reservations.userId, req.user!.id));
  if (qs.status) w.push(inArray(reservations.status, qs.status.split(',') as any));
  if (qs.courtId) w.push(eq(reservations.courtId, qs.courtId));
  if (qs.from) w.push(gte(reservations.startAt, qs.from));
  if (qs.to) w.push(lt(reservations.startAt, qs.to));
  if (qs.scope === 'upcoming') w.push(gte(reservations.endAt, new Date()));
  if (qs.scope === 'past') w.push(lt(reservations.endAt, new Date()));
  if (qs.q && isStaff(req.user)) w.push(or(ilike(reservations.reference, `%${qs.q}%`), ilike(users.fullName, `%${qs.q}%`))!);
  const where = w.length ? and(...w) : undefined;
  const [rows, [{ total }]] = await Promise.all([
    db.select({ r: reservations, court: courts.name, player: users.fullName, email: users.email }).from(reservations)
      .innerJoin(courts, eq(courts.id, reservations.courtId)).innerJoin(users, eq(users.id, reservations.userId))
      .where(where).orderBy(qs.scope === 'upcoming' ? asc(reservations.startAt) : desc(reservations.startAt)).limit(pageSize).offset(offset),
    db.select({ total: count() }).from(reservations).innerJoin(users, eq(users.id, reservations.userId)).where(where),
  ]);
  res.json({ items: rows.map((x) => ({ ...x.r, courtName: x.court, playerName: x.player, playerEmail: isStaff(req.user) ? x.email : undefined })), total, page, pageSize });
}));

/** Everything occupying courts in a window — powers the admin calendar. */
r.get('/calendar', requireRole(...STAFF_UP), ah(async (req, res) => {
  const { from, to } = parse(z.object({ from: z.coerce.date(), to: z.coerce.date() }).refine((x) => x.to > x.from && x.to.getTime() - x.from.getTime() <= 45 * 86400000, 'Range must be positive and at most 45 days'), req.query);
  const [res_, m, c, mt] = await Promise.all([
    db.select({ id: reservations.id, ref: reservations.reference, courtId: reservations.courtId, startAt: reservations.startAt, endAt: reservations.endAt, status: reservations.status, paymentStatus: reservations.paymentStatus, who: users.fullName })
      .from(reservations).innerJoin(users, eq(users.id, reservations.userId))
      .where(and(lt(reservations.startAt, to), gt(reservations.endAt, from), inArray(reservations.status, ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW']))),
    db.select({ id: matches.id, courtId: matches.courtId, startAt: matches.startAt, endAt: matches.endAt, status: matches.status, format: matches.format }).from(matches).where(and(lt(matches.startAt, to), gt(matches.endAt, from), inArray(matches.status, ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED']))),
    db.select({ id: coachingSessions.id, courtId: coachingSessions.courtId, startAt: coachingSessions.startAt, endAt: coachingSessions.endAt, title: coachingSessions.title, coach: users.fullName })
      .from(coachingSessions).innerJoin(coaches, eq(coaches.id, coachingSessions.coachId)).innerJoin(users, eq(users.id, coaches.userId))
      .where(and(lt(coachingSessions.startAt, to), gt(coachingSessions.endAt, from), eq(coachingSessions.status, 'SCHEDULED'))),
    db.select().from(courtMaintenance).where(and(lt(courtMaintenance.startAt, to), gt(courtMaintenance.endAt, from))),
  ]);
  const events = [
    ...res_.map((x) => ({ kind: 'reservation', id: x.id, courtId: x.courtId, startAt: x.startAt, endAt: x.endAt, title: `${x.who} · ${x.ref}`, status: x.status, paymentStatus: x.paymentStatus })),
    ...m.filter((x) => x.courtId).map((x) => ({ kind: 'match', id: x.id, courtId: x.courtId, startAt: x.startAt, endAt: x.endAt, title: `${x.format === 'SINGLES' ? 'Singles' : 'Doubles'} match`, status: x.status })),
    ...c.filter((x) => x.courtId).map((x) => ({ kind: 'coaching', id: x.id, courtId: x.courtId, startAt: x.startAt, endAt: x.endAt, title: `${x.title} (${x.coach})`, status: 'SCHEDULED' })),
    ...mt.map((x) => ({ kind: 'maintenance', id: x.id, courtId: x.courtId, startAt: x.startAt, endAt: x.endAt, title: `Maintenance: ${x.reason}`, status: 'CLOSED' })),
  ];
  res.json({ events });
}));

async function loadOwned(req: Express.Request, id: string) {
  const row = await db.query.reservations.findFirst({ where: eq(reservations.id, id), with: { court: true, guests: true, user: { columns: { id: true, fullName: true, email: true, phone: true } } } });
  if (!row) throw notFound('Reservation');
  if (!isStaff(req.user) && row.userId !== req.user!.id) throw notFound('Reservation');
  return row;
}

r.get('/:id', ah(async (req, res) => {
  const row = await loadOwned(req, req.params.id);
  const pays = await db.select().from(payments).where(eq(payments.reservationId, row.id)).orderBy(desc(payments.paidAt));
  const settings = await getSettings();
  const cancellable = ['PENDING', 'CONFIRMED'].includes(row.status) && (isStaff(req.user) || row.startAt.getTime() - Date.now() >= settings.cancellationHours * 3600000);
  res.json({ reservation: { ...row, payments: pays }, cancellable, cancellationHours: settings.cancellationHours });
}));

r.post('/:id/cancel', ah(async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().max(200).optional() }), req.body);
  const row = await loadOwned(req, req.params.id);
  if (!['PENDING', 'CONFIRMED'].includes(row.status)) throw badRequest(`A ${row.status.toLowerCase().replace('_', ' ')} booking cannot be cancelled`);
  const settings = await getSettings();
  if (!isStaff(req.user) && row.startAt.getTime() - Date.now() < settings.cancellationHours * 3600000)
    throw badRequest(`Bookings can be cancelled online up to ${settings.cancellationHours} hours before start. Contact the front desk.`);
  await db.transaction(async (tx) => {
    await tx.update(reservations).set({ status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason || (isStaff(req.user) && row.userId !== req.user!.id ? 'Cancelled by staff' : 'Cancelled by player') }).where(eq(reservations.id, row.id));
    await notify(row.userId, { type: 'BOOKING_CANCELLED', title: `Booking ${row.reference} cancelled`, body: row.paymentStatus === 'PAID' ? 'Your payment will be refunded by the front desk according to the club policy.' : 'Your court time has been released.', link: `/app/reservations/${row.id}` }, tx);
    await audit(req, 'reservation.cancel', 'reservation', row.id, { reason }, tx);
  });
  res.json({ ok: true });
}));

const transitions: Record<string, string[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['CHECKED_IN', 'NO_SHOW', 'CANCELLED'],
  CHECKED_IN: ['COMPLETED'],
};
r.post('/:id/status', requireRole(...STAFF_UP), ah(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW']) }), req.body);
  const row = await loadOwned(req, req.params.id);
  if (!transitions[row.status]?.includes(status)) throw badRequest(`Cannot move a booking from ${row.status} to ${status}`);
  if (status === 'CHECKED_IN' && row.paymentStatus !== 'PAID') throw badRequest('Record the payment before checking the player in');
  await db.update(reservations).set({ status, ...(status === 'CHECKED_IN' && { checkedInAt: new Date() }) }).where(eq(reservations.id, row.id));
  if (status === 'CONFIRMED') await notify(row.userId, { type: 'BOOKING_CONFIRMED', title: `Booking ${row.reference} confirmed`, body: `${row.court.name}, ${fmt(row.startAt)}.`, link: `/app/reservations/${row.id}` });
  await audit(req, `reservation.${status.toLowerCase()}`, 'reservation', row.id);
  res.json({ ok: true });
}));

/** Reschedule (staff, or the owner while still pending/confirmed and outside the cancellation window). */
r.post('/:id/reschedule', ah(async (req, res) => {
  const b = parse(z.object({ startAt: z.coerce.date(), durationMinutes: z.number().int(), courtId: z.string().uuid().optional() }), req.body);
  const row = await loadOwned(req, req.params.id);
  if (!['PENDING', 'CONFIRMED'].includes(row.status)) throw badRequest('Only upcoming bookings can be moved');
  const settings = await getSettings();
  if (!isStaff(req.user) && row.startAt.getTime() - Date.now() < settings.cancellationHours * 3600000) throw badRequest(`Changes are allowed up to ${settings.cancellationHours} hours before start`);
  const courtId = b.courtId ?? row.courtId;
  const updated = await db.transaction(async (tx) => {
    await tx.select({ id: courts.id }).from(courts).where(eq(courts.id, courtId)).for('update');
    const q = await quote({ courtId, startAt: b.startAt, durationMinutes: b.durationMinutes, participants: row.participants, userId: row.userId, actorIsStaff: isStaff(req.user), ignoreReservationId: row.id }, tx);
    if (row.paymentStatus === 'PAID' && q.totalPriceCents !== row.totalPriceCents) throw badRequest('This booking is paid; the new time must cost the same. Ask the front desk to adjust it.');
    const [u] = await tx.update(reservations).set({ courtId, startAt: q.startAt, endAt: q.endAt, basePriceCents: q.basePriceCents, discountCents: q.discountCents, totalPriceCents: q.totalPriceCents }).where(eq(reservations.id, row.id)).returning();
    await notify(row.userId, { type: 'BOOKING_UPDATED', title: `Booking ${row.reference} moved`, body: `New time: ${q.court.name}, ${fmt(q.startAt)}.`, link: `/app/reservations/${row.id}` }, tx);
    await audit(req, 'reservation.reschedule', 'reservation', row.id, { from: row.startAt, to: q.startAt, courtId }, tx);
    return u;
  });
  res.json({ reservation: updated });
}));

export { courtConflicts };
