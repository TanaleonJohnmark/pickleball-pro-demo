import { and, eq, lte, gt, lt, desc, sql } from 'drizzle-orm';
import { db, type Tx } from '../db/index.js';
import { memberships, membershipPlans } from '../db/schema.js';

/** Expire memberships whose end date has passed. Cheap; called before membership reads. */
export async function expireMemberships(tx?: Tx) {
  await (tx ?? db).update(memberships).set({ status: 'EXPIRED' })
    .where(and(eq(memberships.status, 'ACTIVE'), lt(memberships.endDate, new Date())));
}

/** The membership in force right now (ACTIVE and today within its dates), with its plan. */
export async function currentMembership(userId: string, at = new Date(), tx?: Tx) {
  const [row] = await (tx ?? db).select({ m: memberships, plan: membershipPlans })
    .from(memberships).innerJoin(membershipPlans, eq(membershipPlans.id, memberships.planId))
    .where(and(eq(memberships.userId, userId), eq(memberships.status, 'ACTIVE'), lte(memberships.startDate, at), gt(memberships.endDate, at)))
    .orderBy(desc(memberships.endDate)).limit(1);
  return row ?? null;
}

/** Latest end date among a player's active (current or queued) memberships. */
export async function latestActiveEnd(userId: string, tx?: Tx) {
  const [r] = await (tx ?? db).select({ end: sql<Date | null>`max(${memberships.endDate})` }).from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.status, 'ACTIVE'), gt(memberships.endDate, new Date())));
  return r?.end ? new Date(r.end) : null;
}

/** Activate a paid membership. Renewals start when the current one ends. */
export async function activateMembership(tx: Tx, membershipId: string) {
  const [m] = await tx.select().from(memberships).where(eq(memberships.id, membershipId)).for('update');
  if (!m || m.status !== 'PENDING') return m;
  const [plan] = await tx.select().from(membershipPlans).where(eq(membershipPlans.id, m.planId));
  const latest = await latestActiveEnd(m.userId, tx);
  const start = latest && latest > new Date() ? latest : new Date();
  const end = new Date(start.getTime() + plan.durationDays * 86400000);
  const [u] = await tx.update(memberships).set({ status: 'ACTIVE', startDate: start, endDate: end }).where(eq(memberships.id, m.id)).returning();
  return u;
}
