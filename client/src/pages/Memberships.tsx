import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { peso, date, humanize } from '../lib/format';
import { PageHeader, Card, Button, Loading, ErrorBox, Status, Modal, Field, Input, Select, Textarea, useToast, Table, Td, Empty, Badge, Confirm, Tabs, cx } from '../components/ui';

export function MyMembership() {
  const { refresh } = useAuth(); const toast = useToast(); const qc = useQueryClient();
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.get('/membership-plans') });
  const me = useQuery({ queryKey: ['my-membership'], queryFn: () => api.get('/memberships/me') });
  const [pick, setPick] = useState<any>(null); const [cancelId, setCancelId] = useState<string | null>(null);
  const sub = useMutation({ mutationFn: (planId: string) => api.post('/memberships', { planId }), onSuccess: (r) => { toast(r.membership.status === 'ACTIVE' ? 'Membership active' : 'Request sent — pay at the front desk to activate'); setPick(null); qc.invalidateQueries(); refresh(); }, onError: (e: Error) => toast(e.message, 'err') });
  const cancel = useMutation({ mutationFn: (id: string) => api.post(`/memberships/${id}/cancel`), onSuccess: () => { toast('Request withdrawn'); setCancelId(null); qc.invalidateQueries(); } });
  if (plans.isLoading || me.isLoading) return <Loading />;
  if (plans.error || me.error) return <ErrorBox error={plans.error || me.error} />;
  const cur = me.data.current; const pending = me.data.history.find((h: any) => h.status === 'PENDING');
  return (
    <>
      <PageHeader title="Membership" sub={cur ? <>You’re on <span className="font-semibold text-gold-500">{cur.plan.name}</span> until {date(cur.endDate)}.</> : 'Members save on every booking and can book further ahead.'} />
      {pending && <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-gold-400 bg-gold-100 px-4 py-3 text-[#6B4E06]"><span><span className="font-semibold">{pending.plan.name}</span> is waiting for payment of {peso(pending.priceCents)} at the front desk.</span><Button size="sm" variant="secondary" onClick={() => setCancelId(pending.id)}>Withdraw request</Button></div>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{plans.data.plans.map((p: any) => {
        const isCur = cur?.plan.id === p.id;
        return <div key={p.id} className={cx('flex flex-col rounded-lg border bg-white p-5', isCur ? 'border-gold-400 ring-2 ring-gold-100' : 'border-navy-100')}>
          <div className="flex items-center justify-between"><h2 className="text-2xl font-bold">{p.name}</h2>{isCur && <Badge color="gold">Current</Badge>}</div>
          <p className="num mt-1 font-display text-3xl font-bold">{peso(p.priceCents)}</p><p className="text-sm text-navy-600">for {p.durationDays} days</p>
          <ul className="mt-3 flex-1 space-y-1.5 text-sm">{[`${p.discountPercent}% off court bookings`, `Book up to ${p.advanceBookingDays} days ahead`, `Up to ${p.maxActiveBookings} upcoming bookings`, ...p.benefits.filter((b: string) => !/% off|days ahead/.test(b))].map((b) => <li key={b} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-court-600" />{b}</li>)}</ul>
          {p.minSkillLevel && <p className="mt-2 text-xs text-navy-600">For {humanize(p.minSkillLevel).toLowerCase()} players and above</p>}
          <Button className="mt-4" variant={isCur ? 'secondary' : 'primary'} disabled={!!pending || (isCur && !p.renewable)} onClick={() => setPick(p)}>{isCur ? 'Renew' : cur ? 'Switch to this plan' : 'Choose plan'}</Button>
        </div>;
      })}</div>
      <Card title="History" className="mt-6" pad={false}>
        {me.data.history.length ? <Table head={['Plan', 'From', 'Until', 'Price', 'Status']}>{me.data.history.map((m: any) => <tr key={m.id}><Td>{m.plan.name}</Td><Td>{m.status === 'PENDING' ? '—' : date(m.startDate)}</Td><Td>{m.status === 'PENDING' ? '—' : date(m.endDate)}</Td><Td className="num">{peso(m.priceCents)}</Td><Td><Status value={m.status} /></Td></tr>)}</Table> : <p className="p-5 text-navy-600">No memberships yet.</p>}
      </Card>
      <Confirm open={!!pick} onClose={() => setPick(null)} title={`${cur?.plan.id === pick?.id ? 'Renew' : 'Join'} ${pick?.name}?`} confirmLabel="Send request" loading={sub.isPending} onConfirm={() => sub.mutate(pick.id)}>
        {pick?.priceCents ? <>Pay {peso(pick.priceCents)} at the front desk. {cur ? 'Your new period starts when the current one ends.' : 'Your membership starts when payment is recorded.'} Nothing is charged automatically.</> : 'This plan is free and starts right away.'}
      </Confirm>
      <Confirm open={!!cancelId} onClose={() => setCancelId(null)} title="Withdraw this request?" confirmLabel="Withdraw" danger loading={cancel.isPending} onConfirm={() => cancel.mutate(cancelId!)}>You can request a plan again later.</Confirm>
    </>
  );
}

function PlanEditor({ plan, onClose }: { plan?: any; onClose: () => void }) {
  const [f, setF] = useState({ name: plan?.name ?? '', description: plan?.description ?? '', price: plan ? plan.priceCents / 100 : 500, durationDays: plan?.durationDays ?? 30, discountPercent: plan?.discountPercent ?? 10, advanceBookingDays: plan?.advanceBookingDays ?? 14, maxActiveBookings: plan?.maxActiveBookings ?? 3, benefits: (plan?.benefits ?? []).join('\n'), renewable: plan?.renewable ?? true, minSkillLevel: plan?.minSkillLevel ?? '', active: plan?.active ?? true, sortOrder: plan?.sortOrder ?? 0 });
  const toast = useToast(); const qc = useQueryClient();
  const m = useMutation({ mutationFn: () => { const body = { ...f, priceCents: Math.round(+f.price * 100), benefits: f.benefits.split('\n').map((s: string) => s.trim()).filter(Boolean), minSkillLevel: f.minSkillLevel || null, price: undefined }; return plan ? api.patch(`/membership-plans/${plan.id}`, body) : api.post('/membership-plans', body); }, onSuccess: () => { toast('Plan saved'); qc.invalidateQueries(); onClose(); } });
  const num = (k: keyof typeof f) => ({ value: f[k] as any, onChange: (e: any) => setF({ ...f, [k]: +e.target.value }) });
  return (
    <Modal open onClose={onClose} title={plan ? `Edit ${plan.name}` : 'New plan'} wide>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Price (₱)"><Input type="number" step="0.01" {...num('price')} /></Field>
        <Field label="Length (days)"><Input type="number" {...num('durationDays')} /></Field>
        <Field label="Court discount %"><Input type="number" min={0} max={100} {...num('discountPercent')} /></Field>
        <Field label="Book ahead (days)"><Input type="number" {...num('advanceBookingDays')} /></Field>
        <Field label="Max upcoming bookings"><Input type="number" {...num('maxActiveBookings')} /></Field>
        <Field label="Minimum level"><Select value={f.minSkillLevel} onChange={(e) => setF({ ...f, minSkillLevel: e.target.value })}><option value="">Anyone</option>{['INTERMEDIATE', 'ADVANCED', 'COMPETITIVE'].map((s) => <option key={s} value={s}>{humanize(s)}+</option>)}</Select></Field>
        <Field label="Display order"><Input type="number" {...num('sortOrder')} /></Field>
      </div>
      <Field label="Description" className="mt-3"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="Benefits (one per line)" className="mt-3"><Textarea value={f.benefits} onChange={(e) => setF({ ...f, benefits: e.target.value })} /></Field>
      <div className="mt-3 flex gap-6"><label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-court-600" checked={f.renewable} onChange={(e) => setF({ ...f, renewable: e.target.checked })} />Renewable</label><label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-court-600" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Offered to players</label></div>
      {m.error && <div className="mt-3"><ErrorBox error={m.error} /></div>}
      <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Save plan</Button></div>
    </Modal>
  );
}

export function ManageMemberships() {
  const [tab, setTab] = useState<'plans' | 'members'>('plans'); const [edit, setEdit] = useState<any>(null); const [st, setSt] = useState('ACTIVE');
  const plans = useQuery({ queryKey: ['plans', 'all'], queryFn: () => api.get('/membership-plans?all=1') });
  const list = useQuery({ queryKey: ['memberships', st], queryFn: () => api.get(`/memberships${qs({ status: st, pageSize: 100 })}`), enabled: tab === 'members' });
  return (
    <>
      <PageHeader title="Memberships" actions={tab === 'plans' && <Button onClick={() => setEdit({})}>New plan</Button>} />
      <div className="mb-4 flex flex-wrap gap-2"><Tabs value={tab} onChange={setTab} items={[{ value: 'plans', label: 'Plans' }, { value: 'members', label: 'Members' }]} />
        {tab === 'members' && <Select className="w-40" value={st} onChange={(e) => setSt(e.target.value)} aria-label="Status"><option value="ACTIVE">Active</option><option value="PENDING">Awaiting payment</option><option value="EXPIRED">Expired</option><option value="CANCELLED">Cancelled</option></Select>}
      </div>
      {tab === 'plans' ? (plans.isLoading ? <Loading /> : plans.error ? <ErrorBox error={plans.error} /> : (
        <Card pad={false}><Table head={['Plan', 'Price', 'Length', 'Discount', 'Book ahead', 'Status', '']}>{plans.data.plans.map((p: any) => <tr key={p.id}><Td className="font-semibold">{p.name}</Td><Td className="num">{peso(p.priceCents)}</Td><Td>{p.durationDays} days</Td><Td>{p.discountPercent}%</Td><Td>{p.advanceBookingDays} days</Td><Td>{p.active ? <Badge color="green">Offered</Badge> : <Badge>Hidden</Badge>}</Td><Td><Button size="sm" variant="secondary" onClick={() => setEdit(p)}>Edit</Button></Td></tr>)}</Table></Card>
      )) : (list.isLoading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : !list.data.items.length ? <Empty title="No memberships with this status" /> : (
        <Card pad={false}><Table head={['Player', 'Plan', 'From', 'Until', 'Price', 'Status']}>{list.data.items.map((m: any) => <tr key={m.id}><Td><span className="font-semibold">{m.playerName}</span><span className="block text-navy-600">{m.email}</span></Td><Td>{m.planName}</Td><Td>{m.status === 'PENDING' ? '—' : date(m.startDate)}</Td><Td>{m.status === 'PENDING' ? '—' : date(m.endDate)}</Td><Td className="num">{peso(m.priceCents)}</Td><Td><Status value={m.status} /></Td></tr>)}</Table></Card>
      ))}
      {edit && <PlanEditor plan={edit.id ? edit : undefined} onClose={() => setEdit(null)} />}
    </>
  );
}
