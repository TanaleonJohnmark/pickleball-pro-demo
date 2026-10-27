/** Background jobs: reminders and membership expiry notices. Idempotent (flags prevent repeats). */
import { and, eq, gt, lt, inArray, isNull } from 'drizzle-orm';
import { db } from './db/index.js';
import { reservations, memberships, membershipPlans, courts } from './db/schema.js';
import { notify } from './lib/audit.js';
import { expireMemberships } from './services/membership.js';
import { getSettings } from './services/settings.js';

export async function runJobs() {
  const s = await getSettings();
  const now = new Date();
  const soon = new Date(now.getTime() + s.reminderHours * 3600000);
  const due = await db.select({ r: reservations, court: courts.name }).from(reservations).innerJoin(courts, eq(courts.id, reservations.courtId))
    .where(and(inArray(reservations.status, ['PENDING', 'CONFIRMED']), gt(reservations.startAt, now), lt(reservations.startAt, soon), isNull(reservations.reminderSentAt)));
  for (const { r, court } of due) {
    await db.transaction(async (tx) => {
      const [claimed] = await tx.update(reservations).set({ reminderSentAt: now }).where(and(eq(reservations.id, r.id), isNull(reservations.reminderSentAt))).returning();
      if (claimed) await notify(r.userId, { type: 'BOOKING_REMINDER', title: 'Upcoming court booking', body: `${court} at ${r.startAt.toLocaleString('en-PH', { timeZone: process.env.CLUB_TIMEZONE || 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })}.${r.paymentStatus === 'UNPAID' ? ' Payment is still due.' : ''}`, link: `/app/reservations/${r.id}` }, tx);
    });
  }
  await expireMemberships();
  const week = new Date(now.getTime() + 7 * 86400000);
  const exp = await db.select({ m: memberships, plan: membershipPlans.name }).from(memberships).innerJoin(membershipPlans, eq(membershipPlans.id, memberships.planId))
    .where(and(eq(memberships.status, 'ACTIVE'), gt(memberships.endDate, now), lt(memberships.endDate, week), isNull(memberships.expiryNoticeSentAt)));
  for (const { m, plan } of exp) {
    const [claimed] = await db.update(memberships).set({ expiryNoticeSentAt: now }).where(and(eq(memberships.id, m.id), isNull(memberships.expiryNoticeSentAt))).returning();
    if (claimed) await notify(m.userId, { type: 'MEMBERSHIP_EXPIRING', title: `${plan} membership ends soon`, body: `It ends on ${m.endDate.toLocaleDateString('en-PH', { dateStyle: 'medium' })}. Renew to keep your benefits.`, link: '/app/membership' });
  }
  return { reminders: due.length, expiryNotices: exp.length };
}
