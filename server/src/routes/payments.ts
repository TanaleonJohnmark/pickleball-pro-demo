import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, gte, lt, inArray, sum, count, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { payments, refunds, reservations, memberships, membershipPlans, tournamentRegistrations, tournaments, coachingEnrollments, coachingSessions, users, courts } from '../db/schema.js';
import { ah, parse, notFound, badRequest, paging } from '../lib/http.js';
import { requireAuth, requireRole, STAFF_UP, ADMIN, isStaff } from '../lib/auth.js';
import { audit, notify } from '../lib/audit.js';
import { reference } from '../lib/ids.js';
import { activateMembership } from '../services/membership.js';
import { getSettings } from '../services/settings.js';

export const r = Router();
r.use(requireAuth);

/**
 * Record a payment. The amount due is computed on the server from the item
 * being paid for — the client never decides the price. Online provider
 * payments must arrive through a verified provider webhook (see README); this
 * endpoint is for cash and manually verified transfers.
 */
r.post('/', requireRole(...STAFF_UP), ah(async (req, res) => {
  const b = parse(z.object({
    purpose: z.enum(['RESERVATION', 'MEMBERSHIP', 'TOURNAMENT', 'COACHING', 'OTHER']),
    targetId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),
    amountCents: z.number().int().positive().optional(), // only for OTHER
    method: z.enum(['CASH', 'GCASH_MANUAL', 'BANK_TRANSFER', 'CARD_TERMINAL']),
    externalRef: z.string().trim().max(80).optional(),
    notes: z.string().trim().max(300).optional(),
  }), req.body);
  if (b.method !== 'CASH' && !b.externalRef) throw badRequest('Enter the transaction reference for non-cash payments');
  const out = await db.transaction(async (tx) => {
    let userId: string, amount: number, link: Partial<typeof payments.$inferInsert> = {}, label = '';
    if (b.purpose === 'OTHER') {
      if (!b.userId || !b.amountCents) throw badRequest('Choose the player and enter an amount');
      userId = b.userId; amount = b.amountCents; label = b.notes || 'Other charge';
    } else {
      if (!b.targetId) throw badRequest('Choose what is being paid for');
      if (b.purpose === 'RESERVATION') {
        const [x] = await tx.select().from(reservations).where(eq(reservations.id, b.targetId)).for('update');
        if (!x) throw notFound('Reservation');
        if (x.paymentStatus === 'PAID') throw badRequest('This booking is already paid');
        if (['CANCELLED', 'NO_SHOW'].includes(x.status)) throw badRequest('This booking is closed');
        userId = x.userId; amount = x.totalPriceCents; link = { reservationId: x.id }; label = `Court booking ${x.reference}`;
        await tx.update(reservations).set({ paymentStatus: 'PAID', ...(x.status === 'PENDING' && { status: 'CONFIRMED' }) }).where(eq(reservations.id, x.id));
      } else if (b.purpose === 'MEMBERSHIP') {
        const [x] = await tx.select({ m: memberships, plan: membershipPlans.name }).from(memberships).innerJoin(membershipPlans, eq(membershipPlans.id, memberships.planId)).where(eq(memberships.id, b.targetId)).for('update');
        if (!x) throw notFound('Membership');
        if (x.m.status !== 'PENDING') throw badRequest('This membership is not awaiting payment');
        userId = x.m.userId; amount = x.m.priceCents; link = { membershipId: x.m.id }; label = `${x.plan} membership`;
        await activateMembership(tx, x.m.id);
      } else if (b.purpose === 'TOURNAMENT') {
        const [x] = await tx.select({ reg: tournamentRegistrations, fee: tournaments.feeCents, name: tournaments.name }).from(tournamentRegistrations).innerJoin(tournaments, eq(tournaments.id, tournamentRegistrations.tournamentId)).where(eq(tournamentRegistrations.id, b.targetId)).for('update');
        if (!x) throw notFound('Registration');
        if (x.reg.paymentStatus === 'PAID') throw badRequest('This entry fee is already paid');
        userId = x.reg.userId; amount = x.fee; link = { tournamentRegistrationId: x.reg.id }; label = `${x.name} entry fee`;
        if (amount <= 0) throw badRequest('This tournament has no fee');
        await tx.update(tournamentRegistrations).set({ paymentStatus: 'PAID' }).where(eq(tournamentRegistrations.id, x.reg.id));
      } else {
        const [x] = await tx.select({ e: coachingEnrollments, price: coachingSessions.priceCents, title: coachingSessions.title }).from(coachingEnrollments).innerJoin(coachingSessions, eq(coachingSessions.id, coachingEnrollments.sessionId)).where(eq(coachingEnrollments.id, b.targetId)).for('update');
        if (!x) throw notFound('Coaching enrollment');
        if (x.e.paymentStatus === 'PAID') throw badRequest('Already paid');
        userId = x.e.playerId; amount = x.price; link = { coachingEnrollmentId: x.e.id }; label = `Coaching: ${x.title}`;
        if (amount <= 0) throw badRequest('This session is free');
        await tx.update(coachingEnrollments).set({ paymentStatus: 'PAID' }).where(eq(coachingEnrollments.id, x.e.id));
      }
    }
    const [p] = await tx.insert(payments).values({ reference: reference('RC'), userId, amountCents: amount, method: b.method, purpose: b.purpose, status: 'PAID', externalRef: b.externalRef, notes: b.notes ?? label, recordedById: req.user!.id, ...link }).returning();
    await notify(userId, { type: 'PAYMENT', title: 'Payment received', body: `${label}: ₱${(amount / 100).toFixed(2)}. Receipt ${p.reference}.`, link: `/app/payments/${p.id}` }, tx);
    await audit(req, 'payment.record', 'payment', p.id, { purpose: b.purpose, amount, method: b.method }, tx);
    return p;
  });
  res.status(201).json({ payment: out });
}));

r.get('/', ah(async (req, res) => {
  const q = parse(z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional(), purpose: z.string().optional(), method: z.string().optional(), status: z.string().optional() }), req.query);
  const { page, pageSize, offset } = paging(req.query);
  const w: SQL[] = [];
  if (!isStaff(req.user)) w.push(eq(payments.userId, req.user!.id));
  if (q.from) w.push(gte(payments.paidAt, q.from));
  if (q.to) w.push(lt(payments.paidAt, q.to));
  if (q.purpose) w.push(inArray(payments.purpose, q.purpose.split(',') as any));
  if (q.method) w.push(inArray(payments.method, q.method.split(',') as any));
  if (q.status) w.push(inArray(payments.status, q.status.split(',') as any));
  const where = w.length ? and(...w) : undefined;
  const rows = await db.select({ p: payments, player: users.fullName }).from(payments).innerJoin(users, eq(users.id, payments.userId)).where(where).orderBy(desc(payments.paidAt)).limit(pageSize).offset(offset);
  const [agg] = await db.select({ total: count(), sum: sum(payments.amountCents) }).from(payments).where(where);
  res.json({ items: rows.map((x) => ({ ...x.p, playerName: x.player })), total: agg.total, sumCents: Number(agg.sum ?? 0), page, pageSize });
}));

/** Things awaiting payment, for the front desk. */
r.get('/outstanding', requireRole(...STAFF_UP), ah(async (_req, res) => {
  const [res_, mem, regs, coach] = await Promise.all([
    db.select({ id: reservations.id, ref: reservations.reference, amount: reservations.totalPriceCents, player: users.fullName, userId: users.id, when: reservations.startAt, court: courts.name }).from(reservations).innerJoin(users, eq(users.id, reservations.userId)).innerJoin(courts, eq(courts.id, reservations.courtId)).where(and(eq(reservations.paymentStatus, 'UNPAID'), inArray(reservations.status, ['PENDING', 'CONFIRMED', 'CHECKED_IN']))).orderBy(reservations.startAt).limit(100),
    db.select({ id: memberships.id, amount: memberships.priceCents, player: users.fullName, userId: users.id, plan: membershipPlans.name }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).innerJoin(membershipPlans, eq(membershipPlans.id, memberships.planId)).where(eq(memberships.status, 'PENDING')).limit(100),
    db.select({ id: tournamentRegistrations.id, amount: tournaments.feeCents, player: users.fullName, userId: users.id, name: tournaments.name }).from(tournamentRegistrations).innerJoin(users, eq(users.id, tournamentRegistrations.userId)).innerJoin(tournaments, eq(tournaments.id, tournamentRegistrations.tournamentId)).where(and(eq(tournamentRegistrations.paymentStatus, 'UNPAID'), inArray(tournaments.status, ['OPEN', 'IN_PROGRESS']))).limit(100),
    db.select({ id: coachingEnrollments.id, amount: coachingSessions.priceCents, player: users.fullName, userId: users.id, title: coachingSessions.title }).from(coachingEnrollments).innerJoin(users, eq(users.id, coachingEnrollments.playerId)).innerJoin(coachingSessions, eq(coachingSessions.id, coachingEnrollments.sessionId)).where(and(eq(coachingEnrollments.paymentStatus, 'UNPAID'), eq(coachingSessions.status, 'SCHEDULED'))).limit(100),
  ]);
  res.json({ items: [
    ...res_.map((x) => ({ purpose: 'RESERVATION', targetId: x.id, amountCents: x.amount, playerName: x.player, userId: x.userId, label: `${x.court} · ${x.ref}`, date: x.when })),
    ...mem.map((x) => ({ purpose: 'MEMBERSHIP', targetId: x.id, amountCents: x.amount, playerName: x.player, userId: x.userId, label: `${x.plan} membership` })),
    ...regs.filter((x) => x.amount > 0).map((x) => ({ purpose: 'TOURNAMENT', targetId: x.id, amountCents: x.amount, playerName: x.player, userId: x.userId, label: `${x.name} entry` })),
    ...coach.filter((x) => x.amount > 0).map((x) => ({ purpose: 'COACHING', targetId: x.id, amountCents: x.amount, playerName: x.player, userId: x.userId, label: `Coaching: ${x.title}` })),
  ] });
}));

r.get('/:id', ah(async (req, res) => {
  const [x] = await db.select({ p: payments, player: users.fullName, email: users.email }).from(payments).innerJoin(users, eq(users.id, payments.userId)).where(eq(payments.id, req.params.id));
  if (!x || (!isStaff(req.user) && x.p.userId !== req.user!.id)) throw notFound('Payment');
  const [rec] = await db.select({ name: users.fullName }).from(users).where(eq(users.id, x.p.recordedById));
  const rf = await db.select().from(refunds).where(eq(refunds.paymentId, x.p.id));
  const s = await getSettings();
  res.json({ payment: { ...x.p, playerName: x.player, playerEmail: x.email, recordedByName: rec?.name, refunds: rf }, club: { name: s.clubName, address: s.address, phone: s.contactPhone, email: s.contactEmail } });
}));

r.post('/:id/refund', requireRole(...ADMIN), ah(async (req, res) => {
  const b = parse(z.object({ amountCents: z.number().int().positive(), reason: z.string().trim().min(3).max(300) }), req.body);
  const out = await db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, req.params.id)).for('update');
    if (!p) throw notFound('Payment');
    if (p.status !== 'PAID') throw badRequest('Only paid payments can be refunded');
    const [{ done }] = await tx.select({ done: sum(refunds.amountCents) }).from(refunds).where(eq(refunds.paymentId, p.id));
    const remaining = p.amountCents - Number(done ?? 0);
    if (b.amountCents > remaining) throw badRequest(`At most ₱${(remaining / 100).toFixed(2)} can still be refunded`);
    const [rf] = await tx.insert(refunds).values({ paymentId: p.id, amountCents: b.amountCents, reason: b.reason, processedById: req.user!.id }).returning();
    if (b.amountCents === remaining) {
      await tx.update(payments).set({ status: 'REFUNDED' }).where(eq(payments.id, p.id));
      if (p.reservationId) await tx.update(reservations).set({ paymentStatus: 'REFUNDED' }).where(eq(reservations.id, p.reservationId));
      if (p.tournamentRegistrationId) await tx.update(tournamentRegistrations).set({ paymentStatus: 'REFUNDED' }).where(eq(tournamentRegistrations.id, p.tournamentRegistrationId));
      if (p.coachingEnrollmentId) await tx.update(coachingEnrollments).set({ paymentStatus: 'REFUNDED' }).where(eq(coachingEnrollments.id, p.coachingEnrollmentId));
      if (p.membershipId) await tx.update(memberships).set({ status: 'CANCELLED' }).where(eq(memberships.id, p.membershipId));
    }
    await notify(p.userId, { type: 'REFUND', title: 'Refund processed', body: `₱${(b.amountCents / 100).toFixed(2)} refunded for receipt ${p.reference}.`, link: `/app/payments/${p.id}` }, tx);
    await audit(req, 'payment.refund', 'payment', p.id, b, tx);
    return rf;
  });
  res.status(201).json({ refund: out });
}));
