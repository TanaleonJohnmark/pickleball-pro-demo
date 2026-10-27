import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api, qs } from '../lib/api';
import { ymd, addDaysYmd, localIso, time, weekday, date } from '../lib/format';
import { PageHeader, Tabs, Button, Loading, ErrorBox, Card, cx } from '../components/ui';

const START_H = 6, END_H = 22, PX = 48; // px per hour
const kindStyle: Record<string, string> = {
  reservation: 'border-court-600 bg-court-50 text-court-700', match: 'border-cyan-500 bg-cyan-100 text-[#0B6F80]',
  coaching: 'border-gold-500 bg-gold-100 text-[#6B4E06]', maintenance: 'border-navy-300 bg-[repeating-linear-gradient(45deg,#E3EAF3,#E3EAF3_6px,#fff_6px,#fff_12px)] text-navy-700',
};
const link = (e: any) => e.kind === 'reservation' ? `/app/reservations/${e.id}` : e.kind === 'match' ? `/app/matches/${e.id}` : e.kind === 'coaching' ? `/app/coaching/${e.id}` : '/app/courts';
const localMinutes = (iso: string) => { const d = new Date(new Date(iso).getTime() + 8 * 3600000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };

export default function Calendar() {
  const [view, setView] = useState<'day' | 'week' | 'month'>('day');
  const [anchor, setAnchor] = useState(ymd());
  const range = useMemo(() => {
    if (view === 'day') return { from: anchor, to: addDaysYmd(anchor, 1) };
    if (view === 'week') { const dow = new Date(anchor + 'T12:00:00Z').getUTCDay(); const s = addDaysYmd(anchor, -((dow + 6) % 7)); return { from: s, to: addDaysYmd(s, 7) }; }
    const s = anchor.slice(0, 8) + '01'; const next = new Date(s + 'T12:00:00Z'); next.setUTCMonth(next.getUTCMonth() + 1); return { from: s, to: next.toISOString().slice(0, 10) };
  }, [view, anchor]);
  const courts = useQuery({ queryKey: ['courts', 'all'], queryFn: () => api.get('/courts?all=1') });
  const ev = useQuery({ queryKey: ['calendar', range], queryFn: () => api.get(`/reservations/calendar${qs({ from: localIso(range.from, '00:00'), to: localIso(range.to, '00:00') })}`) });
  const shift = (n: number) => { if (view === 'month') { const d = new Date(anchor + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); setAnchor(d.toISOString().slice(0, 10)); } else setAnchor(addDaysYmd(anchor, n * (view === 'day' ? 1 : 7))); };
  const title = view === 'day' ? weekday(anchor + 'T04:00:00Z') : view === 'week' ? `${date(range.from + 'T04:00:00Z')} – ${date(addDaysYmd(range.to, -1) + 'T04:00:00Z')}` : new Date(anchor + 'T12:00:00Z').toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
  const events = (ev.data?.events ?? []).filter((e: any) => !(e.kind === 'reservation' && e.status === 'CANCELLED'));
  const list = courts.data?.courts ?? [];
  return (
    <>
      <PageHeader title="Court calendar" sub={title} actions={<Link to="/app/book"><Button>New booking</Button></Link>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs value={view} onChange={setView} items={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
        <Button variant="secondary" size="sm" onClick={() => shift(-1)} aria-label="Previous"><ChevronLeft className="h-4 w-4" /></Button>
        <Button variant="secondary" size="sm" onClick={() => setAnchor(ymd())}>Today</Button>
        <Button variant="secondary" size="sm" onClick={() => shift(1)} aria-label="Next"><ChevronRight className="h-4 w-4" /></Button>
        <div className="ml-auto flex flex-wrap gap-3 text-xs">{Object.entries({ reservation: 'Booking', match: 'Match', coaching: 'Coaching', maintenance: 'Maintenance' }).map(([k, l]) => <span key={k} className="flex items-center gap-1.5"><span className={cx('h-3 w-3 rounded-sm border', kindStyle[k])} />{l}</span>)}</div>
      </div>
      {ev.isLoading || courts.isLoading ? <Loading /> : ev.error ? <ErrorBox error={ev.error} retry={ev.refetch} /> : view === 'day' ? (
        <Card pad={false}>
          <div className="overflow-x-auto">
            <div className="grid min-w-[720px]" style={{ gridTemplateColumns: `56px repeat(${list.length}, minmax(140px, 1fr))` }}>
              <div className="border-b border-navy-100" />
              {list.map((c: any) => <div key={c.id} className="border-b border-l border-navy-100 px-2 py-2 text-sm font-semibold">{c.name}{c.status !== 'ACTIVE' && <span className="ml-1 font-normal text-navy-600">(inactive)</span>}</div>)}
              <div className="relative" style={{ height: (END_H - START_H) * PX }}>
                {Array.from({ length: END_H - START_H }, (_, i) => <div key={i} className="num absolute right-2 text-xs text-navy-600" style={{ top: i * PX - 7 }}>{String(START_H + i).padStart(2, '0')}:00</div>)}
              </div>
              {list.map((c: any) => (
                <div key={c.id} className="relative border-l border-navy-100" style={{ height: (END_H - START_H) * PX, backgroundImage: `repeating-linear-gradient(#fff, #fff ${PX - 1}px, #E3EAF3 ${PX - 1}px, #E3EAF3 ${PX}px)` }}>
                  {events.filter((e: any) => e.courtId === c.id).map((e: any) => {
                    const top = Math.max(0, (localMinutes(e.startAt) - START_H * 60) / 60 * PX); const h = Math.max(18, (new Date(e.endAt).getTime() - new Date(e.startAt).getTime()) / 3600000 * PX - 2);
                    return <Link key={e.kind + e.id} to={link(e)} className={cx('absolute inset-x-1 overflow-hidden rounded border-l-4 px-1.5 py-0.5 text-xs leading-tight', kindStyle[e.kind])} style={{ top, height: h }}>
                      <span className="block font-semibold">{time(e.startAt)}–{time(e.endAt)}</span><span className="block truncate">{e.title}</span>{e.paymentStatus === 'UNPAID' && <span className="font-semibold">Unpaid</span>}
                    </Link>;
                  })}
                </div>))}
            </div>
          </div>
        </Card>
      ) : view === 'week' ? (
        <div className="grid gap-3 md:grid-cols-7">{Array.from({ length: 7 }, (_, i) => addDaysYmd(range.from, i)).map((d) => {
          const dayEv = events.filter((e: any) => ymd(new Date(e.startAt)) === d).sort((a: any, b: any) => a.startAt.localeCompare(b.startAt));
          return <div key={d} className="rounded-lg border border-navy-100 bg-white">
            <button onClick={() => { setAnchor(d); setView('day'); }} className={cx('w-full border-b border-navy-100 px-3 py-2 text-left font-display text-lg font-semibold hover:bg-paper', d === ymd() && 'text-court-600')}>{weekday(d + 'T04:00:00Z')}</button>
            <ul className="max-h-[480px] space-y-1 overflow-y-auto p-2">{dayEv.length ? dayEv.map((e: any) => <li key={e.kind + e.id}><Link to={link(e)} className={cx('block rounded border-l-4 px-2 py-1 text-xs', kindStyle[e.kind])}><span className="font-semibold">{time(e.startAt)}</span> {list.find((c: any) => c.id === e.courtId)?.name}<span className="block truncate">{e.title}</span></Link></li>) : <li className="px-1 py-2 text-xs text-navy-600">Nothing booked</li>}</ul>
          </div>;
        })}</div>
      ) : (
        <Card pad={false}>
          <div className="grid grid-cols-7 border-b border-navy-100 text-center text-xs font-semibold text-navy-600">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="py-2">{d}</div>)}</div>
          <div className="grid grid-cols-7">
            {Array.from({ length: (new Date(range.from + 'T12:00:00Z').getUTCDay() + 6) % 7 }, (_, i) => <div key={'x' + i} className="min-h-[88px] border-b border-r border-navy-100 bg-paper" />)}
            {Array.from({ length: (new Date(range.to + 'T12:00:00Z').getTime() - new Date(range.from + 'T12:00:00Z').getTime()) / 86400000 }, (_, i) => addDaysYmd(range.from, i)).map((d) => {
              const n = events.filter((e: any) => e.kind === 'reservation' && ymd(new Date(e.startAt)) === d).length;
              const m = events.filter((e: any) => e.kind !== 'reservation' && ymd(new Date(e.startAt)) === d).length;
              return <button key={d} onClick={() => { setAnchor(d); setView('day'); }} className="min-h-[88px] border-b border-r border-navy-100 p-2 text-left hover:bg-paper">
                <span className={cx('num font-display text-lg font-bold', d === ymd() && 'text-court-600')}>{+d.slice(8)}</span>
                {n > 0 && <span className="num mt-1 block text-xs font-semibold text-court-700">{n} booking{n > 1 ? 's' : ''}</span>}
                {m > 0 && <span className="num block text-xs text-navy-600">{m} other</span>}
              </button>;
            })}
          </div>
        </Card>
      )}
    </>
  );
}
