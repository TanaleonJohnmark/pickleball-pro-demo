import { useState, type ReactNode } from 'react';
import { NavLink, Link, Outlet, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Bell, CalendarDays, LayoutDashboard, CalendarPlus, ListChecks, Users, Trophy, Medal, Swords, CreditCard, BarChart3, Megaphone, Settings, ShieldCheck, ScrollText, GraduationCap, Wallet, LandPlot, BadgeCheck, LogOut, Menu, X, UserRound } from 'lucide-react';
import { useAuth, can, type Me } from '../lib/auth';
import { cx, Loading } from './ui';
import { Logo, PoweredBy } from './Logo';
import { has } from '../lib/brand';
import { DemoBanner } from './Demo';
import { date } from '../lib/format';

type Item = { to: string; label: string; icon: any; show: (u: Me) => boolean };
const P = (_u: Me) => true;
const items: Item[] = [
  { to: '/app', label: 'Dashboard', icon: LayoutDashboard, show: P },
  { to: '/app/book', label: 'Book a court', icon: CalendarPlus, show: (u) => !can.coach(u) },
  { to: '/app/calendar', label: 'Court calendar', icon: CalendarDays, show: can.staff },
  { to: '/app/reservations', label: 'Reservations', icon: ListChecks, show: P },
  { to: '/app/payments/desk', label: 'Front desk', icon: Wallet, show: can.staff },
  { to: '/app/players', label: 'Players', icon: Users, show: (u) => can.staff(u) || can.coach(u) },
  { to: '/app/courts', label: 'Courts', icon: LandPlot, show: can.staff },
  { to: '/app/matches', label: 'Matches', icon: Swords, show: (u) => has('matches') && (P)(u) },
  { to: '/app/tournaments', label: 'Tournaments', icon: Trophy, show: (u) => has('tournaments') && (P)(u) },
  { to: '/app/rankings', label: 'Rankings', icon: Medal, show: (u) => has('rankings') && (P)(u) },
  { to: '/app/coaching', label: 'Coaching', icon: GraduationCap, show: (u) => has('coaching') && (P)(u) },
  { to: '/app/membership', label: 'Membership', icon: BadgeCheck, show: (u) => has('memberships') && ((u) => u.role === 'PLAYER')(u) },
  { to: '/app/memberships/manage', label: 'Memberships', icon: BadgeCheck, show: (u) => has('memberships') && (can.admin)(u) },
  { to: '/app/payments', label: 'Payments', icon: CreditCard, show: (u) => u.role === 'PLAYER' || can.admin(u) },
  { to: '/app/reports', label: 'Reports', icon: BarChart3, show: can.admin },
  { to: '/app/announcements', label: 'Announcements', icon: Megaphone, show: P },
  { to: '/app/admin/users', label: 'Staff accounts', icon: ShieldCheck, show: can.superAdmin },
  { to: '/app/admin/audit', label: 'Audit log', icon: ScrollText, show: can.superAdmin },
  { to: '/app/admin/settings', label: 'Settings', icon: Settings, show: can.admin },
];
const roleLabel: Record<string, string> = { SUPER_ADMIN: 'Super admin', CLUB_ADMIN: 'Club admin', STAFF: 'Staff', COACH: 'Coach', PLAYER: 'Player' };

function Nav({ user, onNavigate }: { user: Me; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5 px-3" aria-label="Main">
      {items.filter((i) => i.show(user)).map((i) => (
        <NavLink key={i.to} to={i.to} end={i.to === '/app' || i.to === '/app/payments'} onClick={onNavigate}
          className={({ isActive }) => cx('flex items-center gap-3 rounded-md px-3 py-2 text-[15px] font-medium', isActive ? 'bg-court-600 text-white' : 'text-navy-100/80 hover:bg-navy-800 hover:text-white')}>
          <i.icon className="h-[18px] w-[18px]" aria-hidden />{i.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppLayout() {
  const { user, loading, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation(); const nav = useNavigate();
  if (loading) return <Loading />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  const side = (
    <div className="flex h-full flex-col bg-navy-900 py-4">
      <Link to="/app" className="mb-5 px-6"><Logo light /></Link>
      <div className="flex-1 overflow-y-auto"><Nav user={user} onNavigate={() => setOpen(false)} /></div>
      <div className="mx-3 mt-3 border-t border-navy-700 px-3 pt-3 text-sm text-navy-300">
        <Link to="/app/profile" onClick={() => setOpen(false)} className="flex items-center gap-2 font-semibold text-white hover:underline"><UserRound className="h-4 w-4" />{user.fullName}</Link>
        <p className="mt-0.5">{roleLabel[user.role]}</p>
        <button onClick={async () => { await logout(); nav('/'); }} className="mt-2 flex items-center gap-2 text-navy-100/80 hover:text-white"><LogOut className="h-4 w-4" />Sign out</button>
        <div className="mt-3"><PoweredBy light /></div>
      </div>
    </div>
  );
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="no-print sticky top-0 hidden h-screen lg:block">{side}</aside>
      {open && <div className="fixed inset-0 z-40 lg:hidden"><div className="absolute inset-0 bg-navy-950/60" onClick={() => setOpen(false)} /><div className="absolute inset-y-0 left-0 w-72">{side}</div></div>}
      <div className="min-w-0">
        <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between border-b border-navy-100 bg-white/95 px-4 backdrop-blur sm:px-6">
          <button className="rounded p-2 lg:hidden" onClick={() => setOpen(!open)} aria-label="Open menu">{open ? <X /> : <Menu />}</button>
          <div className="lg:hidden"><Logo /></div>
          <div className="hidden text-sm text-navy-600 lg:block">{user.membership ? <>Member · <span className="font-semibold text-gold-500">{user.membership.plan.name}</span></> : roleLabel[user.role]}</div>
          <Link to="/app/notifications" className="relative rounded-full p-2 hover:bg-navy-100" aria-label={`Notifications, ${user.unread} unread`}>
            <Bell className="h-5 w-5 text-navy-800" />
            {user.unread > 0 && <span className="num absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-cyan-500 px-1 text-center text-[11px] font-bold leading-[18px] text-white">{user.unread > 99 ? '99+' : user.unread}</span>}
          </Link>
        </header>
        <DemoBanner />
        {user.trialEndsAt && <TrialBanner ends={user.trialEndsAt} />}
        <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8"><Outlet /></main>
      </div>
    </div>
  );
}

export function RequireRole({ allow, children }: { allow: (u: Me) => boolean; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || !allow(user)) return <div className="rounded-lg border border-navy-100 bg-white p-8 text-center"><h1 className="text-2xl font-bold">This page is for club staff</h1><p className="mt-1 text-navy-600">Your account doesn’t have access. <Link className="font-semibold text-court-600 underline" to="/app">Go to your dashboard</Link>.</p></div>;
  return <>{children}</>;
}

function TrialBanner({ ends }: { ends: string }) {
  const end = new Date(ends + 'T23:59:59+08:00');
  const days = Math.ceil((end.getTime() - Date.now()) / 86400000);
  const over = days < 0;
  return (
    <div className={cx('no-print px-4 py-2 text-center text-sm font-medium sm:px-6', over ? 'bg-red-700 text-white' : 'bg-gold-100 text-navy-900')}>
      {over ? <>Your free trial ended on {date(end)}. Contact <b>Pickleball Pro by JT</b> to keep using your system.</>
        : <>Free trial: <b>{days <= 1 ? 'last day' : `${days} days left`}</b> (until {date(end)}). Questions? Message <b>Pickleball Pro by JT</b>.</>}
    </div>
  );
}
