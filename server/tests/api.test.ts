import { describe, it, expect, beforeAll } from 'vitest';
import { app, makeUser, at, ymd, allWeek, request, H } from './helpers.js';

let admin: Awaited<ReturnType<typeof makeUser>>, staff: typeof admin, player: typeof admin, other: typeof admin, coach: typeof admin;
let courtId = '';

beforeAll(async () => {
  admin = await makeUser('CLUB_ADMIN'); staff = await makeUser('STAFF'); player = await makeUser(); other = await makeUser(); coach = await makeUser('COACH');
  const c = await admin.post('/api/courts', { name: `Test court ${Date.now()}`, location: 'Hall', hourlyPriceCents: 40000, schedules: allWeek() });
  expect(c.status).toBe(201); courtId = c.body.court.id;
});

describe('auth', () => {
  it('registers, reads the session and logs out', async () => {
    const agent = request.agent(app);
    const r = await agent.post('/api/auth/register').set(H).send({ email: `new${Date.now()}@test.dev`, password: 'Secret1234', fullName: 'New Player' });
    expect(r.status).toBe(201);
    const me = await agent.get('/api/auth/me');
    expect(me.body.user.role).toBe('PLAYER');
    await agent.post('/api/auth/logout').set(H);
    expect((await agent.get('/api/auth/me')).body.user).toBeNull();
  });
  it('rejects weak passwords and wrong credentials', async () => {
    expect((await request(app).post('/api/auth/register').set(H).send({ email: 'x@test.dev', password: 'short', fullName: 'X Y' })).status).toBe(422);
    expect((await request(app).post('/api/auth/login').set(H).send({ email: player.user.email, password: 'nope' })).status).toBe(401);
  });
  it('blocks state-changing requests without the CSRF header', async () => {
    expect((await player.agent.post('/api/reservations').send({})).status).toBe(403);
  });
});

describe('permissions are enforced on the server', () => {
  it('players cannot manage courts, reports or other players', async () => {
    expect((await player.post('/api/courts', { name: 'Hack', location: 'x', hourlyPriceCents: 1 })).status).toBe(403);
    expect((await player.get('/api/reports/revenue')).status).toBe(403);
    expect((await player.get('/api/players')).status).toBe(403);
    expect((await player.get(`/api/players/${other.user.id}`)).status).toBe(403);
  });
  it('staff cannot see financial reports or change court prices', async () => {
    expect((await staff.get('/api/reports/revenue')).status).toBe(403);
    expect((await staff.patch(`/api/courts/${courtId}`, { hourlyPriceCents: 1 })).status).toBe(422); // strict schema: status only
    expect((await staff.patch(`/api/courts/${courtId}`, { status: 'ACTIVE' })).status).toBe(200);
  });
  it('anonymous users cannot book', async () => {
    expect((await request(app).post('/api/reservations').set(H).send({})).status).toBe(401);
  });
});

describe('reservations', () => {
  const body = (startAt: string, durationMinutes = 60) => ({ courtId, startAt, durationMinutes, participants: 4 });
  it('quotes with a server-side price and ignores client prices', async () => {
    const q = await player.post('/api/reservations/quote', { ...body(at(1, '10:00'), 90), totalPriceCents: 1 });
    expect(q.status).toBe(200); expect(q.body.totalPriceCents).toBe(60000);
  });
  it('creates a booking and prevents an overlapping one', async () => {
    const a = await player.post('/api/reservations', body(at(1, '10:00')));
    expect(a.status).toBe(201); expect(a.body.reservation.reference).toMatch(/^PB-/);
    const b = await other.post('/api/reservations', body(at(1, '10:30')));
    expect(b.status).toBe(409);
    const edge = await other.post('/api/reservations', body(at(1, '11:00'))); // touching end is allowed
    expect(edge.status).toBe(201);
  });
  it('lets only one of many simultaneous requests win the same slot', async () => {
    const users = await Promise.all([1, 2, 3, 4, 5].map(() => makeUser()));
    const results = await Promise.all(users.map((u) => u.post('/api/reservations', body(at(2, '15:00')))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
  });
  it('validates hours, duration, alignment, capacity and the past', async () => {
    expect((await player.post('/api/reservations', body(at(1, '05:00')))).status).toBe(400);
    expect((await player.post('/api/reservations', body(at(1, '21:30')))).status).toBe(400);
    expect((await player.post('/api/reservations', body(at(1, '12:10')))).status).toBe(400);
    expect((await player.post('/api/reservations', body(at(1, '12:00'), 45))).status).toBe(400);
    expect((await player.post('/api/reservations', { ...body(at(1, '12:00')), participants: 9 })).status).toBe(422);
    expect((await player.post('/api/reservations', body(at(-1, '12:00')))).status).toBe(400);
    expect((await player.post('/api/reservations', body(at(40, '12:00')))).status).toBe(400); // beyond booking window
  });
  it('blocks booking during maintenance and on inactive courts', async () => {
    const m = await admin.post(`/api/courts/${courtId}/maintenance`, { startAt: at(3, '06:00'), endAt: at(3, '09:00'), reason: 'Repaint' });
    expect(m.status).toBe(201);
    expect((await player.post('/api/reservations', body(at(3, '07:00')))).status).toBe(409);
    const c2 = await admin.post('/api/courts', { name: `Closed ${Date.now()}`, location: 'x', hourlyPriceCents: 100, status: 'INACTIVE', schedules: allWeek() });
    expect((await player.post('/api/reservations', { ...body(at(1, '10:00')), courtId: c2.body.court.id })).status).toBe(400);
  });
  it('enforces the cancellation window for players but not staff', async () => {
    const p = await makeUser();
    const later = await p.post('/api/reservations', body(at(5, '10:00')));
    expect(later.status).toBe(201);
    expect((await other.post(`/api/reservations/${later.body.reservation.id}/cancel`, {})).status).toBe(404); // not theirs
    expect((await p.post(`/api/reservations/${later.body.reservation.id}/cancel`, {})).status).toBe(200);
    // a booking starting inside the 24h window: players are refused, staff may cancel
    const { db } = await import('../src/db/index.js'); const s = await import('../src/db/schema.js'); const { eq } = await import('drizzle-orm');
    const soon = await p.post('/api/reservations', body(at(5, '14:00')));
    await db.update(s.reservations).set({ startAt: new Date(Date.now() + 3 * 3600000), endAt: new Date(Date.now() + 4 * 3600000) }).where(eq(s.reservations.id, soon.body.reservation.id));
    const refused = await p.post(`/api/reservations/${soon.body.reservation.id}/cancel`, {});
    expect(refused.status).toBe(400); expect(refused.body.error.message).toMatch(/24 hours/);
    expect((await staff.post(`/api/reservations/${soon.body.reservation.id}/cancel`, {})).status).toBe(200);
  });
  it('requires payment before check-in and confirms on payment', async () => {
    const p = await makeUser();
    const r = await p.post('/api/reservations', body(at(6, '08:00')));
    const id = r.body.reservation.id;
    expect((await staff.post(`/api/reservations/${id}/status`, { status: 'CHECKED_IN' })).status).toBe(400); // pending → can't check in
    const pay = await staff.post('/api/payments', { purpose: 'RESERVATION', targetId: id, method: 'CASH', amountCents: 1 });
    expect(pay.status).toBe(201); expect(pay.body.payment.amountCents).toBe(40000); // server price wins
    const after = await p.get(`/api/reservations/${id}`);
    expect(after.body.reservation.status).toBe('CONFIRMED'); expect(after.body.reservation.paymentStatus).toBe('PAID');
    expect((await staff.post('/api/payments', { purpose: 'RESERVATION', targetId: id, method: 'CASH' })).status).toBe(400); // no double payment
    expect((await staff.post(`/api/reservations/${id}/status`, { status: 'CHECKED_IN' })).status).toBe(200);
  });
});

describe('memberships', () => {
  it('subscribes, activates on payment and applies the discount', async () => {
    const plan = await admin.post('/api/membership-plans', { name: `Gold ${Date.now()}`, priceCents: 100000, durationDays: 30, discountPercent: 20, advanceBookingDays: 30, maxActiveBookings: 5 });
    expect(plan.status).toBe(201);
    const m = await player.post('/api/memberships', { planId: plan.body.plan.id });
    expect(m.status).toBe(201); expect(m.body.membership.status).toBe('PENDING');
    expect((await player.post('/api/memberships', { planId: plan.body.plan.id })).status).toBe(409);
    await staff.post('/api/payments', { purpose: 'MEMBERSHIP', targetId: m.body.membership.id, method: 'CASH' });
    const me = await player.get('/api/memberships/me');
    expect(me.body.current.status).toBe('ACTIVE');
    const days = (new Date(me.body.current.endDate).getTime() - new Date(me.body.current.startDate).getTime()) / 86400000;
    expect(days).toBe(30);
    const q = await player.post('/api/reservations/quote', { courtId, startAt: at(7, '10:00'), durationMinutes: 60, participants: 2 });
    expect(q.body.discountCents).toBe(8000); expect(q.body.totalPriceCents).toBe(32000);
    // renewal queues after the current period
    const renew = await player.post('/api/memberships', { planId: plan.body.plan.id });
    await staff.post('/api/payments', { purpose: 'MEMBERSHIP', targetId: renew.body.membership.id, method: 'CASH' });
    const hist = (await player.get('/api/memberships/me')).body.history.filter((h: any) => h.status === 'ACTIVE');
    expect(hist).toHaveLength(2);
    const [newer, older] = hist; expect(new Date(newer.startDate).getTime()).toBe(new Date(older.endDate).getTime());
  });
});

describe('matches and scoring', () => {
  it('records live rallies, rejects unauthorized scorers, and updates rankings once', async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    const m = await staff.post('/api/matches', { format: 'SINGLES', category: 'COMPETITIVE', startAt: at(1, '09:00'), side1: [a.user.id], side2: [b.user.id], targetScore: 5, winBy: 2 });
    expect(m.status).toBe(201);
    const id = m.body.match.id;
    expect((await a.post(`/api/matches/${id}/start`, {})).status).toBe(403); // competitive: players may not score
    expect((await staff.post(`/api/matches/${id}/start`, { firstServingSide: 1 })).status).toBe(200);
    for (let i = 0; i < 4; i++) await staff.post(`/api/matches/${id}/rally`, { winner: 1 });
    const u = await staff.post(`/api/matches/${id}/undo`, {});
    expect(u.body.state.games[0].s1).toBe(3);
    await staff.post(`/api/matches/${id}/rally`, { winner: 1 });
    const fin = await staff.post(`/api/matches/${id}/rally`, { winner: 1 });
    expect(fin.body.state.completed).toBe(true);
    expect((await staff.post(`/api/matches/${id}/rally`, { winner: 1 })).status).toBe(400);
    const lb = await player.get('/api/rankings?format=SINGLES');
    const ra = lb.body.items.find((x: any) => x.userId === a.user.id);
    expect(ra.rating).toBe(1016); expect(ra.wins).toBe(1);
  });
  it('rejects impossible final scores and audits corrections', async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    const m = await staff.post('/api/matches', { format: 'SINGLES', category: 'COMPETITIVE', startAt: at(1, '11:00'), side1: [a.user.id], side2: [b.user.id] });
    const id = m.body.match.id;
    expect((await staff.post(`/api/matches/${id}/result`, { games: [{ s1: 11, s2: 10 }] })).status).toBe(400);
    expect((await staff.post(`/api/matches/${id}/result`, { games: [{ s1: 15, s2: 11 }] })).status).toBe(400);
    expect((await staff.post(`/api/matches/${id}/result`, { games: [{ s1: 11, s2: 6 }] })).status).toBe(200);
    expect((await staff.post(`/api/matches/${id}/correct`, { games: [{ s1: 6, s2: 11 }], reason: 'Scores were swapped' })).status).toBe(403); // competitive: admin only
    const c = await admin.post(`/api/matches/${id}/correct`, { games: [{ s1: 6, s2: 11 }], reason: 'Scores were swapped' });
    expect(c.status).toBe(200);
    const lb = (await player.get('/api/rankings?format=SINGLES')).body.items;
    expect(lb.find((x: any) => x.userId === b.user.id).rating).toBe(1016);
    expect(lb.find((x: any) => x.userId === a.user.id).rating).toBe(984);
    const audit = await (await makeUser('SUPER_ADMIN')).get('/api/admin/audit?entity=match');
    expect(audit.body.items.some((x: any) => x.action === 'match.score_correction' && x.entityId === id)).toBe(true);
  });
  it('prevents a player being double-booked into overlapping matches', async () => {
    const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
    expect((await staff.post('/api/matches', { format: 'SINGLES', startAt: at(4, '18:00'), side1: [a.user.id], side2: [b.user.id] })).status).toBe(201);
    expect((await staff.post('/api/matches', { format: 'SINGLES', startAt: at(4, '18:30'), side1: [a.user.id], side2: [c.user.id] })).status).toBe(409);
  });
});

describe('tournaments', () => {
  it('registers without duplicates, generates a bracket and crowns a champion', async () => {
    const t = await admin.post('/api/tournaments', { name: `Cup ${Date.now()}`, startDate: at(10, '08:00'), endDate: at(10, '20:00'), registrationDeadline: at(9, '08:00'), venue: 'Hall', format: 'SINGLE_ELIMINATION', category: 'SINGLES', maxParticipants: 5 });
    expect(t.status).toBe(201);
    const id = t.body.tournament.id;
    expect((await player.post(`/api/tournaments/${id}/register`, {})).status).toBe(400); // still draft
    await admin.post(`/api/tournaments/${id}/status`, { action: 'open' });
    const ps = await Promise.all([1, 2, 3, 4, 5].map(() => makeUser()));
    for (const p of ps) expect((await p.post(`/api/tournaments/${id}/register`, {})).status).toBe(201);
    expect((await ps[0].post(`/api/tournaments/${id}/register`, {})).status).toBe(409);
    expect((await player.post(`/api/tournaments/${id}/register`, {})).status).toBe(409); // full
    expect((await admin.post(`/api/tournaments/${id}/status`, { action: 'start' })).status).toBe(200);
    for (let guard = 0; guard < 10; guard++) {
      const d = await admin.get(`/api/tournaments/${id}`);
      if (d.body.tournament.status === 'COMPLETED') break;
      const next = d.body.brackets[0].matches.find((m: any) => m.matchId && m.status === 'SCHEDULED');
      expect(next).toBeTruthy();
      expect((await staff.post(`/api/matches/${next.matchId}/result`, { games: [{ s1: 11, s2: 3 }] })).status).toBe(200);
    }
    const done = await admin.get(`/api/tournaments/${id}`);
    expect(done.body.tournament.status).toBe('COMPLETED');
    expect(done.body.tournament.championTeamId).toBeTruthy();
    expect(done.body.brackets[0].matches.filter((m: any) => m.isBye)).toHaveLength(3);
  });
  it('runs group stage into knockout', async () => {
    const t = await admin.post('/api/tournaments', { name: `Groups ${Date.now()}`, startDate: at(12, '08:00'), endDate: at(12, '20:00'), registrationDeadline: at(11, '08:00'), venue: 'Hall', format: 'GROUP_KNOCKOUT', category: 'SINGLES', maxParticipants: 8, groupCount: 2 });
    const id = t.body.tournament.id;
    await admin.post(`/api/tournaments/${id}/status`, { action: 'open' });
    for (const p of await Promise.all([1, 2, 3, 4, 5, 6].map(() => makeUser()))) await p.post(`/api/tournaments/${id}/register`, {});
    await admin.post(`/api/tournaments/${id}/status`, { action: 'start' });
    for (let guard = 0; guard < 30; guard++) {
      const d = await admin.get(`/api/tournaments/${id}`);
      if (d.body.tournament.status === 'COMPLETED') break;
      const next = d.body.brackets.flatMap((b: any) => b.matches).find((m: any) => m.matchId && m.status === 'SCHEDULED');
      await staff.post(`/api/matches/${next.matchId}/result`, { games: [{ s1: 11, s2: 7 }] });
    }
    const d = await admin.get(`/api/tournaments/${id}`);
    expect(d.body.brackets.map((b: any) => b.name)).toEqual(['Group A', 'Group B', 'Knockout']);
    expect(d.body.tournament.status).toBe('COMPLETED');
  });
  it('refuses double elimination honestly', async () => {
    const t = await admin.post('/api/tournaments', { name: 'Double elim cup', startDate: at(10, '08:00'), endDate: at(10, '20:00'), registrationDeadline: at(9, '08:00'), venue: 'Hall', format: 'DOUBLE_ELIMINATION', category: 'SINGLES', maxParticipants: 8 });
    expect(t.status).toBe(400);
  });
});

describe('reports and dashboards', () => {
  it('builds reports from real data and exports CSV', async () => {
    const r = await admin.get(`/api/reports/reservations?from=${ymd(-1)}&to=${ymd(10)}`);
    expect(r.status).toBe(200); expect(r.body.rows.length).toBeGreaterThan(0);
    const c = await admin.get(`/api/reports/revenue?from=${ymd(-1)}&to=${ymd(1)}&format=csv`);
    expect(c.headers['content-type']).toMatch(/text\/csv/); expect(c.text).toContain('Court bookings');
    const d = await admin.get('/api/dashboard/admin');
    expect(d.body.stats.courts).toBeGreaterThan(0);
    const sd = await staff.get('/api/dashboard/admin');
    expect(sd.body.stats.month_revenue).toBeNull(); // staff don't see finance
    expect((await player.get('/api/dashboard/player')).status).toBe(200);
  });
  it('notifications work in-app', async () => {
    const n = await player.get('/api/notifications');
    expect(n.body.items.length).toBeGreaterThan(0);
    await player.post('/api/notifications/read-all');
    expect((await player.get('/api/notifications?unread=1')).body.items).toHaveLength(0);
  });
});

describe('coaching', () => {
  it('prevents coach double booking and limits capacity', async () => {
    const sa = await makeUser('SUPER_ADMIN');
    const c = await sa.post('/api/coaching/coaches', { userId: coach.user.id, hourlyRateCents: 50000 });
    expect(c.status).toBe(201);
    const s1 = await coach.post('/api/coaching/sessions', { title: 'Dinking 101', kind: 'INDIVIDUAL', startAt: at(8, '09:00'), durationMinutes: 60, priceCents: 50000, capacity: 1 });
    expect(s1.status).toBe(201);
    expect((await coach.post('/api/coaching/sessions', { title: 'Overlap', kind: 'GROUP', startAt: at(8, '09:30'), durationMinutes: 60, priceCents: 0, capacity: 4 })).status).toBe(409);
    expect((await player.post(`/api/coaching/sessions/${s1.body.session.id}/enroll`, {})).status).toBe(201);
    expect((await other.post(`/api/coaching/sessions/${s1.body.session.id}/enroll`, {})).status).toBe(409);
    expect((await coach.get(`/api/players/${player.user.id}`)).status).toBe(200); // assigned
    expect((await coach.get(`/api/players/${other.user.id}`)).status).toBe(403); // not assigned
  });
});
void ymd;

describe('database integrity', () => {
  it('the exclusion constraint rejects overlapping rows even when the API is bypassed', async () => {
    const { db } = await import('../src/db/index.js'); const s = await import('../src/db/schema.js');
    const base = { userId: player.user.id, createdById: player.user.id, courtId, participants: 2, basePriceCents: 1, totalPriceCents: 1, status: 'CONFIRMED' as const };
    await db.insert(s.reservations).values({ ...base, reference: `RAW-${Date.now()}-1`, startAt: new Date(at(20, '10:00')), endAt: new Date(at(20, '11:00')) });
    await expect(db.insert(s.reservations).values({ ...base, reference: `RAW-${Date.now()}-2`, startAt: new Date(at(20, '10:30')), endAt: new Date(at(20, '11:30')) })).rejects.toMatchObject({ code: '23P01' });
  });
});
