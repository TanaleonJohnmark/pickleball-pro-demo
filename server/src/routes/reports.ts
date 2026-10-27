import { Router } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { ah, parse, badRequest } from '../lib/http.js';
import { requireRole, ADMIN } from '../lib/auth.js';
import { CLUB_TZ, localToUtc, addDays, todayYmd, toMinutes } from '../lib/time.js';

export const r = Router();
r.use(requireRole(...ADMIN)); // financial and operational reports: administrators only

type Col = { key: string; label: string; money?: boolean };
type Report = { title: string; columns: Col[]; rows: Record<string, unknown>[]; summary?: Record<string, unknown> };
const rows = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows as Record<string, any>[];

function csv(rep: Report) {
  const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = rep.columns.map((c) => esc(c.label)).join(',');
  const body = rep.rows.map((r) => rep.columns.map((c) => esc(c.money ? (Number(r[c.key] ?? 0) / 100).toFixed(2) : r[c.key])).join(','));
  return [head, ...body].join('\n');
}

export async function buildReport(type: string, fromYmd: string, toYmd: string, group: 'day' | 'month'): Promise<Report> {
  const from = localToUtc(fromYmd, '00:00'), to = addDays(localToUtc(toYmd, '00:00'), 1);
  const bucket = (col: string) => sql.raw(`to_char(date_trunc('${group}', ${col} at time zone '${CLUB_TZ.replace(/'/g, '')}'), '${group === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM'}')`);
  switch (type) {
    case 'reservations': {
      const r = await rows(sql`select ${bucket('start_at')} as period, count(*)::int as total,
        count(*) filter (where status in ('CONFIRMED','CHECKED_IN','COMPLETED'))::int as confirmed,
        count(*) filter (where status = 'CANCELLED')::int as cancelled, count(*) filter (where status = 'NO_SHOW')::int as no_show,
        coalesce(sum(total_price_cents) filter (where status <> 'CANCELLED'),0)::int as booked_value
        from reservations where start_at >= ${from} and start_at < ${to} group by 1 order by 1`);
      return { title: 'Reservations', columns: [{ key: 'period', label: 'Period' }, { key: 'total', label: 'Bookings' }, { key: 'confirmed', label: 'Confirmed / played' }, { key: 'cancelled', label: 'Cancelled' }, { key: 'no_show', label: 'No-shows' }, { key: 'booked_value', label: 'Booked value', money: true }], rows: r,
        summary: { bookings: r.reduce((a, x) => a + x.total, 0), cancelled: r.reduce((a, x) => a + x.cancelled, 0) } };
    }
    case 'revenue': {
      const r = await rows(sql`select ${bucket('p.paid_at')} as period,
        coalesce(sum(p.amount_cents) filter (where p.purpose='RESERVATION'),0)::int as reservations,
        coalesce(sum(p.amount_cents) filter (where p.purpose='MEMBERSHIP'),0)::int as memberships,
        coalesce(sum(p.amount_cents) filter (where p.purpose='TOURNAMENT'),0)::int as tournaments,
        coalesce(sum(p.amount_cents) filter (where p.purpose='COACHING'),0)::int as coaching,
        coalesce(sum(p.amount_cents) filter (where p.purpose='OTHER'),0)::int as other,
        coalesce(sum(p.amount_cents),0)::int as gross
        from payments p where p.paid_at >= ${from} and p.paid_at < ${to} and p.status in ('PAID','REFUNDED') group by 1 order by 1`);
      const ref = await rows(sql`select ${bucket('created_at')} as period, coalesce(sum(amount_cents),0)::int as refunds from refunds where created_at >= ${from} and created_at < ${to} group by 1`);
      const periods = [...new Set([...r.map((x) => x.period), ...ref.map((x) => x.period)])].sort();
      const out = periods.map((p) => { const a: Record<string, any> = r.find((x) => x.period === p) ?? { reservations: 0, memberships: 0, tournaments: 0, coaching: 0, other: 0, gross: 0 }; const f = ref.find((x) => x.period === p)?.refunds ?? 0; return { ...a, period: p, refunds: f, net: a.gross - f } as Record<string, any>; });
      return { title: 'Revenue', columns: [{ key: 'period', label: 'Period' }, { key: 'reservations', label: 'Court bookings', money: true }, { key: 'memberships', label: 'Memberships', money: true }, { key: 'tournaments', label: 'Tournaments', money: true }, { key: 'coaching', label: 'Coaching', money: true }, { key: 'other', label: 'Other', money: true }, { key: 'refunds', label: 'Refunds', money: true }, { key: 'net', label: 'Net', money: true }], rows: out,
        summary: { gross: out.reduce((a, x) => a + x.gross, 0), refunds: out.reduce((a, x) => a + x.refunds, 0), net: out.reduce((a, x) => a + x.net, 0) } };
    }
    case 'utilization': {
      const courtsRows = await rows(sql`select c.id, c.name, c.status from courts c order by c.name`);
      const sched = await rows(sql`select court_id, day_of_week, open_time, close_time from court_schedules`);
      const booked = await rows(sql`select court_id, coalesce(sum(extract(epoch from (least(end_at, ${to}) - greatest(start_at, ${from})))/3600),0)::float as hours, count(*)::int as bookings
        from reservations where status in ('CONFIRMED','CHECKED_IN','COMPLETED','PENDING') and start_at < ${to} and end_at > ${from} group by court_id`);
      const days: number[] = []; for (let d = new Date(`${fromYmd}T12:00:00Z`); d <= new Date(`${toYmd}T12:00:00Z`); d = addDays(d, 1)) days.push(d.getUTCDay());
      const out = courtsRows.map((c) => {
        const open = days.reduce((a, dow) => { const s = sched.find((x) => x.court_id === c.id && x.day_of_week === dow); return a + (s ? (toMinutes(s.close_time) - toMinutes(s.open_time)) / 60 : 0); }, 0);
        const b = booked.find((x) => x.court_id === c.id);
        const hours = Math.round((b?.hours ?? 0) * 10) / 10;
        return { court: c.name, status: c.status, bookings: b?.bookings ?? 0, booked_hours: hours, open_hours: open, utilization: open ? `${Math.round((hours / open) * 100)}%` : '—' };
      });
      return { title: 'Court utilization', columns: [{ key: 'court', label: 'Court' }, { key: 'status', label: 'Status' }, { key: 'bookings', label: 'Bookings' }, { key: 'booked_hours', label: 'Booked hours' }, { key: 'open_hours', label: 'Open hours' }, { key: 'utilization', label: 'Utilization' }], rows: out };
    }
    case 'registrations': {
      const r = await rows(sql`select ${bucket('created_at')} as period, count(*)::int as players from users where role='PLAYER' and created_at >= ${from} and created_at < ${to} group by 1 order by 1`);
      return { title: 'Player registrations', columns: [{ key: 'period', label: 'Period' }, { key: 'players', label: 'New players' }], rows: r, summary: { total: r.reduce((a, x) => a + x.players, 0) } };
    }
    case 'memberships': {
      const r = await rows(sql`select ${bucket('m.created_at')} as period, p.name as plan, count(*)::int as signups,
        count(*) filter (where m.status in ('ACTIVE','EXPIRED'))::int as paid, coalesce(sum(m.price_cents) filter (where m.status in ('ACTIVE','EXPIRED')),0)::int as value
        from memberships m join membership_plans p on p.id = m.plan_id where m.created_at >= ${from} and m.created_at < ${to} group by 1,2 order by 1,2`);
      return { title: 'Membership growth', columns: [{ key: 'period', label: 'Period' }, { key: 'plan', label: 'Plan' }, { key: 'signups', label: 'Sign-ups' }, { key: 'paid', label: 'Activated' }, { key: 'value', label: 'Value', money: true }], rows: r };
    }
    case 'tournaments': {
      const r = await rows(sql`select t.name, t.status, t.format, t.category, to_char(t.start_date at time zone ${CLUB_TZ}, 'YYYY-MM-DD') as start_date, t.max_participants,
        (select count(*) from tournament_teams x where x.tournament_id=t.id)::int as entries,
        (select count(*) from tournament_registrations x where x.tournament_id=t.id and x.payment_status='PAID')::int as paid_players,
        (select x.name from tournament_teams x where x.id = t.champion_team_id) as champion
        from tournaments t where t.start_date >= ${from} and t.start_date < ${to} order by t.start_date`);
      return { title: 'Tournament participation', columns: [{ key: 'name', label: 'Tournament' }, { key: 'start_date', label: 'Starts' }, { key: 'status', label: 'Status' }, { key: 'format', label: 'Format' }, { key: 'category', label: 'Category' }, { key: 'entries', label: 'Entries' }, { key: 'max_participants', label: 'Capacity' }, { key: 'paid_players', label: 'Paid players' }, { key: 'champion', label: 'Champion' }], rows: r };
    }
    case 'matches': {
      const r = await rows(sql`select to_char(m.start_at at time zone ${CLUB_TZ}, 'YYYY-MM-DD HH24:MI') as played, m.format, m.category,
        (select string_agg(u.full_name, ' & ') from match_participants mp join users u on u.id=mp.user_id where mp.match_id=m.id and mp.side=1) as side1,
        (select string_agg(u.full_name, ' & ') from match_participants mp join users u on u.id=mp.user_id where mp.match_id=m.id and mp.side=2) as side2,
        (select string_agg(s.side1_score || '-' || s.side2_score, ', ' order by s.game_number) from match_scores s where s.match_id=m.id) as score, m.winner_side
        from matches m where m.status='COMPLETED' and m.start_at >= ${from} and m.start_at < ${to} order by m.start_at desc`);
      return { title: 'Match results', columns: [{ key: 'played', label: 'Date' }, { key: 'format', label: 'Format' }, { key: 'category', label: 'Type' }, { key: 'side1', label: 'Side 1' }, { key: 'side2', label: 'Side 2' }, { key: 'score', label: 'Score' }, { key: 'winner_side', label: 'Winner side' }], rows: r };
    }
    case 'cancellations': {
      const r = await rows(sql`select ${bucket('start_at')} as period, count(*)::int as bookings, count(*) filter (where status='CANCELLED')::int as cancelled,
        round(100.0 * count(*) filter (where status='CANCELLED') / nullif(count(*),0), 1)::float as rate
        from reservations where start_at >= ${from} and start_at < ${to} group by 1 order by 1`);
      return { title: 'Cancellation rate', columns: [{ key: 'period', label: 'Period' }, { key: 'bookings', label: 'Bookings' }, { key: 'cancelled', label: 'Cancelled' }, { key: 'rate', label: 'Rate %' }], rows: r };
    }
    case 'outstanding': {
      const r = await rows(sql`select 'Court booking' as item, r.reference as ref, u.full_name as player, to_char(r.start_at at time zone ${CLUB_TZ}, 'YYYY-MM-DD HH24:MI') as due, r.total_price_cents as amount
          from reservations r join users u on u.id=r.user_id where r.payment_status='UNPAID' and r.status in ('PENDING','CONFIRMED','CHECKED_IN')
        union all select 'Membership', p.name, u.full_name, to_char(m.created_at at time zone ${CLUB_TZ}, 'YYYY-MM-DD'), m.price_cents
          from memberships m join users u on u.id=m.user_id join membership_plans p on p.id=m.plan_id where m.status='PENDING'
        union all select 'Tournament entry', t.name, u.full_name, to_char(t.start_date at time zone ${CLUB_TZ}, 'YYYY-MM-DD'), t.fee_cents
          from tournament_registrations x join tournaments t on t.id=x.tournament_id join users u on u.id=x.user_id where x.payment_status='UNPAID' and t.fee_cents > 0 and t.status in ('OPEN','IN_PROGRESS')
        order by 4`);
      return { title: 'Outstanding payments', columns: [{ key: 'item', label: 'Item' }, { key: 'ref', label: 'Reference' }, { key: 'player', label: 'Player' }, { key: 'due', label: 'Date' }, { key: 'amount', label: 'Amount', money: true }], rows: r, summary: { total: r.reduce((a, x) => a + Number(x.amount), 0) } };
    }
    default: throw badRequest('Unknown report');
  }
}

r.get('/:type', ah(async (req, res) => {
  const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const q = parse(z.object({ from: ymd.optional(), to: ymd.optional(), group: z.enum(['day', 'month']).default('day'), format: z.enum(['json', 'csv']).default('json') }), req.query);
  const to = q.to ?? todayYmd();
  const from = q.from ?? new Date(addDays(new Date(`${to}T12:00:00Z`), -30)).toISOString().slice(0, 10);
  if (from > to) throw badRequest('The start date must be before the end date');
  const rep = await buildReport(req.params.type, from, to, q.group);
  if (q.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}_${from}_${to}.csv"`);
    return res.send('\uFEFF' + csv(rep));
  }
  res.json({ ...rep, from, to });
}));
