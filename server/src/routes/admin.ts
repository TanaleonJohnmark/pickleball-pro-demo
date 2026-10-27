import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, ilike, inArray, count, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, auditLogs, sessions, playerProfiles } from '../db/schema.js';
import { ah, parse, notFound, forbidden, conflict, paging } from '../lib/http.js';
import { requireRole, hashPassword } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { getSettings, setSetting, DEFAULT_SETTINGS } from '../services/settings.js';
import { passwordSchema } from './auth.js';

export const r = Router();

// Staff & administrator accounts — super admin only
r.get('/users', requireRole(), ah(async (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const w: SQL[] = [inArray(users.role, ['SUPER_ADMIN', 'CLUB_ADMIN', 'STAFF', 'COACH'])];
  if (typeof req.query.q === 'string' && req.query.q) w.push(ilike(users.fullName, `%${req.query.q}%`));
  const items = await db.select({ id: users.id, fullName: users.fullName, email: users.email, role: users.role, status: users.status, createdAt: users.createdAt }).from(users).where(and(...w)).orderBy(users.role, users.fullName).limit(pageSize).offset(offset);
  const [{ total }] = await db.select({ total: count() }).from(users).where(and(...w));
  res.json({ items, total, page, pageSize });
}));

r.post('/users', requireRole(), ah(async (req, res) => {
  const b = parse(z.object({ email: z.string().trim().toLowerCase().email(), fullName: z.string().trim().min(2).max(100), role: z.enum(['CLUB_ADMIN', 'STAFF', 'SUPER_ADMIN']), password: passwordSchema }), req.body);
  const [ex] = await db.select({ id: users.id }).from(users).where(eq(users.email, b.email));
  if (ex) throw conflict('An account with this email already exists');
  const [u] = await db.insert(users).values({ email: b.email, fullName: b.fullName, role: b.role, passwordHash: await hashPassword(b.password) }).returning({ id: users.id });
  await db.insert(playerProfiles).values({ userId: u.id }).onConflictDoNothing();
  await audit(req, 'staff.create', 'user', u.id, { email: b.email, role: b.role });
  res.status(201).json({ id: u.id });
}));

r.post('/users/:id/role', requireRole(), ah(async (req, res) => {
  const { role } = parse(z.object({ role: z.enum(['SUPER_ADMIN', 'CLUB_ADMIN', 'STAFF', 'COACH', 'PLAYER']) }), req.body);
  if (req.params.id === req.user!.id) throw forbidden('You cannot change your own role');
  const [u] = await db.select().from(users).where(eq(users.id, req.params.id));
  if (!u) throw notFound('User');
  await db.update(users).set({ role }).where(eq(users.id, u.id));
  await db.delete(sessions).where(eq(sessions.userId, u.id)); // force re-login with new permissions
  await audit(req, 'user.role_change', 'user', u.id, { from: u.role, to: role });
  res.json({ ok: true });
}));

r.get('/audit', requireRole(), ah(async (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const w: SQL[] = [];
  if (typeof req.query.entity === 'string' && req.query.entity) w.push(eq(auditLogs.entity, req.query.entity));
  if (typeof req.query.action === 'string' && req.query.action) w.push(ilike(auditLogs.action, `%${req.query.action}%`));
  const where = w.length ? and(...w) : undefined;
  const rows = await db.select({ a: auditLogs, actor: users.fullName }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorId)).where(where).orderBy(desc(auditLogs.createdAt)).limit(pageSize).offset(offset);
  const [{ total }] = await db.select({ total: count() }).from(auditLogs).where(where);
  res.json({ items: rows.map((x) => ({ ...x.a, actorName: x.actor })), total, page, pageSize });
}));

r.get('/settings', requireRole('CLUB_ADMIN'), ah(async (_req, res) => { res.json({ settings: await getSettings() }); }));
r.put('/settings', requireRole(), ah(async (req, res) => {
  const b = parse(z.object({
    clubName: z.string().trim().min(2).max(80), contactEmail: z.string().email(), contactPhone: z.string().max(40), address: z.string().max(200), currency: z.literal('PHP'),
    cancellationHours: z.number().int().min(0).max(168), defaultAdvanceBookingDays: z.number().int().min(1).max(365), defaultMaxActiveBookings: z.number().int().min(1).max(50), reminderHours: z.number().int().min(1).max(72),
  }).partial(), req.body);
  for (const [k, v] of Object.entries(b)) await setSetting(k as keyof typeof DEFAULT_SETTINGS, v);
  await audit(req, 'settings.update', 'settings', null, b);
  res.json({ settings: await getSettings() });
}));
