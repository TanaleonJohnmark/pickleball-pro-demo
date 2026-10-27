import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Phone, Mail, CalendarPlus, Trophy, Medal, Wallet, GraduationCap, Bell } from 'lucide-react';
import { api } from '../lib/api';
import { peso, date, humanize } from '../lib/format';
import { useAuth } from '../lib/auth';
import { Logo, PoweredBy } from '../components/Logo';
import brand, { C, has } from '../lib/brand';
import { DemoBanner, DemoButtons, useDemo } from '../components/Demo';
import { Button, Loading, ErrorBox, Badge } from '../components/ui';

/** Top-down court: the kitchen lines are drawn, availability fills the playing area. */
function CourtTile({ c }: { c: any }) {
  const pct = c.totalSlots ? c.freeSlots / c.totalSlots : 0;
  return (
    <Link to="/app/book" className="group block focus-visible:ring-offset-navy-900" aria-label={`${c.name}: ${c.freeSlots} free slots today`}>
      <svg viewBox="0 0 120 260" className="w-full" role="img" aria-hidden>
        <rect x="2" y="2" width="116" height="256" rx="3" fill={c.indoor ? C.court['700'] : C.court['600']} />
        <rect x="2" y={2 + 256 * (1 - pct)} width="116" height={256 * pct} fill={C.cyan['400']} opacity=".3" />
        <g fill="none" stroke="#fff" strokeWidth="2">
          <rect x="10" y="10" width="100" height="240" />
          <line x1="10" y1="130" x2="110" y2="130" strokeWidth="3" />
          <line x1="10" y1="95" x2="110" y2="95" /><line x1="10" y1="165" x2="110" y2="165" />
          <line x1="60" y1="10" x2="60" y2="95" /><line x1="60" y1="165" x2="60" y2="250" />
        </g>
      </svg>
      <p className="mt-2 font-display text-lg font-semibold text-white group-hover:text-cyan-400">{c.name}</p>
      <p className="num text-sm text-navy-300">{c.open ? `${c.freeSlots} of ${c.totalSlots} slots free today` : 'Closed today'}</p>
    </Link>
  );
}

export default function Landing() {
  const { user } = useAuth();
  const demo = useDemo().data?.demo;
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['public'], queryFn: () => api.get('/public/overview') });
  return (
    <div className="bg-white">
      <DemoBanner />
      <header className="bg-navy-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Logo light />
          <nav className="flex items-center gap-2">
            {user ? <Link to="/app"><Button>Open dashboard</Button></Link> : <><Link to="/login" className="px-3 py-2 font-semibold text-white hover:text-cyan-400">Sign in</Link><Link to="/register"><Button>Create account</Button></Link></>}
          </nav>
        </div>
        <section className="mx-auto grid max-w-6xl gap-10 px-5 pb-16 pt-8 lg:grid-cols-[1fr_1.2fr] lg:items-center">
          <div>
            <img src={brand.logo} alt="" className="mb-5 h-24 w-24" />
            <h1 className="font-display text-5xl font-extrabold leading-[0.95] text-white sm:text-6xl">{data?.club.name ?? brand.clubName}</h1>
            <p className="mt-4 max-w-md text-lg text-navy-100/90">{demo ? 'This is a live demo. Book a court as a player, then switch to the owner view and see it arrive at the front desk.' : 'Book a court in under a minute. See open times, pick your slot, done.'}</p>
            {demo && !user ? <div className="mt-6"><DemoButtons dark /></div> : <div className="mt-6 flex flex-wrap gap-3">
              <Link to={user ? '/app/book' : '/register'}><Button className="h-12 px-6 text-base"><CalendarPlus className="h-5 w-5" />Book a court</Button></Link>
              {data?.plans?.length > 0 && <a href="#plans"><Button variant="secondary" className="h-12 px-6 text-base">See memberships</Button></a>}
            </div>}
          </div>
          <div aria-label="Today's court availability">
            <p className="mb-3 text-sm text-navy-300">Today{data ? `, ${date(data.date + 'T12:00:00Z')}` : ''}. The brighter the court, the more time is free.</p>
            {isLoading ? <Loading /> : error ? <ErrorBox error={error} retry={refetch} /> : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">{data.courts.map((c: any) => <CourtTile key={c.id} c={c} />)}</div>
            )}
          </div>
        </section>
      </header>

      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-3xl font-bold text-navy-900">Everything the club runs on</h2>
        <div className="mt-8 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {[
            [CalendarPlus, 'Court booking', 'Live availability per court, pricing per hour and instant confirmation codes.'],
            [Trophy, 'Tournaments', 'Single elimination, round robin, and group stage into knockout, with brackets that update themselves.'],
            [Medal, 'Rankings', 'An Elo rating updated only from officiated results, filterable by singles, doubles and level.'],
            [GraduationCap, 'Coaching', 'Private lessons and clinics with attendance and progress notes.'],
            [Wallet, 'Payments', has('memberships') ? 'Receipts for every booking, membership and entry fee, recorded at the front desk.' : 'See who still needs to pay, record it in one click, and print receipts.'],
            [Bell, 'Notifications', 'Booking confirmations, reminders, match results and club news in your inbox.'],
          ].filter(([, t]: any) => !(t === 'Tournaments' && !has('tournaments')) && !(t === 'Rankings' && !has('rankings')) && !(t === 'Coaching' && !has('coaching'))).map(([Icon, t, d]: any) => (
            <div key={t} className="flex gap-4"><Icon className="mt-1 h-6 w-6 shrink-0 text-court-600" /><div><h3 className="text-xl font-semibold">{t}</h3><p className="mt-1 text-navy-700">{d}</p></div></div>
          ))}
        </div>
      </section>

      {has('memberships') && data?.plans?.length > 0 && <section id="plans" className="border-y border-navy-100 bg-paper">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-3xl font-bold text-navy-900">Memberships</h2>
          <p className="mt-1 text-navy-600">Pay at the front desk; your plan starts the moment payment is recorded.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {data?.plans.map((p: any) => (
              <div key={p.id} className={`rounded-lg border bg-white p-5 ${p.name === 'Premium' ? 'border-gold-400' : 'border-navy-100'}`}>
                <div className="flex items-center justify-between"><h3 className="text-2xl font-bold">{p.name}</h3>{p.discountPercent > 0 && <Badge color={p.name === 'Premium' ? 'gold' : 'green'}>{p.discountPercent}% off courts</Badge>}</div>
                <p className="num mt-2 font-display text-3xl font-bold">{peso(p.priceCents)}<span className="ml-1 font-sans text-sm font-normal text-navy-600">/ {p.durationDays} days</span></p>
                <ul className="mt-3 space-y-1 text-sm text-navy-700">{p.benefits.map((b: string) => <li key={b}>• {b}</li>)}</ul>
              </div>
            ))}
          </div>
        </div>
      </section>}

      <section className="mx-auto grid max-w-6xl gap-10 px-5 py-16 lg:grid-cols-2">
        {has('tournaments') ? <div>
          <h2 className="text-3xl font-bold text-navy-900">Upcoming tournaments</h2>
          <div className="mt-6 divide-y divide-navy-100 border-y border-navy-100">
            {data?.tournaments.length ? data.tournaments.map((t: any) => (
              <Link key={t.id} to={`/app/tournaments/${t.id}`} className="flex items-center justify-between gap-4 py-4 hover:bg-paper">
                <div><p className="text-lg font-semibold">{t.name}</p><p className="text-sm text-navy-600">{date(t.startDate)} · {humanize(t.category)} · {humanize(t.format)}</p></div>
                <span className="num text-sm text-navy-700">{t.entries}/{t.maxParticipants} entries</span>
              </Link>
            )) : <p className="py-6 text-navy-600">No tournaments are open right now.</p>}
          </div>
        </div> : <div>
          <h2 className="text-3xl font-bold text-navy-900">What players get</h2>
          <ul className="mt-6 space-y-3 text-lg text-navy-800">
            <li>✅ See every open time, live</li><li>✅ Book from any phone in under a minute</li><li>✅ A booking code to show at the desk</li><li>✅ Reminders before their game</li><li>✅ Cancel or move online, within your rules</li>
          </ul>
        </div>}
        <div>
          <h2 className="text-3xl font-bold text-navy-900">Visit us</h2>
          <ul className="mt-6 space-y-3 text-navy-800">
            <li className="flex gap-3"><MapPin className="h-5 w-5 text-court-600" />{data?.club.address}</li>
            <li className="flex gap-3"><Phone className="h-5 w-5 text-court-600" />{data?.club.phone}</li>
            <li className="flex gap-3"><Mail className="h-5 w-5 text-court-600" />{data?.club.email}</li>
          </ul>
          {data?.announcements?.[0] && <div className="mt-8 border-l-4 border-cyan-500 pl-4"><p className="font-semibold">{data.announcements[0].title}</p><p className="text-navy-700">{data.announcements[0].body}</p></div>}
        </div>
      </section>
      <footer className="bg-navy-900 py-6 text-center text-sm text-navy-300">© {new Date().getFullYear()} {data?.club.name ?? brand.clubName}<div className="mt-1"><PoweredBy light /></div></footer>
    </div>
  );
}
