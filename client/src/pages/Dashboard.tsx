import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line } from 'recharts';
import { AlertTriangle, Info, CalendarPlus } from 'lucide-react';
import { api } from '../lib/api';
import { C, has } from '../lib/brand';
import { useAuth, can } from '../lib/auth';
import { peso, pesoShort, dateTime, date, humanize, weekday, time } from '../lib/format';
import { Card, StatCard, Loading, ErrorBox, Status, Empty, Button, PageHeader, Badge } from '../components/ui';

const axis = { stroke: C.navy['300'], fontSize: 12, tickLine: false, axisLine: false } as const;
const tip = { contentStyle: { borderRadius: 8, border: '1px solid #E3EAF3', fontSize: 13 } };

function Chart({ title, children, empty }: { title: string; children: React.ReactElement; empty?: boolean }) {
  return <Card title={title}>{empty ? <p className="py-10 text-center text-navy-600">No data yet.</p> : <div className="h-56"><ResponsiveContainer>{children}</ResponsiveContainer></div>}</Card>;
}

function AdminDashboard() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['dash-admin'], queryFn: () => api.get('/dashboard/admin'), refetchInterval: 60_000 });
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={refetch} />;
  const s = data.stats, c = data.charts;
  return (
    <>
      <PageHeader title="Today at the club" sub={date(new Date())} actions={<><Link to="/app/calendar"><Button variant="secondary">Open calendar</Button></Link><Link to="/app/book"><Button><CalendarPlus className="h-4 w-4" />New booking</Button></Link></>} />
      {data.alerts.length > 0 && (
        <div className="mb-6 space-y-2">{data.alerts.map((a: any, i: number) => (
          <Link key={i} to={a.link} className={`flex items-center gap-3 rounded-md border px-4 py-2.5 text-sm font-medium ${a.level === 'warn' ? 'border-gold-400 bg-gold-100 text-[#6B4E06]' : 'border-cyan-100 bg-cyan-100/50 text-[#0B6F80]'}`}>
            {a.level === 'warn' ? <AlertTriangle className="h-4 w-4" /> : <Info className="h-4 w-4" />}{a.text}
          </Link>))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <StatCard label="Courts in play now" value={`${s.occupied}/${s.active_courts}`} note={`${s.courts} courts total`} accent="cyan" />
        <StatCard label="Bookings today" value={s.today} />
        <StatCard label="Upcoming bookings" value={s.upcoming} />
        {has('matches') && <StatCard label="Matches today" value={s.matches_today} />}
        <StatCard label="Pending payments" value={s.pending_payments} accent={s.pending_payments ? 'gold' : undefined} />
        {data.finance ? <StatCard label="Revenue this month" value={pesoShort(s.month_revenue)} note="Net of refunds" accent="green" /> : null}
        <StatCard label="Registered players" value={s.players} />
        {has('memberships') && <StatCard label="Active members" value={s.active_members} />}
        {has('tournaments') && <StatCard label="Active tournaments" value={s.active_tournaments} />}
        <StatCard label="Cancelled (30 days)" value={s.cancelled_30d} accent={s.cancelled_30d ? 'red' : undefined} />
      </div>
      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Chart title="Reservations, last 30 days" empty={!c.reservations.some((x: any) => x.value)}>
          <AreaChart data={c.reservations}><CartesianGrid vertical={false} stroke={C.navy['100']} /><XAxis dataKey="label" {...axis} interval={4} /><YAxis {...axis} width={28} allowDecimals={false} /><Tooltip {...tip} /><Area dataKey="value" name="Bookings" stroke={C.court['600']} fill={C.court['100']} strokeWidth={2} /></AreaChart>
        </Chart>
        {data.finance && <Chart title="Monthly revenue" empty={!c.revenue.some((x: any) => x.value)}>
          <BarChart data={c.revenue}><CartesianGrid vertical={false} stroke={C.navy['100']} /><XAxis dataKey="label" {...axis} /><YAxis {...axis} width={76} tickFormatter={(v) => pesoShort(v)} /><Tooltip {...tip} formatter={(v: number) => peso(v)} /><Bar dataKey="value" name="Revenue" fill={C.navy['900']} radius={[3, 3, 0, 0]} /></BarChart>
        </Chart>}
        {has('memberships') && <Chart title="Active memberships by month" empty={!c.membership.some((x: any) => x.value)}>
          <LineChart data={c.membership}><CartesianGrid vertical={false} stroke={C.navy['100']} /><XAxis dataKey="label" {...axis} /><YAxis {...axis} width={28} allowDecimals={false} /><Tooltip {...tip} /><Line dataKey="value" name="Members" stroke={C.gold['500']} strokeWidth={2.5} dot={false} /></LineChart>
        </Chart>}
        <Chart title="Court hours played, last 7 days" empty={!c.utilization.some((x: any) => x.value)}>
          <BarChart data={c.utilization} layout="vertical"><XAxis type="number" {...axis} /><YAxis type="category" dataKey="label" {...axis} width={120} /><Tooltip {...tip} /><Bar dataKey="value" name="Hours" fill={C.cyan['500']} radius={[0, 3, 3, 0]} /></BarChart>
        </Chart>
        <Chart title="Popular start times (90 days)" empty={!c.hours.some((x: any) => x.value)}>
          <BarChart data={c.hours}><XAxis dataKey="label" {...axis} interval={2} /><YAxis {...axis} width={28} allowDecimals={false} /><Tooltip {...tip} /><Bar dataKey="value" name="Bookings" fill={C.court['500']} radius={[3, 3, 0, 0]} /></BarChart>
        </Chart>
        {has('tournaments') && <Chart title="Tournament entries" empty={!c.tournaments.length}>
          <BarChart data={c.tournaments}><XAxis dataKey="label" {...axis} tickFormatter={(v: string) => v.length > 14 ? v.slice(0, 13) + '…' : v} /><YAxis {...axis} width={28} allowDecimals={false} /><Tooltip {...tip} /><Bar dataKey="capacity" name="Capacity" fill={C.navy['100']} /><Bar dataKey="value" name="Entries" fill={C.gold['400']} /></BarChart>
        </Chart>}
      </div>
      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card title="Recent bookings" action={<Link className="text-sm font-semibold text-court-600" to="/app/reservations">View all</Link>} pad={false}>
          <ul className="divide-y divide-navy-100">{data.recent.reservations.map((r: any) => (
            <li key={r.id}><Link to={`/app/reservations/${r.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-paper"><div><p className="font-semibold">{r.player}</p><p className="text-sm text-navy-600">{r.court} · {dateTime(r.start_at)}</p></div><div className="flex gap-1.5"><Status value={r.status} /><Status value={r.payment_status} /></div></Link></li>
          ))}</ul>
        </Card>
        {data.finance && <Card title="Recent payments" action={<Link className="text-sm font-semibold text-court-600" to="/app/payments">View all</Link>} pad={false}>
          <ul className="divide-y divide-navy-100">{data.recent.payments.map((p: any) => (
            <li key={p.id}><Link to={`/app/payments/${p.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-paper"><div><p className="font-semibold">{p.player}</p><p className="text-sm text-navy-600">{humanize(p.purpose)} · {humanize(p.method)} · {dateTime(p.paid_at)}</p></div><span className="num font-semibold">{peso(p.amount_cents)}</span></Link></li>
          ))}</ul>
        </Card>}
        {has('tournaments') && <Card title="Tournaments" pad={false}>
          <ul className="divide-y divide-navy-100">{data.recent.tournaments.length ? data.recent.tournaments.map((t: any) => (
            <li key={t.id}><Link to={`/app/tournaments/${t.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-paper"><div><p className="font-semibold">{t.name}</p><p className="text-sm text-navy-600">{date(t.start_date)} · {t.entries}/{t.max_participants} entries</p></div><Status value={t.status} /></Link></li>
          )) : <li className="px-5 py-6 text-navy-600">No upcoming tournaments.</li>}</ul>
        </Card>}
        <Card title="New players" pad={false}>
          <ul className="divide-y divide-navy-100">{data.recent.players.map((p: any) => (
            <li key={p.id}><Link to={`/app/players/${p.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-paper"><p className="font-semibold">{p.full_name}</p><span className="text-sm text-navy-600">{date(p.created_at)}</span></Link></li>
          ))}</ul>
        </Card>
      </div>
    </>
  );
}

function PlayerDashboard() {
  const { user } = useAuth();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['dash-player'], queryFn: () => api.get('/dashboard/player') });
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={refetch} />;
  const dbl = data.rankings.find((r: any) => r.format === 'DOUBLES'), sgl = data.rankings.find((r: any) => r.format === 'SINGLES');
  return (
    <>
      <PageHeader title={`Hi, ${user!.fullName.split(' ')[0]}`} actions={<Link to="/app/book"><Button><CalendarPlus className="h-4 w-4" />Book a court</Button></Link>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Your next bookings" className="lg:col-span-2" pad={false}>
          {data.upcoming.length ? <ul className="divide-y divide-navy-100">{data.upcoming.map((r: any) => (
            <li key={r.id}><Link to={`/app/reservations/${r.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-paper">
              <div className="w-20 shrink-0 text-center"><p className="font-display text-lg font-bold leading-tight">{weekday(r.startAt)}</p><p className="num text-sm text-navy-600">{time(r.startAt)}</p></div>
              <div className="flex-1"><p className="font-semibold">{r.courtName}</p><p className="text-sm text-navy-600">Ref {r.reference} · {peso(r.totalPriceCents)}</p></div>
              <div className="flex flex-col items-end gap-1"><Status value={r.status} />{r.paymentStatus === 'UNPAID' && <Badge color="gold">Pay at desk</Badge>}</div>
            </Link></li>))}</ul>
            : <div className="p-5"><Empty title="No upcoming bookings" action={<Link to="/app/book"><Button>Find a court</Button></Link>}>Pick a date and a free time to reserve a court.</Empty></div>}
        </Card>
        {has('memberships') && <Card title="Membership">
          {data.membership ? <>
            <p className="font-display text-3xl font-bold text-gold-500">{data.membership.plan.name}</p>
            <p className="mt-1 text-navy-700">Valid until {date(data.membership.endDate)}</p>
            <p className="mt-2 text-sm text-navy-600">{data.membership.plan.discountPercent}% off court bookings · book {data.membership.plan.advanceBookingDays} days ahead</p>
          </> : <><p className="text-navy-700">You’re not a member yet. Members save on every booking and can reserve further ahead.</p><Link to="/app/membership"><Button className="mt-3" variant="secondary">Compare plans</Button></Link></>}
        </Card>}
        {has('rankings') && <Card title="Your rating">
          <div className="grid grid-cols-2 gap-3">
            {[['Doubles', dbl], ['Singles', sgl]].map(([l, r]: any) => <div key={l}><p className="text-sm text-navy-600">{l}</p><p className="num font-display text-3xl font-bold">{r?.rating ?? '—'}</p><p className="num text-sm text-navy-600">{r ? `${r.wins}W ${r.losses}L` : 'No rated matches'}</p></div>)}
          </div>
          <Link to="/app/rankings" className="mt-3 inline-block text-sm font-semibold text-court-600">See leaderboard</Link>
        </Card>}
        {has('matches') && <Card title="Upcoming matches" pad={false}>
          {data.matches.length ? <ul className="divide-y divide-navy-100">{data.matches.map((m: any) => <li key={m.id}><Link to={`/app/matches/${m.id}`} className="flex justify-between px-5 py-3 hover:bg-paper"><span>{humanize(m.format)} · {humanize(m.category)}</span><span className="text-sm text-navy-600">{dateTime(m.startAt)}</span></Link></li>)}</ul> : <p className="p-5 text-navy-600">No matches scheduled.</p>}
        </Card>}
        {has('tournaments') && <Card title="Open tournaments" pad={false}>
          {data.tournaments.length ? <ul className="divide-y divide-navy-100">{data.tournaments.map((t: any) => <li key={t.id}><Link to={`/app/tournaments/${t.id}`} className="block px-5 py-3 hover:bg-paper"><p className="font-semibold">{t.name}</p><p className="text-sm text-navy-600">Register by {date(t.registrationDeadline)}</p></Link></li>)}</ul> : <p className="p-5 text-navy-600">No tournaments are open right now.</p>}
        </Card>}
        <Card title="Recent activity" className="lg:col-span-2" pad={false}>
          <ul className="divide-y divide-navy-100">{data.notifications.map((n: any) => <li key={n.id} className="px-5 py-3"><p className={n.readAt ? '' : 'font-semibold'}>{n.title}</p><p className="text-sm text-navy-600">{n.body}</p></li>)}</ul>
        </Card>
        <Card title="Courts">
          <ul className="space-y-2">{data.courts.map((c: any) => <li key={c.id} className="flex justify-between text-sm"><span>{c.name} <span className="text-navy-600">({c.indoor ? 'indoor' : 'outdoor'})</span></span><span className="num">{peso(c.hourlyPriceCents)}/hr</span></li>)}</ul>
        </Card>
      </div>
    </>
  );
}

function CoachDashboard() {
  const { data, isLoading, error } = useQuery({ queryKey: ['coach-sessions'], queryFn: () => api.get('/coaching/sessions?mine=1') });
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const upcoming = data.sessions.filter((s: any) => s.status === 'SCHEDULED' && new Date(s.endAt) > new Date());
  return (
    <>
      <PageHeader title="Your coaching" actions={<Link to="/app/coaching"><Button>Schedule a session</Button></Link>} />
      <Card title="Upcoming sessions" pad={false}>
        {upcoming.length ? <ul className="divide-y divide-navy-100">{upcoming.map((s: any) => <li key={s.id}><Link to={`/app/coaching/${s.id}`} className="flex justify-between px-5 py-3 hover:bg-paper"><span className="font-semibold">{s.title}</span><span className="text-sm text-navy-600">{dateTime(s.startAt)} · {s.enrolled}/{s.capacity} enrolled</span></Link></li>)}</ul> : <div className="p-5"><Empty title="Nothing scheduled">Create a lesson or clinic so players can enroll.</Empty></div>}
      </Card>
    </>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  if (can.staff(user)) return <AdminDashboard />;
  if (can.coach(user)) return <CoachDashboard />;
  return <PlayerDashboard />;
}
