/**
 * DEMO MODE (DEMO_MODE=true): a public showcase that anyone can try.
 * - One-click "try as player" (a fresh guest account per visitor) and "try as owner".
 * - Sample club data, wiped and rebuilt every DEMO_RESET_HOURS (default 6).
 * - Demo accounts cannot change passwords.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from './db/index.js';
import * as s from './db/schema.js';
import { hashPassword, startSession } from './lib/auth.js';
import { ah, HttpError, parse } from './lib/http.js';
import { reference } from './lib/ids.js';
import { localToUtc, addDays, addMinutes, todayYmd } from './lib/time.js';
import { setupClub } from './db/setup-club.js';
import { z } from 'zod';

export const DEMO = process.env.DEMO_MODE === 'true';
export const RESET_HOURS = Number(process.env.DEMO_RESET_HOURS || 6);
export const DEMO_DOMAIN = '@demo.local';
const OWNER_EMAIL = 'owner' + DEMO_DOMAIN;
export const isDemoAccount = (email: string) => DEMO && email.endsWith(DEMO_DOMAIN);

let seedN = 7; const rand = () => ((seedN = (seedN * 16807) % 2147483647) / 2147483647);
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
const ymdOffset = (n: number) => addDays(new Date(`${todayYmd()}T12:00:00Z`), n).toISOString().slice(0, 10);

async function setKV(key: string, value: unknown) {
  await db.insert(s.systemSettings).values({ key, value }).onConflictDoUpdate({ target: s.systemSettings.key, set: { value } });
}

export async function seedDemo() {
  seedN = 7 + new Date().getUTCDate();
  await setKV('clubName', 'Pickleball Pro Demo Club');
  await setKV('address', 'Demo club. Your courts, your name and your logo go here.');
  await setKV('contactPhone', 'Message Pickleball Pro by JT on Facebook');
  await setKV('contactEmail', process.env.DEMO_CONTACT_EMAIL || 'hello@example.com');
  const pw = await hashPassword(randomBytes(12).toString('base64url') + '1a');
  const [owner] = await db.insert(s.users).values({ email: OWNER_EMAIL, fullName: 'Demo Owner', role: 'CLUB_ADMIN', passwordHash: pw, isSample: true }).returning();
  await db.insert(s.playerProfiles).values({ userId: owner.id });
  const names = ['Ana Reyes', 'Carlo Mendoza', 'Bea Villanueva', 'Paolo Cruz', 'Lia Gomez', 'Marco Santos', 'Nina Garcia', 'Rico Fernandez', 'Sofia Aquino', 'Tomas Castillo', 'Yna Morales', 'Vince Pascual', 'Kris Dizon', 'Jamie Navarro'];
  const players = [];
  for (const [i, n] of names.entries()) {
    const [u] = await db.insert(s.users).values({ email: n.split(' ')[0].toLowerCase() + i + DEMO_DOMAIN, fullName: n, role: 'PLAYER', passwordHash: pw, isSample: true, createdAt: addDays(new Date(), -Math.floor(3 + rand() * 60)) }).returning();
    await db.insert(s.playerProfiles).values({ userId: u.id, skillLevel: pick(['BEGINNER', 'INTERMEDIATE', 'INTERMEDIATE', 'ADVANCED'] as const) });
    players.push(u);
  }
  const courts = [];
  for (const c of [{ name: 'Court 1', indoor: true, price: 40000 }, { name: 'Court 2', indoor: true, price: 40000 }, { name: 'Court 3', indoor: false, price: 30000 }, { name: 'Court 4', indoor: false, price: 30000 }]) {
    const [row] = await db.insert(s.courts).values({ name: c.name, location: c.indoor ? 'Indoor hall' : 'Outdoor', surface: c.indoor ? 'Cushioned acrylic' : 'Hard court', indoor: c.indoor, capacity: 4, hourlyPriceCents: c.price, isSample: true }).returning();
    await db.insert(s.courtSchedules).values([0, 1, 2, 3, 4, 5, 6].map((d) => ({ courtId: row.id, dayOfWeek: d, openTime: '06:00', closeTime: '22:00' })));
    courts.push(row);
  }
  const hours = ['06:00', '07:00', '08:00', '09:30', '11:00', '13:00', '15:00', '16:30', '17:00', '18:00', '19:00', '20:00'];
  const now = new Date();
  for (let d = -30; d <= 6; d++) {
    const ymd = ymdOffset(d);
    for (const c of courts) {
      const used: [number, number][] = [];
      const n = d < 0 ? 2 + Math.floor(rand() * 4) : Math.floor(rand() * 3);
      for (let k = 0; k < n; k++) {
        const start = localToUtc(ymd, pick(hours)), dur = pick([60, 60, 90, 120]), end = addMinutes(start, dur);
        if (end > localToUtc(ymd, '22:00') || used.some(([a, b]) => start.getTime() < b && end.getTime() > a)) continue;
        used.push([start.getTime(), end.getTime()]);
        const p = pick(players); const price = Math.round((c.hourlyPriceCents * dur) / 60); const past = end < now; const roll = rand();
        const status = past ? (roll < 0.07 ? 'CANCELLED' : roll < 0.1 ? 'NO_SHOW' : 'COMPLETED') : roll < 0.5 ? 'CONFIRMED' : 'PENDING';
        const paid = status !== 'CANCELLED' && status !== 'PENDING';
        const created = addDays(start, -Math.floor(1 + rand() * 5));
        const [r] = await db.insert(s.reservations).values({ reference: reference('PB'), userId: p.id, courtId: c.id, createdById: p.id, startAt: start, endAt: end, participants: 4, basePriceCents: price, totalPriceCents: price, status, paymentStatus: paid ? 'PAID' : 'UNPAID', cancelledAt: status === 'CANCELLED' ? created : null, cancelReason: status === 'CANCELLED' ? 'Cancelled by player' : null, isSample: true, createdAt: created }).returning();
        if (paid) await db.insert(s.payments).values({ reference: reference('RC'), userId: p.id, amountCents: price, method: pick(['CASH', 'CASH', 'GCASH_MANUAL'] as const), externalRef: 'DEMO', purpose: 'RESERVATION', status: 'PAID', reservationId: r.id, recordedById: owner.id, paidAt: created, isSample: true });
      }
    }
  }
  await db.insert(s.announcements).values({ title: 'Welcome to the Pickleball Pro demo!', body: 'Try booking a court, then switch to the owner view to see how the front desk confirms it. This demo resets every few hours.', pinned: true, authorId: owner.id });
}

let resetting = false;
export async function resetDemo() {
  if (resetting) return; resetting = true;
  try {
    const rows = (await db.execute(sql`select tablename from pg_tables where schemaname = 'public'`)).rows as { tablename: string }[];
    await db.execute(sql.raw(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`));
    await seedDemo();
    await setupClub(() => {});
    await setKV('demoResetAt', new Date().toISOString());
    console.log('demo: data reset');
  } finally { resetting = false; }
}

export async function resetDemoIfDue() {
  if (!DEMO) return;
  const [r] = await db.select().from(s.systemSettings).where(eq(s.systemSettings.key, 'demoResetAt'));
  const last = r ? new Date(r.value as string).getTime() : 0;
  if (Date.now() - last > RESET_HOURS * 3600000) await resetDemo();
}

export const demoRouter = Router();
const demoLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMIT', message: 'Too many demo logins. Try again in a few minutes.' } } });

demoRouter.get('/info', ah(async (_req, res) => {
  if (!DEMO) throw new HttpError(404, 'Not a demo', 'NOT_FOUND');
  const [r] = await db.select().from(s.systemSettings).where(eq(s.systemSettings.key, 'demoResetAt'));
  const last = r ? new Date(r.value as string) : new Date();
  res.json({ demo: true, resetHours: RESET_HOURS, nextResetAt: new Date(last.getTime() + RESET_HOURS * 3600000), contactUrl: process.env.DEMO_CONTACT_URL || null });
}));

demoRouter.post('/login', demoLimiter, ah(async (req, res) => {
  if (!DEMO) throw new HttpError(404, 'Not a demo', 'NOT_FOUND');
  const { as } = parse(z.object({ as: z.enum(['player', 'owner']) }), req.body);
  if (as === 'owner') {
    let [o] = await db.select().from(s.users).where(eq(s.users.email, OWNER_EMAIL));
    if (!o) { await resetDemo(); [o] = await db.select().from(s.users).where(eq(s.users.email, OWNER_EMAIL)); }
    await startSession(res, o.id);
    return res.json({ user: { id: o.id, fullName: o.fullName, role: o.role } });
  }
  const tag = randomBytes(3).toString('hex');
  const first = pick(['Alex', 'Sam', 'Jordan', 'Robin', 'Casey', 'Taylor', 'Morgan', 'Riley']);
  const [u] = await db.insert(s.users).values({ email: `guest-${tag}${DEMO_DOMAIN}`, fullName: `${first} (Guest)`, role: 'PLAYER', passwordHash: await hashPassword(randomBytes(12).toString('base64url') + '1a'), isSample: true }).returning();
  await db.insert(s.playerProfiles).values({ userId: u.id, skillLevel: 'INTERMEDIATE' });
  await db.insert(s.notifications).values({ userId: u.id, type: 'WELCOME', title: 'Welcome to the demo!', body: 'Book any open court. When you are done, try the owner view to see the booking arrive at the front desk.', link: '/app/book' });
  await startSession(res, u.id);
  res.json({ user: { id: u.id, fullName: u.fullName, role: u.role } });
}));
