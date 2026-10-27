/**
 * DEVELOPMENT SEED DATA. Every generated row is flagged is_sample = true where
 * the table supports it, and all people use @example.com addresses.
 * Run on an empty, migrated database:  npm run db:reset && npm run db:seed
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db, pool } from './index.js';
import * as s from './schema.js';
import { hashPassword } from '../lib/auth.js';
import { reference } from '../lib/ids.js';
import { localToUtc, addDays, addMinutes, todayYmd } from '../lib/time.js';
import { validateFinalMatch } from '../services/scoring.js';
import { finalizeMatch } from '../services/matches.js';
import { startTournament } from '../services/tournament.js';

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SEED !== '1') throw new Error('Refusing to seed sample data in production.');
const [existing] = await db.select({ id: s.users.id }).from(s.users).limit(1);
if (existing) { console.log('Database already has users; skipping seed. Run npm run db:reset first for a clean seed.'); process.exit(0); }

let seed = 42; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
const ymdOffset = (n: number) => addDays(new Date(`${todayYmd()}T12:00:00Z`), n).toISOString().slice(0, 10);

const pw = await hashPassword('Password123');
async function user(email: string, fullName: string, role: typeof s.users.$inferInsert.role, skill: typeof s.playerProfiles.$inferInsert.skillLevel = 'INTERMEDIATE', daysAgo = 120) {
  const [u] = await db.insert(s.users).values({ email, fullName, role, passwordHash: pw, isSample: true, phone: `+63 917 ${Math.floor(1000000 + rand() * 8999999)}`, createdAt: addDays(new Date(), -daysAgo) }).returning();
  await db.insert(s.playerProfiles).values({ userId: u.id, skillLevel: skill, preferredFormat: rand() > 0.3 ? 'DOUBLES' : 'SINGLES' });
  return u;
}

console.log('Seeding staff…');
const superAdmin = await user('superadmin@example.com', 'Sam Reyes', 'SUPER_ADMIN');
const admin = await user('admin@example.com', 'Andrea Cruz', 'CLUB_ADMIN');
const staff = await user('staff@example.com', 'Paolo Santos', 'STAFF');
const coachU1 = await user('coach@example.com', 'Coach Mia Delgado', 'COACH', 'COMPETITIVE');
const coachU2 = await user('coach2@example.com', 'Coach Ben Lim', 'COACH', 'ADVANCED');
const [coach1] = await db.insert(s.coaches).values({ userId: coachU1.id, bio: 'Former regional doubles champion. Focus on dinking and third-shot drops.', hourlyRateCents: 120000 }).returning();
const [coach2] = await db.insert(s.coaches).values({ userId: coachU2.id, bio: 'Beginner-friendly clinics and footwork drills.', hourlyRateCents: 80000 }).returning();

console.log('Seeding players…');
const names = ['Jamie Navarro', 'Kris Villanueva', 'Lea Mendoza', 'Marco Bautista', 'Nina Garcia', 'Oscar Ramos', 'Pia Torres', 'Rico Fernandez', 'Sofia Aquino', 'Tomas Castillo', 'Ursula Dizon', 'Vince Pascual', 'Wena Ocampo', 'Xander Lopez', 'Yna Morales', 'Zed Salazar'];
const skills = ['BEGINNER', 'INTERMEDIATE', 'INTERMEDIATE', 'ADVANCED', 'COMPETITIVE'] as const;
const players: (typeof s.users.$inferSelect)[] = [];
for (const [i, n] of names.entries()) players.push(await user(i === 0 ? 'player@example.com' : `${n.split(' ')[0].toLowerCase()}@example.com`, n, 'PLAYER', i < 8 ? 'INTERMEDIATE' : pick([...skills]), Math.floor(5 + rand() * 300)));

console.log('Seeding courts…');
const courtDefs = [
  { name: 'Court 1 — Center', indoor: true, hourlyPriceCents: 60000, surface: 'Cushioned acrylic', description: 'Show court with seating for 40 and LED lighting.' },
  { name: 'Court 2', indoor: true, hourlyPriceCents: 50000, surface: 'Acrylic hard court' },
  { name: 'Court 3', indoor: false, hourlyPriceCents: 35000, surface: 'Outdoor hard court' },
  { name: 'Court 4', indoor: false, hourlyPriceCents: 35000, surface: 'Outdoor hard court' },
  { name: 'Court 5 — Training', indoor: false, hourlyPriceCents: 25000, surface: 'Outdoor hard court', status: 'INACTIVE' as const, description: 'Resurfacing in progress.' },
];
const courtRows = [];
for (const c of courtDefs) {
  const [row] = await db.insert(s.courts).values({ ...c, location: c.indoor ? 'Main hall' : 'East grounds', capacity: 4, isSample: true }).returning();
  await db.insert(s.courtSchedules).values([0, 1, 2, 3, 4, 5, 6].map((d) => ({ courtId: row.id, dayOfWeek: d, openTime: d === 0 ? '07:00' : '06:00', closeTime: '22:00' })));
  courtRows.push(row);
}
const active = courtRows.filter((c) => c.status === 'ACTIVE');
await db.insert(s.courtMaintenance).values({ courtId: active[3].id, startAt: localToUtc(ymdOffset(3), '06:00'), endAt: localToUtc(ymdOffset(3), '12:00'), reason: 'Net and line repainting' });

console.log('Seeding membership plans…');
const plans = await db.insert(s.membershipPlans).values([
  { name: 'Basic', priceCents: 50000, durationDays: 30, discountPercent: 5, advanceBookingDays: 7, maxActiveBookings: 2, benefits: ['5% off court bookings', 'Book 7 days ahead'], sortOrder: 1 },
  { name: 'Silver', priceCents: 120000, durationDays: 30, discountPercent: 10, advanceBookingDays: 14, maxActiveBookings: 4, benefits: ['10% off court bookings', 'Book 14 days ahead', 'Members-only open play'], sortOrder: 2 },
  { name: 'Gold', priceCents: 300000, durationDays: 90, discountPercent: 15, advanceBookingDays: 21, maxActiveBookings: 6, benefits: ['15% off court bookings', 'Book 21 days ahead', 'One free clinic per month'], sortOrder: 3 },
  { name: 'Premium', priceCents: 1000000, durationDays: 365, discountPercent: 25, advanceBookingDays: 30, maxActiveBookings: 10, benefits: ['25% off court bookings', 'Book 30 days ahead', 'Priority tournament entry', 'Guest passes'], minSkillLevel: 'INTERMEDIATE', sortOrder: 4 },
]).returning();

async function pay(userId: string, amountCents: number, purpose: typeof s.payments.$inferInsert.purpose, paidAt: Date, link: Partial<typeof s.payments.$inferInsert>) {
  await db.insert(s.payments).values({ reference: reference('RC'), userId, amountCents, method: pick(['CASH', 'CASH', 'GCASH_MANUAL', 'CARD_TERMINAL'] as const), externalRef: 'SAMPLE', purpose, status: 'PAID', recordedById: staff.id, paidAt, isSample: true, notes: 'Development sample', ...link });
}

for (const [i, p] of players.slice(0, 11).entries()) {
  const plan = plans[i % plans.length];
  if (plan.minSkillLevel && i % 4 === 3) continue;
  const start = addDays(new Date(), -Math.floor(rand() * Math.min(plan.durationDays - 3, 80)));
  const [m] = await db.insert(s.memberships).values({ userId: p.id, planId: plan.id, startDate: start, endDate: addDays(start, plan.durationDays), status: 'ACTIVE', priceCents: plan.priceCents, isSample: true, createdAt: start }).returning();
  await pay(p.id, plan.priceCents, 'MEMBERSHIP', start, { membershipId: m.id });
}
// some history: expired memberships months ago
for (const p of players.slice(4, 12)) {
  const plan = plans[1]; const start = addDays(new Date(), -Math.floor(120 + rand() * 200));
  const [m] = await db.insert(s.memberships).values({ userId: p.id, planId: plan.id, startDate: start, endDate: addDays(start, plan.durationDays), status: 'EXPIRED', priceCents: plan.priceCents, isSample: true, createdAt: start }).returning();
  await pay(p.id, plan.priceCents, 'MEMBERSHIP', start, { membershipId: m.id });
}
await db.insert(s.memberships).values({ userId: players[12].id, planId: plans[1].id, startDate: new Date(), endDate: addDays(new Date(), 30), status: 'PENDING', priceCents: plans[1].priceCents, isSample: true });

console.log('Seeding reservations…');
const hoursPool = ['06:00', '07:00', '08:00', '09:30', '11:00', '13:00', '15:00', '16:30', '17:00', '18:00', '19:00', '20:00'];
let n = 0;
for (let d = -60; d <= 10; d++) {
  const ymd = ymdOffset(d);
  for (const c of active) {
    const used: [number, number][] = [];
    const count = d < 0 ? Math.floor(rand() * 5) + 1 : Math.floor(rand() * 3);
    for (let k = 0; k < count; k++) {
      const hhmm = pick(hoursPool); const dur = pick([60, 60, 90, 120]);
      const start = localToUtc(ymd, hhmm), end = addMinutes(start, dur);
      if (end > localToUtc(ymd, '22:00')) continue;
      if (used.some(([a, b]) => start.getTime() < b && end.getTime() > a)) continue;
      if (d === 3 && c.id === active[3].id && start < localToUtc(ymd, '12:00')) continue; // maintenance
      used.push([start.getTime(), end.getTime()]);
      const p = pick(players);
      const base = Math.round((c.hourlyPriceCents * dur) / 60);
      const past = end < new Date();
      const roll = rand();
      const status = past ? (roll < 0.08 ? 'CANCELLED' : roll < 0.12 ? 'NO_SHOW' : 'COMPLETED') : roll < 0.1 ? 'CANCELLED' : roll < 0.55 ? 'CONFIRMED' : 'PENDING';
      const paid = status === 'COMPLETED' || status === 'NO_SHOW' || status === 'CONFIRMED';
      const created = addDays(start, -Math.floor(1 + rand() * 6));
      const [r] = await db.insert(s.reservations).values({ reference: reference('PB'), userId: p.id, courtId: c.id, createdById: rand() > 0.8 ? staff.id : p.id, startAt: start, endAt: end, participants: pick([2, 4, 4]), basePriceCents: base, discountCents: 0, totalPriceCents: base,
        status: status as any, paymentStatus: paid ? 'PAID' : 'UNPAID', cancelledAt: status === 'CANCELLED' ? created : null, cancelReason: status === 'CANCELLED' ? 'Cancelled by player' : null, isSample: true, createdAt: created }).returning();
      if (paid) await pay(p.id, base, 'RESERVATION', created, { reservationId: r.id });
      n++;
    }
  }
}
console.log(`  ${n} reservations`);

console.log('Seeding matches and rankings…');
for (let k = 0; k < 40; k++) {
  const doubles = rand() > 0.35;
  const pool_ = [...players].sort(() => rand() - 0.5).slice(0, doubles ? 4 : 2);
  const start = addDays(localToUtc(ymdOffset(-Math.floor(1 + rand() * 50)), '00:00'), 0);
  const at = addMinutes(start, (6 + Math.floor(rand() * 14)) * 60);
  await db.transaction(async (tx) => {
    const [m] = await tx.insert(s.matches).values({ format: doubles ? 'DOUBLES' : 'SINGLES', category: rand() > 0.25 ? 'COMPETITIVE' : 'FRIENDLY', startAt: at, endAt: addMinutes(at, 45), status: 'SCHEDULED', officialId: staff.id, isSample: true, createdAt: at }).returning();
    await tx.insert(s.matchParticipants).values(pool_.map((p, i) => ({ matchId: m.id, userId: p.id, side: i < pool_.length / 2 ? 1 : 2 })));
    const w = rand() > 0.5; const lose = Math.floor(rand() * 10);
    const games = [{ s1: w ? 11 : lose, s2: w ? lose : 11 }];
    const v = validateFinalMatch({ format: m.format, scoring: 'SIDE_OUT', targetScore: 11, winBy: 2, bestOf: 1 }, games);
    await finalizeMatch(tx, m, v.winner, v.games);
    await tx.update(s.ratingHistory).set({ createdAt: at }).where(eq(s.ratingHistory.matchId, m.id));
  });
}
// upcoming friendly match for the demo player
{
  const at = localToUtc(ymdOffset(2), '19:00');
  const [m] = await db.insert(s.matches).values({ format: 'DOUBLES', category: 'FRIENDLY', startAt: at, endAt: addMinutes(at, 60), isSample: true }).returning();
  await db.insert(s.matchParticipants).values(players.slice(0, 4).map((p, i) => ({ matchId: m.id, userId: p.id, side: i < 2 ? 1 : 2 })));
}

console.log('Seeding tournaments…');
const mk = (v: Partial<typeof s.tournaments.$inferInsert>) => db.insert(s.tournaments).values({ name: '', venue: 'Main hall', format: 'SINGLE_ELIMINATION', category: 'DOUBLES', maxParticipants: 8, startDate: new Date(), endDate: new Date(), registrationDeadline: new Date(), isSample: true, ...v } as any).returning();
const [past] = await mk({ name: 'Summer Doubles Classic', description: 'Single-elimination doubles, intermediate and up.', startDate: addDays(new Date(), -20), endDate: addDays(new Date(), -19), registrationDeadline: addDays(new Date(), -25), feeCents: 50000, status: 'OPEN' });
const [rr] = await mk({ name: 'Monthly Singles Ladder', description: 'Round robin, everyone plays everyone.', format: 'ROUND_ROBIN', category: 'SINGLES', startDate: addDays(new Date(), -2), endDate: addDays(new Date(), 5), registrationDeadline: addDays(new Date(), -3), maxParticipants: 6, status: 'OPEN' });
const [open] = await mk({ name: 'Club Championship', description: 'Group stage then knockout. Doubles, all levels.', format: 'GROUP_KNOCKOUT', category: 'DOUBLES', startDate: addDays(new Date(), 21), endDate: addDays(new Date(), 22), registrationDeadline: addDays(new Date(), 18), maxParticipants: 16, feeCents: 80000, status: 'OPEN', groupCount: 2 });
async function enter(t: typeof past, a: typeof s.users.$inferSelect, b?: typeof s.users.$inferSelect, paid = true) {
  const [team] = await db.insert(s.tournamentTeams).values({ tournamentId: t.id, name: b ? `${a.fullName.split(' ')[0]} / ${b.fullName.split(' ')[0]}` : a.fullName, player1Id: a.id, player2Id: b?.id ?? null }).returning();
  for (const u of [a, b].filter(Boolean) as (typeof s.users.$inferSelect)[]) {
    const [reg] = await db.insert(s.tournamentRegistrations).values({ tournamentId: t.id, userId: u.id, teamId: team.id, paymentStatus: t.feeCents && !paid ? 'UNPAID' : 'PAID' }).returning();
    if (t.feeCents && paid) await pay(u.id, t.feeCents, 'TOURNAMENT', addDays(t.registrationDeadline, -2), { tournamentRegistrationId: reg.id });
  }
}
for (let i = 0; i < 12; i += 2) await enter(past, players[i], players[i + 1]);
for (let i = 0; i < 5; i++) await enter(rr, players[i + 3]);
for (let i = 0; i < 6; i += 2) await enter(open, players[i + 4], players[i + 5], i !== 2);
// play out the past tournament completely and half of the round robin
await db.transaction(async (tx) => { const [t] = await tx.select().from(s.tournaments).where(eq(s.tournaments.id, past.id)); await startTournament(tx, t); });
await db.transaction(async (tx) => { const [t] = await tx.select().from(s.tournaments).where(eq(s.tournaments.id, rr.id)); await startTournament(tx, t); });
async function playAll(tid: string, limit = Infinity) {
  let played = 0;
  for (;;) {
    const pending = await db.select({ m: s.matches }).from(s.tournamentMatches).innerJoin(s.matches, eq(s.matches.id, s.tournamentMatches.matchId)).where(eq(s.tournamentMatches.tournamentId, tid));
    const next = pending.find((x) => x.m.status === 'SCHEDULED');
    if (!next || played >= limit) break;
    await db.transaction(async (tx) => {
      const lose = Math.floor(rand() * 10); const w = rand() > 0.5;
      const v = validateFinalMatch({ format: next.m.format, scoring: 'SIDE_OUT', targetScore: 11, winBy: 2, bestOf: 1 }, [{ s1: w ? 11 : lose, s2: w ? lose : 11 }]);
      await finalizeMatch(tx, next.m, v.winner, v.games);
    });
    played++;
  }
}
await playAll(past.id);
await playAll(rr.id, 5);

console.log('Seeding coaching, announcements, notifications…');
for (let d = -14; d <= 14; d += 3) {
  const at = localToUtc(ymdOffset(d), d % 2 ? '08:00' : '17:00');
  const group = d % 2 === 0;
  const [cs] = await db.insert(s.coachingSessions).values({ coachId: group ? coach2.id : coach1.id, courtId: null, title: group ? 'Beginner clinic: serves & returns' : 'Private lesson: third-shot drop', kind: group ? 'GROUP' : 'INDIVIDUAL', startAt: at, endAt: addMinutes(at, 60), priceCents: group ? 30000 : 120000, capacity: group ? 6 : 1, status: d < 0 ? 'COMPLETED' : 'SCHEDULED' }).returning();
  const learners = group ? players.slice(8, 11) : [players[(d + 14) % players.length]];
  for (const p of learners) {
    const [e] = await db.insert(s.coachingEnrollments).values({ sessionId: cs.id, playerId: p.id, attended: d < 0 ? rand() > 0.15 : null, paymentStatus: d < 0 ? 'PAID' : 'UNPAID' }).returning();
    if (d < 0) await pay(p.id, cs.priceCents, 'COACHING', at, { coachingEnrollmentId: e.id });
  }
}
await db.insert(s.coachNotes).values({ coachId: coach2.id, playerId: players[8].id, note: 'Good progress on deep returns. Next: split-step timing at the kitchen line.' });
await db.insert(s.announcements).values([
  { title: 'Court 5 resurfacing', body: 'Court 5 is closed while it is resurfaced. We expect it back in two weeks.', pinned: true, authorId: admin.id },
  { title: 'Club Championship registration is open', body: 'Doubles teams of all levels are welcome. Group stage then knockout. Register from the Tournaments page.', authorId: admin.id },
]);
await db.insert(s.notifications).values(players.map((p) => ({ userId: p.id, type: 'ANNOUNCEMENT', title: 'Club Championship registration is open', body: 'Register your doubles team from the Tournaments page.', link: '/app/tournaments' })));
void superAdmin; void coach2;

console.log('\nSample accounts (password for all: Password123)');
console.log('  superadmin@example.com  Super admin');
console.log('  admin@example.com       Club administrator');
console.log('  staff@example.com       Front-desk staff');
console.log('  coach@example.com       Coach');
console.log('  player@example.com      Player');
await pool.end();
