import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { useAuth, can } from '../lib/auth';
import { peso, dateTime, time, date, humanize, ymd, localHHMM, localIso, minutesLabel } from '../lib/format';
import { PageHeader, Card, Table, Td, Status, Loading, ErrorBox, Empty, Pagination, Tabs, Input, Select, Button, Confirm, Field, Modal, useToast, Badge } from '../components/ui';
import { RecordPayment } from '../components/RecordPayment';

export function ReservationList() {
  const { user } = useAuth(); const staff = can.staff(user);
  const [sp, setSp] = useSearchParams();
  const scope = (sp.get('scope') as any) || 'upcoming';
  const [q, setQ] = useState(''); const [page, setPage] = useState(1);
  const status = sp.get('status') || '';
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['reservations', scope, status, q, page], queryFn: () => api.get(`/reservations${qs({ scope, status, q, page, pageSize: 20 })}`) });
  return (
    <>
      <PageHeader title={staff ? 'Reservations' : 'My bookings'} actions={<Link to="/app/book"><Button>New booking</Button></Link>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={scope} onChange={(v) => { setSp({ scope: v, ...(status && { status }) }); setPage(1); }} items={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past' }, { value: 'all', label: 'All' }]} />
        <Select className="w-44" value={status} onChange={(e) => { setSp({ scope, ...(e.target.value && { status: e.target.value }) }); setPage(1); }} aria-label="Status filter">
          <option value="">Any status</option>{['PENDING', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'PENDING,CONFIRMED'].map((s) => <option key={s} value={s}>{s.split(',').map(humanize).join(' or ')}</option>)}
        </Select>
        {staff && <Input className="max-w-xs" placeholder="Search name or reference" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />}
      </div>
      <Card pad={false}>
        {isLoading ? <Loading /> : error ? <div className="p-4"><ErrorBox error={error} retry={refetch} /></div> : !data.items.length ? <div className="p-5"><Empty title="No bookings here" action={<Link to="/app/book"><Button>Book a court</Button></Link>} /></div> : (
          <>
            <Table head={['Reference', ...(staff ? ['Player'] : []), 'Court', 'When', 'Total', 'Status', 'Payment']}>
              {data.items.map((r: any) => (
                <tr key={r.id} className="hover:bg-paper">
                  <Td><Link className="font-semibold text-court-700 hover:underline" to={`/app/reservations/${r.id}`}>{r.reference}</Link></Td>
                  {staff && <Td>{r.playerName}</Td>}
                  <Td>{r.courtName}</Td><Td>{dateTime(r.startAt)}–{time(r.endAt)}</Td><Td className="num">{peso(r.totalPriceCents)}</Td>
                  <Td><Status value={r.status} /></Td><Td><Status value={r.paymentStatus} /></Td>
                </tr>))}
            </Table>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>)}
      </Card>
    </>
  );
}

export function ReservationDetail() {
  const { id } = useParams(); const { user } = useAuth(); const staff = can.staff(user); const toast = useToast(); const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['reservation', id], queryFn: () => api.get(`/reservations/${id}`) });
  const [cancelOpen, setCancelOpen] = useState(false); const [payOpen, setPayOpen] = useState(false); const [moveOpen, setMoveOpen] = useState(false);
  const act = useMutation({ mutationFn: (status: string) => api.post(`/reservations/${id}/status`, { status }), onSuccess: () => { toast('Booking updated'); qc.invalidateQueries(); }, onError: (e: Error) => toast(e.message, 'err') });
  const cancel = useMutation({ mutationFn: () => api.post(`/reservations/${id}/cancel`, {}), onSuccess: () => { toast('Booking cancelled'); setCancelOpen(false); qc.invalidateQueries(); }, onError: (e: Error) => toast(e.message, 'err') });
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={refetch} />;
  const r = data.reservation;
  const mins = (new Date(r.endAt).getTime() - new Date(r.startAt).getTime()) / 60000;
  return (
    <>
      <PageHeader title={`Booking ${r.reference}`} sub={<span className="flex flex-wrap gap-2"><Status value={r.status} /><Status value={r.paymentStatus} /></span>} actions={<>
        {staff && r.paymentStatus === 'UNPAID' && !['CANCELLED', 'NO_SHOW'].includes(r.status) && <Button onClick={() => setPayOpen(true)}>Record payment</Button>}
        {staff && r.status === 'PENDING' && <Button variant="secondary" onClick={() => act.mutate('CONFIRMED')}>Confirm</Button>}
        {staff && r.status === 'CONFIRMED' && <Button onClick={() => act.mutate('CHECKED_IN')} disabled={r.paymentStatus !== 'PAID'} title={r.paymentStatus !== 'PAID' ? 'Record payment first' : ''}>Check in</Button>}
        {staff && r.status === 'CONFIRMED' && new Date(r.startAt) < new Date() && <Button variant="secondary" onClick={() => act.mutate('NO_SHOW')}>Mark no-show</Button>}
        {staff && r.status === 'CHECKED_IN' && <Button variant="secondary" onClick={() => act.mutate('COMPLETED')}>Mark completed</Button>}
        {data.cancellable && <Button variant="secondary" onClick={() => setMoveOpen(true)}>Change time</Button>}
        {data.cancellable && <Button variant="danger" onClick={() => setCancelOpen(true)}>Cancel booking</Button>}
      </>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Details">
          <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-[15px]">
            <dt className="text-navy-600">Court</dt><dd className="font-semibold">{r.court.name}</dd>
            <dt className="text-navy-600">Date</dt><dd>{date(r.startAt)}</dd>
            <dt className="text-navy-600">Time</dt><dd>{time(r.startAt)}–{time(r.endAt)} ({minutesLabel(mins)})</dd>
            <dt className="text-navy-600">Players</dt><dd>{r.participants}</dd>
            <dt className="text-navy-600">Booked by</dt><dd>{r.user.fullName}{staff && <span className="text-navy-600"> · {r.user.email}{r.user.phone ? ` · ${r.user.phone}` : ''}</span>}</dd>
            {r.guests.length > 0 && <><dt className="text-navy-600">Guests</dt><dd>{r.guests.map((g: any) => g.name).join(', ')}</dd></>}
            <dt className="text-navy-600">Created</dt><dd>{dateTime(r.createdAt)}</dd>
            {r.checkedInAt && <><dt className="text-navy-600">Checked in</dt><dd>{dateTime(r.checkedInAt)}</dd></>}
            {r.cancelledAt && <><dt className="text-navy-600">Cancelled</dt><dd>{dateTime(r.cancelledAt)} — {r.cancelReason}</dd></>}
          </dl>
        </Card>
        <Card title="Price and payment">
          <dl className="space-y-2 text-[15px]">
            <div className="flex justify-between"><dt className="text-navy-600">Court fee</dt><dd className="num">{peso(r.basePriceCents)}</dd></div>
            {r.discountCents > 0 && <div className="flex justify-between text-court-700"><dt>Member discount</dt><dd className="num">−{peso(r.discountCents)}</dd></div>}
            <div className="flex justify-between border-t border-navy-100 pt-2 text-lg font-bold"><dt>Total</dt><dd className="num">{peso(r.totalPriceCents)}</dd></div>
          </dl>
          {r.payments.length > 0 && <ul className="mt-4 space-y-1 text-sm">{r.payments.map((p: any) => <li key={p.id}><Link className="font-semibold text-court-700 underline" to={`/app/payments/${p.id}`}>Receipt {p.reference}</Link> · {humanize(p.method)} · {dateTime(p.paidAt)} {p.status === 'REFUNDED' && <Badge color="gray">Refunded</Badge>}</li>)}</ul>}
          {!data.cancellable && ['PENDING', 'CONFIRMED'].includes(r.status) && !staff && <p className="mt-4 text-sm text-navy-600">Online changes close {data.cancellationHours} hours before start. Contact the front desk for help.</p>}
        </Card>
      </div>
      <Confirm open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel this booking?" confirmLabel="Cancel booking" danger loading={cancel.isPending} onConfirm={() => cancel.mutate()}>
        The court time is released straight away.{r.paymentStatus === 'PAID' ? ' The front desk will process your refund under the club policy.' : ''}
      </Confirm>
      {payOpen && <RecordPayment open onClose={() => setPayOpen(false)} purpose="RESERVATION" targetId={r.id} amountCents={r.totalPriceCents} label={`${r.court.name} · ${r.reference} · ${r.user.fullName}`} />}
      {moveOpen && <MoveBooking r={r} onClose={() => setMoveOpen(false)} />}
    </>
  );
}

function MoveBooking({ r, onClose }: { r: any; onClose: () => void }) {
  const [day, setDay] = useState(ymd(new Date(r.startAt))); const [hhmm, setHhmm] = useState(localHHMM(r.startAt));
  const mins = (new Date(r.endAt).getTime() - new Date(r.startAt).getTime()) / 60000;
  const [dur, setDur] = useState(mins); const toast = useToast(); const qc = useQueryClient();
  const m = useMutation({ mutationFn: () => api.post(`/reservations/${r.id}/reschedule`, { startAt: localIso(day, hhmm), durationMinutes: dur }), onSuccess: () => { toast('Booking moved'); qc.invalidateQueries(); onClose(); } });
  return (
    <Modal open onClose={onClose} title="Change time">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Date"><Input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
        <Field label="Start"><Input type="time" step={1800} value={hhmm} onChange={(e) => setHhmm(e.target.value)} /></Field>
        <Field label="Duration (min)"><Input type="number" step={30} min={30} value={dur} onChange={(e) => setDur(+e.target.value)} /></Field>
      </div>
      {r.paymentStatus === 'PAID' && <p className="mt-3 text-sm text-navy-600">This booking is paid, so the new time must cost the same.</p>}
      {m.error && <div className="mt-3"><ErrorBox error={m.error} /></div>}
      <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Close</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Move booking</Button></div>
    </Modal>
  );
}
