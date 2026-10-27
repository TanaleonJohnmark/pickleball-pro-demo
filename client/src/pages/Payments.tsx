import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAuth, can } from '../lib/auth';
import { peso, dateTime, date, humanize, ymd, addDaysYmd, localIso } from '../lib/format';
import { PageHeader, Card, Button, Loading, ErrorBox, Status, Modal, Field, Input, Select, useToast, Table, Td, Empty, Pagination, Badge, StatCard } from '../components/ui';
import { RecordPayment } from '../components/RecordPayment';
import { PlayerPicker } from '../components/PlayerPicker';

export function PaymentList() {
  const { user } = useAuth(); const staff = can.staff(user);
  const [from, setFrom] = useState(staff ? addDaysYmd(ymd(), -30) : ''); const [to, setTo] = useState(''); const [purpose, setPurpose] = useState(''); const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['payments', from, to, purpose, page], queryFn: () => api.get(`/payments${qs({ from: from && localIso(from, '00:00'), to: to && localIso(addDaysYmd(to, 1), '00:00'), purpose, page })}`) });
  return (
    <>
      <PageHeader title={staff ? 'Payments' : 'Payment history'} actions={staff && <Link to="/app/payments/desk"><Button>Front desk</Button></Link>} />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Field label="From"><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></Field>
        <Field label="For"><Select value={purpose} onChange={(e) => { setPurpose(e.target.value); setPage(1); }}><option value="">Everything</option>{['RESERVATION', 'MEMBERSHIP', 'TOURNAMENT', 'COACHING', 'OTHER'].map((p) => <option key={p} value={p}>{humanize(p)}</option>)}</Select></Field>
      </div>
      {data && <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md"><StatCard label="Payments" value={data.total} /><StatCard label="Total received" value={peso(data.sumCents)} accent="green" /></div>}
      <Card pad={false}>
        {isLoading ? <Loading /> : error ? <div className="p-4"><ErrorBox error={error} retry={refetch} /></div> : !data.items.length ? <div className="p-5"><Empty title="No payments in this range" /></div> : <>
          <Table head={['Receipt', ...(staff ? ['Player'] : []), 'For', 'Method', 'Amount', 'Date', 'Status']}>
            {data.items.map((p: any) => <tr key={p.id} className="hover:bg-paper"><Td><Link className="font-semibold text-court-700 hover:underline" to={`/app/payments/${p.id}`}>{p.reference}</Link></Td>{staff && <Td>{p.playerName}</Td>}<Td>{humanize(p.purpose)}<span className="block text-navy-600">{p.notes}</span></Td><Td>{humanize(p.method)}</Td><Td className="num font-semibold">{peso(p.amountCents)}</Td><Td>{dateTime(p.paidAt)}</Td><Td><Status value={p.status} /></Td></tr>)}
          </Table>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /></>}
      </Card>
    </>
  );
}

function OtherCharge({ onClose }: { onClose: () => void }) {
  const [player, setPlayer] = useState<any>(null); const [amount, setAmount] = useState(''); const [notes, setNotes] = useState(''); const [method, setMethod] = useState('CASH'); const [ref, setRef] = useState('');
  const toast = useToast(); const qc = useQueryClient();
  const m = useMutation({ mutationFn: () => api.post('/payments', { purpose: 'OTHER', userId: player.id, amountCents: Math.round(+amount * 100), method, notes, externalRef: ref || undefined }), onSuccess: () => { toast('Payment recorded'); qc.invalidateQueries(); onClose(); } });
  return (
    <Modal open onClose={onClose} title="Record another charge">
      <p className="mb-3 text-sm text-navy-600">For items like paddle rental or ball purchases. Bookings, memberships and entry fees are recorded from the list.</p>
      <Field label="Player"><PlayerPicker value={player} onChange={setPlayer} /></Field>
      <div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="Amount (₱)"><Input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field><Field label="Method"><Select value={method} onChange={(e) => setMethod(e.target.value)}><option value="CASH">Cash</option><option value="GCASH_MANUAL">GCash (manual check)</option><option value="BANK_TRANSFER">Bank transfer</option><option value="CARD_TERMINAL">Card terminal</option></Select></Field></div>
      {method !== 'CASH' && <Field label="Transaction reference" className="mt-3"><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>}
      <Field label="What it’s for" className="mt-3"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Paddle rental" /></Field>
      {m.error && <div className="mt-3"><ErrorBox error={m.error} /></div>}
      <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!player || !(+amount > 0) || !notes || (method !== 'CASH' && !ref)} loading={m.isPending} onClick={() => m.mutate()}>Record payment</Button></div>
    </Modal>
  );
}

export function FrontDesk() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['outstanding'], queryFn: () => api.get('/payments/outstanding') });
  const [pay, setPay] = useState<any>(null); const [other, setOther] = useState(false); const [q, setQ] = useState('');
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={refetch} />;
  const items = data.items.filter((i: any) => !q || `${i.playerName} ${i.label}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHeader title="Front desk" sub="Everything waiting for payment. Recording a payment confirms bookings and activates memberships." actions={<><Link to="/app/players"><Button variant="secondary">Register walk-in</Button></Link><Button variant="secondary" onClick={() => setOther(true)}>Other charge</Button></>} />
      <Input className="mb-4 max-w-sm" placeholder="Search player or booking reference" value={q} onChange={(e) => setQ(e.target.value)} />
      <Card pad={false}>
        {!items.length ? <div className="p-5"><Empty title="Nothing outstanding">All bookings, memberships and fees are paid.</Empty></div> : (
          <Table head={['Player', 'Item', 'Date', 'Amount', '']}>
            {items.map((i: any) => <tr key={i.purpose + i.targetId}><Td className="font-semibold">{i.playerName}</Td><Td><Badge color={i.purpose === 'RESERVATION' ? 'green' : i.purpose === 'MEMBERSHIP' ? 'gold' : 'cyan'}>{humanize(i.purpose)}</Badge> <span className="ml-1">{i.label}</span></Td><Td>{i.date ? dateTime(i.date) : '—'}</Td><Td className="num font-semibold">{peso(i.amountCents)}</Td><Td><Button size="sm" onClick={() => setPay(i)}>Record payment</Button></Td></tr>)}
          </Table>)}
      </Card>
      {pay && <RecordPayment open onClose={() => setPay(null)} purpose={pay.purpose} targetId={pay.targetId} amountCents={pay.amountCents} label={`${pay.playerName} · ${pay.label}`} onDone={() => refetch()} />}
      {other && <OtherCharge onClose={() => setOther(false)} />}
    </>
  );
}

export function Receipt() {
  const { id } = useParams(); const { user } = useAuth(); const admin = can.admin(user); const toast = useToast(); const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['payment', id], queryFn: () => api.get(`/payments/${id}`) });
  const [refund, setRefund] = useState(false); const [amt, setAmt] = useState(''); const [reason, setReason] = useState('');
  const r = useMutation({ mutationFn: () => api.post(`/payments/${id}/refund`, { amountCents: Math.round(+amt * 100), reason }), onSuccess: () => { toast('Refund recorded'); setRefund(false); qc.invalidateQueries(); } });
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const p = data.payment, club = data.club;
  const refunded = p.refunds.reduce((a: number, x: any) => a + x.amountCents, 0);
  return (
    <>
      <div className="no-print mb-4 flex flex-wrap justify-end gap-2">
        {admin && p.status === 'PAID' && <Button variant="secondary" onClick={() => { setAmt(((p.amountCents - refunded) / 100).toFixed(2)); setRefund(true); }}>Refund</Button>}
        <Button onClick={() => window.print()}><Printer className="h-4 w-4" />Print receipt</Button>
      </div>
      <div className="print-area mx-auto max-w-xl rounded-lg border border-navy-100 bg-white p-8">
        <div className="flex items-start justify-between border-b-2 border-navy-900 pb-4">
          <div><p className="font-display text-2xl font-bold">{club.name}</p><p className="text-sm text-navy-600">{club.address}</p><p className="text-sm text-navy-600">{club.phone} · {club.email}</p></div>
          <div className="text-right"><p className="font-display text-xl font-bold">Official receipt</p><p className="num text-sm">{p.reference}</p></div>
        </div>
        <dl className="mt-4 grid grid-cols-[140px_1fr] gap-y-1.5 text-sm">
          <dt className="text-navy-600">Received from</dt><dd className="font-semibold">{p.playerName}</dd>
          <dt className="text-navy-600">Date</dt><dd>{dateTime(p.paidAt)}</dd>
          <dt className="text-navy-600">For</dt><dd>{humanize(p.purpose)} — {p.notes}</dd>
          <dt className="text-navy-600">Method</dt><dd>{humanize(p.method)}{p.externalRef ? ` (ref ${p.externalRef})` : ''}</dd>
          <dt className="text-navy-600">Recorded by</dt><dd>{p.recordedByName}</dd>
        </dl>
        <div className="mt-6 flex items-baseline justify-between border-t border-navy-100 pt-4"><span className="font-semibold">Amount paid</span><span className="num font-display text-3xl font-bold">{peso(p.amountCents)}</span></div>
        {p.refunds.length > 0 && <div className="mt-3 border-t border-navy-100 pt-3 text-sm">{p.refunds.map((x: any) => <div key={x.id} className="flex justify-between text-red-700"><span>Refund {date(x.createdAt)} — {x.reason}</span><span className="num">−{peso(x.amountCents)}</span></div>)}<div className="mt-1 flex justify-between font-semibold"><span>Net</span><span className="num">{peso(p.amountCents - refunded)}</span></div></div>}
        <p className="mt-6 text-center text-xs text-navy-600">Thank you for playing with us.</p>
      </div>
      <Modal open={refund} onClose={() => setRefund(false)} title="Refund payment">
        <p className="text-sm text-navy-600">Record the refund after you’ve returned the money. Up to {peso(p.amountCents - refunded)} can be refunded.</p>
        <div className="mt-3 grid gap-3"><Field label="Amount (₱)"><Input type="number" step="0.01" value={amt} onChange={(e) => setAmt(e.target.value)} /></Field><Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
        {r.error && <div className="mt-3"><ErrorBox error={r.error} /></div>}
        <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={() => setRefund(false)}>Cancel</Button><Button variant="danger" disabled={!(+amt > 0) || reason.length < 3} loading={r.isPending} onClick={() => r.mutate()}>Record refund</Button></div>
      </Modal>
    </>
  );
}
