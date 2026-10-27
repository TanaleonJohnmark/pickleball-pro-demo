import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, can } from '../lib/auth';
import { peso, ymd as todayYmd, addDaysYmd, weekday, time, minutesLabel, dateTime, date } from '../lib/format';
import { Button, Card, Loading, ErrorBox, PageHeader, Field, Select, Input, cx, Empty, useToast } from '../components/ui';
import { PlayerPicker } from '../components/PlayerPicker';

export default function Book() {
  const { user, refresh } = useAuth(); const staff = can.staff(user); const toast = useToast(); const qc = useQueryClient();
  const [day, setDay] = useState(todayYmd());
  const [courtId, setCourtId] = useState<string>('');
  const [start, setStart] = useState<string>('');
  const [duration, setDuration] = useState(60);
  const [participants, setParticipants] = useState(4);
  const [guests, setGuests] = useState<{ name: string; email: string }[]>([]);
  const [forPlayer, setForPlayer] = useState<{ id: string; fullName: string } | null>(null);
  const [done, setDone] = useState<any>(null);

  const courts = useQuery({ queryKey: ['courts'], queryFn: () => api.get('/courts') });
  const court = courts.data?.courts.find((c: any) => c.id === courtId);
  const avail = useQuery({ queryKey: ['avail', courtId, day], queryFn: () => api.get(`/courts/${courtId}/availability?date=${day}`), enabled: !!courtId });
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDaysYmd(todayYmd(), i)), []);
  const body = { courtId, startAt: start, durationMinutes: duration, participants, guests: guests.filter((g) => g.name.trim()), ...(staff && forPlayer && { userId: forPlayer.id }) };
  const quote = useQuery({ queryKey: ['quote', body], queryFn: () => api.post('/reservations/quote', body), enabled: !!(courtId && start), retry: false });
  const book = useMutation({
    mutationFn: () => api.post('/reservations', body),
    onSuccess: (r) => { setDone(r.reservation); toast('Booking received'); qc.invalidateQueries(); refresh(); },
    onError: (e: Error) => { toast(e.message, 'err'); qc.invalidateQueries({ queryKey: ['avail'] }); },
  });

  // a slot can start a booking if enough consecutive free slots follow it
  const slots = avail.data?.slots ?? [];
  const step = avail.data?.slotMinutes ?? 30;
  const canStart = (i: number) => { const need = duration / step; for (let k = 0; k < need; k++) if (!slots[i + k]?.available) return false; return true; };
  const durations = court ? Array.from({ length: (court.maxDurationMinutes - court.minDurationMinutes) / court.slotMinutes + 1 }, (_, i) => court.minDurationMinutes + i * court.slotMinutes) : [60];

  if (done) return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CheckCircle2 className="h-10 w-10 text-court-600" />
        <h1 className="mt-3 text-3xl font-bold">Booking {done.status === 'CONFIRMED' ? 'confirmed' : 'received'}</h1>
        <p className="mt-1 text-navy-700">{court?.name}, {dateTime(done.startAt)} to {time(done.endAt)}</p>
        <p className="num mt-4 font-display text-4xl font-bold tracking-wide">{done.reference}</p>
        <p className="text-sm text-navy-600">Show this code at the front desk.</p>
        {done.paymentStatus === 'UNPAID' && <p className="mt-4 rounded-md bg-gold-100 px-3 py-2 text-[#6B4E06]">Pay {peso(done.totalPriceCents)} at the front desk to confirm your court.</p>}
        <div className="mt-6 flex gap-2"><Link to={`/app/reservations/${done.id}`}><Button>View booking</Button></Link><Button variant="secondary" onClick={() => { setDone(null); setStart(''); }}>Book another</Button></div>
      </Card>
    </div>
  );

  return (
    <>
      <PageHeader title="Book a court" sub={staff ? 'Book for a player or register a walk-in from the Players page first.' : 'Choose a day, a court and a start time.'} />
      {staff && <Card className="mb-4"><Field label="Booking for" hint="Leave empty to book under your own account."><PlayerPicker value={forPlayer} onChange={setForPlayer} /></Field></Card>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <Card title="1. Day">
            <div className="flex gap-2 overflow-x-auto pb-1" role="listbox" aria-label="Choose a day">
              {days.map((d) => <button key={d} role="option" aria-selected={day === d} onClick={() => { setDay(d); setStart(''); }} className={cx('min-w-[76px] shrink-0 rounded-md border px-3 py-2 text-center', day === d ? 'border-court-600 bg-court-600 text-white' : 'border-navy-100 bg-white hover:border-navy-300')}>
                <span className="block text-xs">{weekday(d + 'T04:00:00Z').split(' ')[0].replace(',', '')}</span><span className="num block font-display text-xl font-bold">{d.slice(8)}</span>
              </button>)}
            </div>
          </Card>
          <Card title="2. Court">
            {courts.isLoading ? <Loading /> : courts.error ? <ErrorBox error={courts.error} /> : courts.data.courts.length === 0 ? <Empty title="No courts are open for booking" /> : (
              <div className="grid gap-2 sm:grid-cols-2">{courts.data.courts.map((c: any) => (
                <button key={c.id} onClick={() => { setCourtId(c.id); setStart(''); setDuration(c.minDurationMinutes); setParticipants(Math.min(participants, c.capacity)); }} className={cx('rounded-md border p-3 text-left', courtId === c.id ? 'border-court-600 ring-2 ring-court-100' : 'border-navy-100 hover:border-navy-300')}>
                  <span className="block font-semibold">{c.name}</span>
                  <span className="text-sm text-navy-600">{c.indoor ? 'Indoor' : 'Outdoor'} · {c.surface} · <span className="num">{peso(c.hourlyPriceCents)}</span>/hr</span>
                </button>))}
              </div>)}
          </Card>
          {courtId && <Card title="3. Time">
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <Field label="Duration"><Select value={duration} onChange={(e) => { setDuration(+e.target.value); setStart(''); }}>{durations.map((d) => <option key={d} value={d}>{minutesLabel(d)}</option>)}</Select></Field>
              <Field label="Players"><Select value={participants} onChange={(e) => setParticipants(+e.target.value)}>{Array.from({ length: court?.capacity ?? 4 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
            </div>
            {avail.isLoading ? <Loading /> : avail.error ? <ErrorBox error={avail.error} /> : !avail.data.open ? <Empty title="Closed that day">Try another day or court.</Empty> : (
              <>
                <p className="mb-2 text-sm text-navy-600">Open {avail.data.openTime}–{avail.data.closeTime}. Greyed times are taken or too short for {minutesLabel(duration)}.</p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">{slots.map((s: any, i: number) => {
                  const ok = canStart(i);
                  return <button key={s.start} disabled={!ok} onClick={() => setStart(s.start)} className={cx('num rounded-md border px-2 py-2 text-sm font-semibold', start === s.start ? 'border-court-600 bg-court-600 text-white' : ok ? 'border-navy-100 bg-white hover:border-court-500' : 'cursor-not-allowed border-transparent bg-paper text-navy-300 line-through')}>{time(s.start)}</button>;
                })}</div>
              </>)}
          </Card>}
          {courtId && participants > 1 && <Card title="Guests (optional)">
            <div className="space-y-2">{guests.map((g, i) => (
              <div key={i} className="flex gap-2"><Input placeholder="Name" value={g.name} onChange={(e) => setGuests(guests.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} /><Input placeholder="Email (optional)" value={g.email} onChange={(e) => setGuests(guests.map((x, j) => j === i ? { ...x, email: e.target.value } : x))} /><Button variant="ghost" aria-label="Remove guest" onClick={() => setGuests(guests.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button></div>
            ))}</div>
            {guests.length < participants - 1 && <Button variant="secondary" size="sm" className="mt-2" onClick={() => setGuests([...guests, { name: '', email: '' }])}><Plus className="h-4 w-4" />Add guest</Button>}
          </Card>}
        </div>
        <div className="lg:sticky lg:top-20 lg:self-start">
          <Card title="Summary">
            {!courtId || !start ? <p className="text-navy-600">Pick a court and a start time to see the price.</p> : quote.isLoading ? <Loading label="Checking" /> : quote.error ? <ErrorBox error={quote.error} /> : (
              <dl className="space-y-2 text-[15px]">
                <div className="flex justify-between"><dt className="text-navy-600">Court</dt><dd className="font-semibold">{quote.data.courtName}</dd></div>
                <div className="flex justify-between"><dt className="text-navy-600">When</dt><dd className="text-right">{date(quote.data.startAt)}<br />{time(quote.data.startAt)}–{time(quote.data.endAt)}</dd></div>
                <div className="flex justify-between"><dt className="text-navy-600">Court fee</dt><dd className="num">{peso(quote.data.basePriceCents)}</dd></div>
                {quote.data.discountCents > 0 && <div className="flex justify-between text-court-700"><dt>{quote.data.discountReason}</dt><dd className="num">−{peso(quote.data.discountCents)}</dd></div>}
                <div className="flex justify-between border-t border-navy-100 pt-2 text-lg font-bold"><dt>Total</dt><dd className="num">{peso(quote.data.totalPriceCents)}</dd></div>
              </dl>
            )}
            <Button className="mt-4 w-full" disabled={!quote.data || !!quote.error} loading={book.isPending} onClick={() => book.mutate()}>Confirm booking</Button>
            <p className="mt-2 text-xs text-navy-600">Pay at the front desk. You can cancel online until the club’s cutoff before your start time.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
