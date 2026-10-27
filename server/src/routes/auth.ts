import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { eq, and, isNull, count } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, playerProfiles, notifications, sessions } from '../db/schema.js';
import { ah, parse, HttpError, conflict } from '../lib/http.js';
import { hashPassword, verifyPassword, startSession, endSession, requireAuth } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { currentMembership, expireMemberships } from '../services/membership.js';
import { isDemoAccount } from '../demo.js';

export const r = Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: process.env.NODE_ENV === 'test' ? 1000 : 20, standardHeaders: true, legacyHeaders: false,
  message: { error: { code: 'RATE_LIMIT', message: 'Too many attempts. Wait 15 minutes and try again.' } } });

export const passwordSchema = z.string().min(8, 'Use at least 8 characters').max(128)
  .regex(/[A-Za-z]/, 'Include a letter').regex(/[0-9]/, 'Include a number');
const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: passwordSchema,
  fullName: z.string().trim().min(2).max(100),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  skillLevel: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'COMPETITIVE']).default('BEGINNER'),
  preferredFormat: z.enum(['SINGLES', 'DOUBLES']).default('DOUBLES'),
});

r.post('/register', authLimiter, ah(async (req, res) => {
  const b = parse(registerSchema, req.body);
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, b.email));
  if (exists) throw conflict('An account with this email already exists. Sign in instead.');
  const user = await db.transaction(async (tx) => {
    const [u] = await tx.insert(users).values({ email: b.email, passwordHash: await hashPassword(b.password), fullName: b.fullName, phone: b.phone || null, role: 'PLAYER' }).returning();
    await tx.insert(playerProfiles).values({ userId: u.id, skillLevel: b.skillLevel, preferredFormat: b.preferredFormat });
    await tx.insert(notifications).values({ userId: u.id, type: 'WELCOME', title: 'Welcome to the club', body: 'Your account is ready. Book a court or browse membership plans to get started.', link: '/app/book' });
    return u;
  });
  await startSession(res, user.id);
  await audit(null, 'user.register', 'user', user.id);
  res.status(201).json({ user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role } });
}));

r.post('/login', authLimiter, ah(async (req, res) => {
  const b = parse(z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) }), req.body);
  const [u] = await db.select().from(users).where(eq(users.email, b.email));
  // same message for unknown email and wrong password (no account enumeration)
  if (!u || !(await verifyPassword(b.password, u.passwordHash))) throw new HttpError(401, 'Email or password is incorrect', 'BAD_CREDENTIALS');
  if (u.status !== 'ACTIVE') throw new HttpError(403, 'This account is suspended. Contact the club.', 'SUSPENDED');
  await startSession(res, u.id);
  res.json({ user: { id: u.id, email: u.email, fullName: u.fullName, role: u.role } });
}));

r.post('/logout', ah(async (req, res) => { await endSession(req, res); res.json({ ok: true }); }));

r.get('/me', ah(async (req, res) => {
  if (!req.user) return res.json({ user: null });
  await expireMemberships();
  const [u] = await db.select({ id: users.id, email: users.email, fullName: users.fullName, phone: users.phone, role: users.role, createdAt: users.createdAt }).from(users).where(eq(users.id, req.user.id));
  const [profile] = await db.select().from(playerProfiles).where(eq(playerProfiles.userId, u.id));
  const m = await currentMembership(u.id);
  const [{ unread }] = await db.select({ unread: count() }).from(notifications).where(and(eq(notifications.userId, u.id), isNull(notifications.readAt)));
  const trialEndsAt = ['SUPER_ADMIN', 'CLUB_ADMIN', 'STAFF'].includes(u.role) ? process.env.TRIAL_ENDS_AT || null : null;
  res.json({ user: { ...u, profile: profile ?? null, membership: m ? { ...m.m, plan: m.plan } : null, unread, trialEndsAt } });
}));

r.patch('/me', requireAuth, ah(async (req, res) => {
  const b = parse(z.object({
    fullName: z.string().trim().min(2).max(100).optional(),
    phone: z.string().trim().max(30).nullable().optional(),
    skillLevel: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'COMPETITIVE']).optional(),
    preferredFormat: z.enum(['SINGLES', 'DOUBLES']).optional(),
    avatarUrl: z.string().url().max(500).nullable().optional().or(z.literal('')),
    bio: z.string().max(500).nullable().optional(),
  }), req.body);
  const id = req.user!.id;
  await db.transaction(async (tx) => {
    if (b.fullName !== undefined || b.phone !== undefined) await tx.update(users).set({ ...(b.fullName && { fullName: b.fullName }), ...(b.phone !== undefined && { phone: b.phone || null }) }).where(eq(users.id, id));
    const prof = { ...(b.skillLevel && { skillLevel: b.skillLevel }), ...(b.preferredFormat && { preferredFormat: b.preferredFormat }), ...(b.avatarUrl !== undefined && { avatarUrl: b.avatarUrl || null }), ...(b.bio !== undefined && { bio: b.bio }) };
    if (Object.keys(prof).length) await tx.insert(playerProfiles).values({ userId: id, ...prof }).onConflictDoUpdate({ target: playerProfiles.userId, set: prof });
  });
  res.json({ ok: true });
}));

r.post('/password', requireAuth, ah(async (req, res) => {
  const b = parse(z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }), req.body);
  const [u] = await db.select().from(users).where(eq(users.id, req.user!.id));
  if (isDemoAccount(u.email)) throw new HttpError(403, 'Password changes are turned off in the demo', 'DEMO');
  if (!(await verifyPassword(b.currentPassword, u.passwordHash))) throw new HttpError(400, 'Current password is incorrect', 'BAD_CREDENTIALS');
  await db.update(users).set({ passwordHash: await hashPassword(b.newPassword) }).where(eq(users.id, u.id));
  await db.delete(sessions).where(eq(sessions.userId, u.id)); // sign out other devices
  await startSession(res, u.id);
  await audit(req, 'user.password_change', 'user', u.id);
  res.json({ ok: true });
}));
