/**
 * Court reservation rules. Every rule is enforced here on the server; the
 * client only previews. Prices are always computed server-side.
 */
import { and, eq, gt, lt, inArray, ne, count, gte } from 'drizzle-orm';
import { db, type Tx } from '../db/index.js';
import { courts, courtSchedules, courtMaintenance, reservations, matches, coachingSessions } from '../db/schema.js';
import { badRequest, conflict, notFound } from '../lib/http.js';
import { localParts, toMinutes, addMinutes } from '../lib/time.js';
import { currentMembership } from './membership.js';
import { getSettings } from './settings.js';

export const ACTIVE_RES = ['PENDING', 'CONFIRMED', 'CHECKED_IN'] as const;

export interface BookingInput { courtId: string; startAt: Date; durationMinutes: number; participants: number; userId: string; actorIsStaff: boolean; ignoreReservationId?: string }

/** Anything already occupying the court in [start, end). */
export async function courtConflicts(q: Tx | typeof db, courtId: string, start: Date, end: Date, ignoreReservationId?: string, ignoreMatchId?: string) {
  const resWhere = [eq(reservations.courtId, courtId), inArray(reservations.status, [...ACTIVE_RES]), lt(reservations.startAt, end), gt(reservations.endAt, start)];
  if (ignoreReservationId) resWhere.push(ne(reservations.id, ignoreReservationId));
  const matchWhere = [eq(matches.courtId, courtId), inArray(matches.status, ['SCHEDULED', 'IN_PROGRESS']), lt(matches.startAt, end), gt(matches.endAt, start)];
  if (ignoreMatchId) matchWhere.push(ne(matches.id, ignoreMatchId));
  const [r, m, c, mt] = await Promise.all([
    q.select({ id: reservations.id }).from(reservations).where(and(...resWhere)).limit(1),
    q.select({ id: matches.id }).from(matches).where(and(...matchWhere)).limit(1),
    q.select({ id: coachingSessions.id }).from(coachingSessions).where(and(eq(coachingSessions.courtId, courtId), eq(coachingSessions.status, 'SCHEDULED'), lt(coachingSessions.startAt, end), gt(coachingSessions.endAt, start))).limit(1),
    q.select({ id: courtMaintenance.id, reason: courtMaintenance.reason }).from(courtMaintenance).where(and(eq(courtMaintenance.courtId, courtId), lt(courtMaintenance.startAt, end), gt(courtMaintenance.endAt, start))).limit(1),
  ]);
  if (mt.length) return `The court is closed for maintenance (${mt[0].reason}) during that time.`;
  if (r.length) return 'That time overlaps an existing booking on this court.';
  if (m.length) return 'A match is scheduled on this court during that time.';
  if (c.length) return 'A coaching session is using this court during that time.';
  return null;
}

/** Validates hours/duration and returns the club-local schedule check result. */
export async function checkOpeningHours(q: Tx | typeof db, courtId: string, start: Date, end: Date) {
  const s = localParts(start), e = localParts(addMinutes(end, -1));
  if (s.ymd !== e.ymd) throw badRequest('A booking must start and end on the same day.');
  const [sched] = await q.select().from(courtSchedules).where(and(eq(courtSchedules.courtId, courtId), eq(courtSchedules.dayOfWeek, s.dow)));
  if (!sched) throw badRequest('The court is closed on that day.');
  const startMin = s.minutes, endMin = startMin + (end.getTime() - start.getTime()) / 60000;
  if (startMin < toMinutes(sched.openTime) || endMin > toMinutes(sched.closeTime))
    throw badRequest(`That day the court is open ${sched.openTime}–${sched.closeTime}.`);
}

export async function quote(input: BookingInput, q: Tx | typeof db = db) {
  const [court] = await q.select().from(courts).where(eq(courts.id, input.courtId));
  if (!court) throw notFound('Court');
  if (court.status !== 'ACTIVE') throw badRequest('This court is not accepting bookings right now.');
  const d = input.durationMinutes;
  if (!Number.isInteger(d) || d < court.minDurationMinutes || d > court.maxDurationMinutes)
    throw badRequest(`Bookings on ${court.name} must be ${court.minDurationMinutes}–${court.maxDurationMinutes} minutes.`);
  if (d % court.slotMinutes) throw badRequest(`Duration must be in steps of ${court.slotMinutes} minutes.`);
  if (localParts(input.startAt).minutes % court.slotMinutes) throw badRequest(`Start time must be on a ${court.slotMinutes}-minute mark.`);
  if (input.participants < 1 || input.participants > court.capacity) throw badRequest(`This court allows 1–${court.capacity} players.`);
  const start = input.startAt, end = addMinutes(start, d);
  const now = new Date();
  // staff may register a walk-in that starts within the current slot
  const grace = input.actorIsStaff ? court.slotMinutes : 0;
  if (start < addMinutes(now, -grace)) throw badRequest('That time has already passed.');

  const settings = await getSettings();
  const member = await currentMembership(input.userId, now, q as Tx);
  if (!input.actorIsStaff) {
    const days = member?.plan.advanceBookingDays ?? settings.defaultAdvanceBookingDays;
    if (start > new Date(now.getTime() + days * 86400000)) throw badRequest(`You can book up to ${days} days ahead.`);
    const max = member?.plan.maxActiveBookings ?? settings.defaultMaxActiveBookings;
    const [{ n }] = await q.select({ n: count() }).from(reservations)
      .where(and(eq(reservations.userId, input.userId), inArray(reservations.status, ['PENDING', 'CONFIRMED']), gte(reservations.endAt, now),
        ...(input.ignoreReservationId ? [ne(reservations.id, input.ignoreReservationId)] : [])));
    if (n >= max) throw badRequest(`You already have ${n} upcoming booking(s); your limit is ${max}.`);
  }
  await checkOpeningHours(q, court.id, start, end);
  const why = await courtConflicts(q, court.id, start, end, input.ignoreReservationId);
  if (why) throw conflict(why);

  const basePriceCents = Math.round((court.hourlyPriceCents * d) / 60);
  const pct = member?.plan.discountPercent ?? 0;
  const discountCents = Math.round((basePriceCents * pct) / 100);
  return {
    court, startAt: start, endAt: end, basePriceCents, discountCents, totalPriceCents: basePriceCents - discountCents,
    discountReason: pct ? `${member!.plan.name} member discount (${pct}%)` : null,
  };
}

/** Free slots for a court on a club-local day (used by the booking UI). */
export async function availability(courtId: string, ymd: string) {
  const { localToUtc } = await import('../lib/time.js');
  const [court] = await db.select().from(courts).where(eq(courts.id, courtId));
  if (!court) throw notFound('Court');
  const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  const [sched] = await db.select().from(courtSchedules).where(and(eq(courtSchedules.courtId, courtId), eq(courtSchedules.dayOfWeek, dow)));
  if (!sched || court.status !== 'ACTIVE') return { open: false, slots: [] as { start: string; available: boolean }[] };
  const dayStart = localToUtc(ymd, sched.openTime), dayEnd = localToUtc(ymd, sched.closeTime);
  const busy = await Promise.all([
    db.select({ s: reservations.startAt, e: reservations.endAt }).from(reservations).where(and(eq(reservations.courtId, courtId), inArray(reservations.status, [...ACTIVE_RES]), lt(reservations.startAt, dayEnd), gt(reservations.endAt, dayStart))),
    db.select({ s: matches.startAt, e: matches.endAt }).from(matches).where(and(eq(matches.courtId, courtId), inArray(matches.status, ['SCHEDULED', 'IN_PROGRESS']), lt(matches.startAt, dayEnd), gt(matches.endAt, dayStart))),
    db.select({ s: coachingSessions.startAt, e: coachingSessions.endAt }).from(coachingSessions).where(and(eq(coachingSessions.courtId, courtId), eq(coachingSessions.status, 'SCHEDULED'), lt(coachingSessions.startAt, dayEnd), gt(coachingSessions.endAt, dayStart))),
    db.select({ s: courtMaintenance.startAt, e: courtMaintenance.endAt }).from(courtMaintenance).where(and(eq(courtMaintenance.courtId, courtId), lt(courtMaintenance.startAt, dayEnd), gt(courtMaintenance.endAt, dayStart))),
  ]).then((x) => x.flat());
  const slots: { start: string; available: boolean }[] = [];
  const now = new Date();
  for (let t = dayStart; t < dayEnd; t = addMinutes(t, court.slotMinutes)) {
    const tEnd = addMinutes(t, court.slotMinutes);
    const taken = busy.some((b) => b.s < tEnd && b.e > t);
    slots.push({ start: t.toISOString(), available: !taken && t >= now });
  }
  return { open: true, openTime: sched.openTime, closeTime: sched.closeTime, slotMinutes: court.slotMinutes, slots };
}
