import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { membershipPlans, memberships, users, playerProfiles } from '../db/schema.js';
import { ah, parse, notFound, badRequest, conflict, paging } from '../lib/http.js';
import { requireAuth, requireRole, ADMIN, STAFF_UP, isStaff, isAdmin } from '../lib/auth.js';
import { audit, notify } from '../lib/audit.js';
import { expireMemberships, currentMembership, activateMembership } from '../services/membership.js';

export const plans = Router();
export const r = Router();
const skills = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'COMPETITIVE'] as const;
const planSchema = z.object({
  name: z.string().trim().min(2).max(40), description: z.string().max(500).nullable().optional(),
  priceCents: z.number().int().min(0), durationDays: z.number().int().min(1).max(3660),
  discountPercent: z.number().int().min(0).max(100).default(0), advanceBookingDays: z.number().int().min(1).max(365).default(7),
  maxActiveBookings: z.number().int().min(1).max(50).default(3), benefits: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
  renewable: z.boolean().default(true), minSkillLevel: z.enum(skills).nullable().optional(), active: z.boolean().default(true), sortOrder: z.number().int().default(0),
});

plans.get('/', ah(async (req, res) => {
  res.json({ plans: await db.select().from(membershipPlans).where(isAdmin(req.user) && req.query.all === '1' ? undefined : eq(membershipPlans.active, true)).orderBy(asc(membershipPlans.sortOrder), asc(membershipPlans.priceCents)) });
}));
plans.post('/', requireRole(...ADMIN), ah(async (req, res) => {
  const b = parse(planSchema, req.body);
  const [p] = await db.insert(membershipPlans).values(b).returning();
  await audit(req, 'plan.create', 'membership_plan', p.id, b);
  res.status(201).json({ plan: p });
}));
plans.patch('/:id', requireRole(...ADMIN), ah(async (req, res) => {
  const b = parse(planSchema.partial(), req.body);
  const [p] = await db.update(membershipPlans).set(b).where(eq(membershipPlans.id, req.params.id)).returning();
  if (!p) throw notFound('Plan');
  await audit(req, 'plan.update', 'membership_plan', p.id, b);
  res.json({ plan: p });
}));

r.use(requireAuth);
r.get('/me', ah(async (req, res) => {
  await expireMemberships();
  const list = await db.select({ m: memberships, plan: membershipPlans }).from(memberships).innerJoin(membershipPlans, eq(membershipPlans.id, memberships.planId)).where(eq(memberships.userId, req.user!.id)).orderBy(desc(memberships.createdAt));
  const cur = await currentMembership(req.user!.id);
  res.json({ current: cur ? { ...cur.m, plan: cur.plan } : null, history: list.map((x) => ({ ...x.m, plan: x.plan })) });
}));

/** Subscribe or renew. Creates a PENDING membership; it activates when payment is recorded (free plans activate at once). */
r.post('/', ah(async (req, res) => {
  const b = parse(z.object({ planId: z.string().uuid(), userId: z.string().uuid().optional() }), req.body);
  const userId = b.userId && isStaff(req.user) ? b.userId : req.user!.id;
  const out = await db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
    const [plan] = await tx.select().from(membershipPlans).where(eq(membershipPlans.id, b.planId));
    if (!plan || !plan.active) throw notFound('Plan');
    const [pending] = await tx.select().from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.status, 'PENDING')));
    if (pending) throw conflict('There is already a membership awaiting payment. Pay or cancel it first.');
    const cur = await currentMembership(userId, new Date(), tx);
    if (cur && cur.plan.id === plan.id && !plan.renewable) throw badRequest('This plan cannot be renewed');
    const queued = await tx.select().from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.status, 'ACTIVE')));
    if (queued.length >= 2) throw badRequest('A renewal is already queued after your current membership');
    if (plan.minSkillLevel) {
      const [p] = await tx.select().from(playerProfiles).where(eq(playerProfiles.userId, userId));
      if (skills.indexOf(p?.skillLevel ?? 'BEGINNER') < skills.indexOf(plan.minSkillLevel)) throw badRequest(`${plan.name} requires ${plan.minSkillLevel.toLowerCase()} level or above`);
    }
    const now = new Date();
    const [m] = await tx.insert(memberships).values({ userId, planId: plan.id, startDate: now, endDate: new Date(now.getTime() + plan.durationDays * 86400000), status: 'PENDING', priceCents: plan.priceCents }).returning();
    const final = plan.priceCents === 0 ? await activateMembership(tx, m.id) : m;
    await notify(userId, { type: 'MEMBERSHIP', title: plan.priceCents === 0 ? `${plan.name} membership active` : `${plan.name} membership requested`, body: plan.priceCents === 0 ? 'Enjoy your benefits.' : 'Pay at the front desk to activate it.', link: '/app/membership' }, tx);
    await audit(req, cur ? 'membership.renew' : 'membership.subscribe', 'membership', m.id, { plan: plan.name, renewal: !!cur }, tx);
    return final;
  });
  res.status(201).json({ membership: out });
}));

r.post('/:id/cancel', ah(async (req, res) => {
  const [m] = await db.select().from(memberships).where(eq(memberships.id, req.params.id));
  if (!m || (m.userId !== req.user!.id && !isAdmin(req.user))) throw notFound('Membership');
  if (m.status === 'ACTIVE' && !isAdmin(req.user)) throw badRequest('Active memberships can only be cancelled by the club');
  if (!['PENDING', 'ACTIVE'].includes(m.status)) throw badRequest('This membership is already closed');
  await db.update(memberships).set({ status: 'CANCELLED' }).where(eq(memberships.id, m.id));
  await audit(req, 'membership.cancel', 'membership', m.id);
  res.json({ ok: true });
}));

r.get('/', requireRole(...STAFF_UP), ah(async (req, res) => {
  await expireMemberships();
  const { page, pageSize, offset } = paging(req.query);
  const st = typeof req.query.status === 'string' ? req.query.status.split(',') : undefined;
  const rows = await db.select({ m: memberships, plan: membershipPlans.name, player: users.fullName, email: users.email }).from(memberships)
    .innerJoin(membershipPlans, eq(membershipPlans.id, memberships.planId)).innerJoin(users, eq(users.id, memberships.userId))
    .where(st ? inArray(memberships.status, st as any) : undefined).orderBy(desc(memberships.createdAt)).limit(pageSize).offset(offset);
  res.json({ items: rows.map((x) => ({ ...x.m, planName: x.plan, playerName: x.player, email: x.email })), page, pageSize });
}));
