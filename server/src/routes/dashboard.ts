import { Router } from 'express';
import { sql, and, eq, gte, inArray, asc, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { reservations, courts, matches, matchParticipants, notifications, rankings, tournaments, announcements, users, payments, coachingEnrollments, coachingSessions } from '../db/schema.js';
import { ah } from '../lib/http.js';
import { requireAuth, requireRole, STAFF_UP, isAdmin } from '../lib/auth.js';
import { CLUB_TZ, todayYmd, dayRange } from '../lib/time.js';
import { expireMemberships, currentMembership } from '../services/membership.js';

export const r = Router();
r.use(requireAuth);
const one = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows[0] as Record<string, any>;
const many = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows as Record<string, any>[];

r.get('/admin', requireRole(...STAFF_UP), ah(async (req, res) => {
  await expireMemberships();
  const { start, end } = dayRange(todayYmd());
  const now = new Date();
  const tz = sql.raw(`'${CLUB_TZ.replace(/'/g, '')}'`);
  const finance = isAdmin(req.user);
  const stats = await one(sql`select
    (select count(*) from users where role='PLAYER')::int as players,
    (select count(distinct user_id) from memberships where status='ACTIVE' and start_date <= now() and end_date > now())::int as active_members,
    (select count(*) from courts)::int as courts,
    (select count(*) from courts where status='ACTIVE')::int as active_courts,
    (select count(distinct court_id) from reservations where status in ('CONFIRMED','CHECKED_IN') and start_at <= now() and end_at > now())::int as occupied,
    (select count(*) from reservations where start_at >= ${start} and start_at < ${end} and status <> 'CANCELLED')::int as today,
    (select count(*) from reservations where start_at >= ${end} and status in ('PENDING','CONFIRMED'))::int as upcoming,
    (select count(*) from tournaments where status in ('OPEN','IN_PROGRESS'))::int as active_tournaments,
    (select count(*) from matches where start_at >= ${start} and start_at < ${end} and status <> 'CANCELLED')::int as matches_today,
    (select coalesce(sum(amount_cents),0) from payments where status in ('PAID','REFUNDED') and date_trunc('month', paid_at at time zone ${tz}) = date_trunc('month', now() at time zone ${tz}))::int
      - (select coalesce(sum(amount_cents),0) from refunds where date_trunc('month', created_at at time zone ${tz}) = date_trunc('month', now() at time zone ${tz}))::int as month_revenue,
    ((select count(*) from reservations where payment_status='UNPAID' and status in ('PENDING','CONFIRMED','CHECKED_IN'))
      + (select count(*) from memberships where status='PENDING')
      + (select count(*) from tournament_registrations x join tournaments t on t.id=x.tournament_id where x.payment_status='UNPAID' and t.fee_cents>0 and t.status in ('OPEN','IN_PROGRESS')))::int as pending_payments,
    (select count(*) from reservations where status='CANCELLED' and cancelled_at >= now() - interval '30 days')::int as cancelled_30d`);
  const charts = {
    reservations: await many(sql`select to_char(d, 'MM-DD') as label, coalesce(x.n,0)::int as value from generate_series((now() at time zone ${tz})::date - 29, (now() at time zone ${tz})::date, '1 day') d
      left join (select (start_at at time zone ${tz})::date as day, count(*) n from reservations where status <> 'CANCELLED' group by 1) x on x.day = d order by d`),
    revenue: finance ? await many(sql`select to_char(m, 'Mon YY') as label, coalesce(x.v,0)::int as value from generate_series(date_trunc('month', now() at time zone ${tz}) - interval '11 months', date_trunc('month', now() at time zone ${tz}), '1 month') m
      left join (select date_trunc('month', paid_at at time zone ${tz}) as mo, sum(amount_cents) v from payments where status in ('PAID','REFUNDED') group by 1) x on x.mo = m order by m`) : [],
    membership: await many(sql`select to_char(m, 'Mon YY') as label, (select count(*) from memberships s where s.status in ('ACTIVE','EXPIRED') and s.start_date < m + interval '1 month' and s.end_date >= m)::int as value
      from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), '1 month') m order by m`),
    utilization: await many(sql`select c.name as label, coalesce(round(sum(extract(epoch from (r.end_at - r.start_at))/3600)::numeric,1),0)::float as value
      from courts c left join reservations r on r.court_id=c.id and r.status in ('CONFIRMED','CHECKED_IN','COMPLETED') and r.start_at >= now() - interval '7 days' and r.start_at < now()
      group by c.name order by c.name`),
    tournaments: await many(sql`select t.name as label, count(x.id)::int as value, t.max_participants as capacity from tournaments t left join tournament_teams x on x.tournament_id=t.id
      where t.status <> 'CANCELLED' group by t.id order by t.start_date desc limit 6`),
    hours: await many(sql`select lpad(h::text, 2, '0') || ':00' as label, coalesce(x.n,0)::int as value from generate_series(5, 23) h
      left join (select extract(hour from start_at at time zone ${tz})::int hr, count(*) n from reservations where status <> 'CANCELLED' and start_at >= now() - interval '90 days' group by 1) x on x.hr = h order by h`),
  };
  const recent = {
    reservations: await many(sql`select r.id, r.reference, r.start_at, r.status, r.payment_status, r.total_price_cents, u.full_name as player, c.name as court from reservations r join users u on u.id=r.user_id join courts c on c.id=r.court_id order by r.created_at desc limit 6`),
    payments: finance ? await many(sql`select p.id, p.reference, p.amount_cents, p.method, p.purpose, p.paid_at, u.full_name as player from payments p join users u on u.id=p.user_id order by p.paid_at desc limit 6`) : [],
    tournaments: await many(sql`select id, name, start_date, status, max_participants, (select count(*) from tournament_teams x where x.tournament_id=t.id)::int as entries from tournaments t where status in ('OPEN','IN_PROGRESS','DRAFT') order by start_date limit 5`),
    players: await many(sql`select id, full_name, email, created_at from users where role='PLAYER' order by created_at desc limit 6`),
  };
  const alerts: { level: 'warn' | 'info'; text: string; link: string }[] = [];
  const unpaidSoon = await one(sql`select count(*)::int n from reservations where payment_status='UNPAID' and status in ('PENDING','CONFIRMED') and start_at between now() and now() + interval '24 hours'`);
  if (unpaidSoon.n) alerts.push({ level: 'warn', text: `${unpaidSoon.n} booking(s) in the next 24 hours are unpaid`, link: '/app/payments/desk' });
  const maint = await many(sql`select c.name, m.reason from court_maintenance m join courts c on c.id=m.court_id where m.start_at <= now() and m.end_at > now()`);
  for (const m of maint) alerts.push({ level: 'info', text: `${m.name} is closed for maintenance: ${m.reason}`, link: '/app/courts' });
  const expiring = await one(sql`select count(*)::int n from memberships where status='ACTIVE' and end_date between now() and now() + interval '7 days'`);
  if (expiring.n) alerts.push({ level: 'info', text: `${expiring.n} membership(s) expire within 7 days`, link: '/app/memberships/manage' });
  const overdue = await one(sql`select count(*)::int n from reservations where status in ('PENDING','CONFIRMED') and end_at < now()`);
  if (overdue.n) alerts.push({ level: 'warn', text: `${overdue.n} past booking(s) still need check-in, completion or no-show`, link: '/app/reservations?scope=past&status=PENDING,CONFIRMED' });
  const deadlines = await many(sql`select id, name from tournaments where status='DRAFT' and start_date > now() and start_date < now() + interval '14 days'`);
  for (const d of deadlines) alerts.push({ level: 'warn', text: `${d.name} starts within 2 weeks but registration isn't open`, link: `/app/tournaments/${d.id}` });
  res.json({ stats: finance ? stats : { ...stats, month_revenue: null }, charts, recent, alerts, finance });
}));

r.get('/player', ah(async (req, res) => {
  await expireMemberships();
  const id = req.user!.id; const now = new Date();
  const [upcoming, myMatches, notes, ranks, mem, ann, nextTournaments, courtsOpen, coaching] = await Promise.all([
    db.select({ r: reservations, court: courts.name }).from(reservations).innerJoin(courts, eq(courts.id, reservations.courtId)).where(and(eq(reservations.userId, id), gte(reservations.endAt, now), inArray(reservations.status, ['PENDING', 'CONFIRMED', 'CHECKED_IN']))).orderBy(asc(reservations.startAt)).limit(5),
    db.select({ m: matches }).from(matchParticipants).innerJoin(matches, eq(matches.id, matchParticipants.matchId)).where(and(eq(matchParticipants.userId, id), inArray(matches.status, ['SCHEDULED', 'IN_PROGRESS']))).orderBy(asc(matches.startAt)).limit(5),
    db.select().from(notifications).where(eq(notifications.userId, id)).orderBy(desc(notifications.createdAt)).limit(6),
    db.select().from(rankings).where(eq(rankings.userId, id)),
    currentMembership(id),
    db.select().from(announcements).orderBy(desc(announcements.pinned), desc(announcements.publishedAt)).limit(3),
    db.select().from(tournaments).where(and(eq(tournaments.status, 'OPEN'), gte(tournaments.registrationDeadline, now))).orderBy(asc(tournaments.startDate)).limit(3),
    db.select({ id: courts.id, name: courts.name, indoor: courts.indoor, hourlyPriceCents: courts.hourlyPriceCents }).from(courts).where(eq(courts.status, 'ACTIVE')).orderBy(asc(courts.name)),
    db.select({ s: coachingSessions }).from(coachingEnrollments).innerJoin(coachingSessions, eq(coachingSessions.id, coachingEnrollments.sessionId)).where(and(eq(coachingEnrollments.playerId, id), gte(coachingSessions.startAt, now), eq(coachingSessions.status, 'SCHEDULED'))).orderBy(asc(coachingSessions.startAt)).limit(3),
  ]);
  const spent = await one(sql`select coalesce(sum(amount_cents),0)::int as total from payments where user_id=${id} and status='PAID'`);
  res.json({
    upcoming: upcoming.map((x) => ({ ...x.r, courtName: x.court })), matches: myMatches.map((x) => x.m), notifications: notes, rankings: ranks,
    membership: mem ? { ...mem.m, plan: mem.plan } : null, announcements: ann, tournaments: nextTournaments, courts: courtsOpen, coaching: coaching.map((x) => x.s), spentCents: spent.total,
  });
}));
void users; void payments;
