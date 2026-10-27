import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, can } from '../lib/auth';
import { peso, DAYS, dateTime, time, minutesLabel, localIso } from '../lib/format';
import { PageHeader, Card, Button, Loading, ErrorBox, Status, Modal, Field, Input, Select, Textarea, useToast, Table, Td, Empty, Badge } from '../components/ui';

const courtForm = z.object({
  name: z.string().min(1, 'Required'), location: z.string().min(1, 'Required'), surface: z.string().min(1), indoor: z.boolean(), capacity: z.coerce.number().int().min(2).max(8),
  price: z.coerce.number().min(0, 'Must be zero or more'), status: z.enum(['ACTIVE', 'INACTIVE']), slotMinutes: z.coerce.number(), minDurationMinutes: z.coerce.number().int(), maxDurationMinutes: z.coerce.number().int(),
  description: z.string().optional(), photoUrl: z.string().url('Enter a full URL').optional().or(z.literal('')),
  schedules: z.array(z.object({ dayOfWeek: z.coerce.number(), open: z.boolean(), openTime: z.string(), closeTime: z.string() })),
}).refine((v) => v.maxDurationMinutes >= v.minDurationMinutes, { message: 'Must be at least the minimum', path: ['maxDurationMinutes'] })
  .refine((v) => v.schedules.every((s) => !s.open || s.openTime < s.closeTime), { message: 'Closing time must be after opening time', path: ['schedules'] });
type CF = z.infer<typeof courtForm>;

function CourtEditor({ court, onClose }: { court?: any; onClose: () => void }) {
  const toast = useToast(); const qc = useQueryClient();
  const defaults: CF = court ? {
    name: court.name, location: court.location, surface: court.surface, indoor: court.indoor, capacity: court.capacity, price: court.hourlyPriceCents / 100, status: court.status,
    slotMinutes: court.slotMinutes, minDurationMinutes: court.minDurationMinutes, maxDurationMinutes: court.maxDurationMinutes, description: court.description ?? '', photoUrl: court.photoUrl ?? '',
    schedules: DAYS.map((_, d) => { const s = court.schedules.find((x: any) => x.dayOfWeek === d); return { dayOfWeek: d, open: !!s, openTime: s?.openTime ?? '06:00', closeTime: s?.closeTime ?? '22:00' }; }),
  } : { name: '', location: '', surface: 'Hard court', indoor: false, capacity: 4, price: 400, status: 'ACTIVE', slotMinutes: 30, minDurationMinutes: 60, maxDurationMinutes: 180, description: '', photoUrl: '', schedules: DAYS.map((_, d) => ({ dayOfWeek: d, open: true, openTime: '06:00', closeTime: '22:00' })) };
  const { register, handleSubmit, control, formState: { errors, isSubmitting } } = useForm<CF>({ resolver: zodResolver(courtForm), defaultValues: defaults });
  const { fields } = useFieldArray({ control, name: 'schedules' });
  const [err, setErr] = useState<unknown>(null);
  const save = async (v: CF) => {
    setErr(null);
    const schedules = v.schedules.filter((s) => s.open).map((s) => ({ dayOfWeek: s.dayOfWeek, openTime: s.openTime, closeTime: s.closeTime }));
    const body = { name: v.name, location: v.location, surface: v.surface, indoor: v.indoor, capacity: v.capacity, hourlyPriceCents: Math.round(v.price * 100), status: v.status, slotMinutes: v.slotMinutes, minDurationMinutes: v.minDurationMinutes, maxDurationMinutes: v.maxDurationMinutes, description: v.description || null, photoUrl: v.photoUrl || '' };
    try {
      if (court) { await api.patch(`/courts/${court.id}`, body); await api.put(`/courts/${court.id}/schedules`, { schedules }); }
      else await api.post('/courts', { ...body, schedules });
      toast(court ? 'Court saved' : 'Court added'); qc.invalidateQueries(); onClose();
    } catch (e) { setErr(e); }
  };
  return (
    <Modal open onClose={onClose} title={court ? `Edit ${court.name}` : 'Add a court'} wide>
      <form onSubmit={handleSubmit(save)} className="space-y-4">
        {err ? <ErrorBox error={err} /> : null}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name" error={errors.name?.message}><Input {...register('name')} /></Field>
          <Field label="Location" error={errors.location?.message}><Input {...register('location')} /></Field>
          <Field label="Surface"><Input {...register('surface')} /></Field>
          <Field label="Price per hour (₱)" error={errors.price?.message}><Input type="number" step="0.01" {...register('price')} /></Field>
          <Field label="Players allowed"><Input type="number" {...register('capacity')} /></Field>
          <Field label="Status"><Select {...register('status')}><option value="ACTIVE">Active — bookable</option><option value="INACTIVE">Inactive — hidden</option></Select></Field>
          <Field label="Time slots"><Select {...register('slotMinutes')}><option value={15}>Every 15 min</option><option value={30}>Every 30 min</option><option value={60}>Every hour</option></Select></Field>
          <Field label="Shortest booking (min)"><Input type="number" step={15} {...register('minDurationMinutes')} /></Field>
          <Field label="Longest booking (min)" error={errors.maxDurationMinutes?.message}><Input type="number" step={15} {...register('maxDurationMinutes')} /></Field>
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-court-600" {...register('indoor')} />Indoor court</label>
        <Field label="Description"><Textarea {...register('description')} /></Field>
        <Field label="Photo URL" error={errors.photoUrl?.message}><Input placeholder="https://…" {...register('photoUrl')} /></Field>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-navy-800">Opening hours</legend>
          {errors.schedules && <p className="mb-2 text-sm text-red-700">{(errors.schedules as any).message ?? (errors.schedules as any).root?.message}</p>}
          <div className="space-y-2">{fields.map((f, i) => (
            <div key={f.id} className="grid grid-cols-[110px_auto_1fr_1fr] items-center gap-2">
              <span className="text-sm">{DAYS[i]}</span><input type="checkbox" aria-label={`Open on ${DAYS[i]}`} className="h-4 w-4 accent-court-600" {...register(`schedules.${i}.open`)} />
              <Input type="time" aria-label="Opens" {...register(`schedules.${i}.openTime`)} /><Input type="time" aria-label="Closes" {...register(`schedules.${i}.closeTime`)} />
            </div>))}</div>
        </fieldset>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={isSubmitting}>{court ? 'Save court' : 'Add court'}</Button></div>
      </form>
    </Modal>
  );
}

function MaintenanceModal({ court, onClose }: { court: any; onClose: () => void }) {
  const [day, setDay] = useState(''); const [from, setFrom] = useState('06:00'); const [to, setTo] = useState('12:00'); const [reason, setReason] = useState(''); const [force, setForce] = useState(false);
  const toast = useToast(); const qc = useQueryClient();
  const m = useMutation({ mutationFn: () => api.post(`/courts/${court.id}/maintenance`, { startAt: localIso(day, from), endAt: localIso(day, to), reason, cancelConflicts: force }), onSuccess: (r) => { toast(r.cancelled ? `Maintenance scheduled; ${r.cancelled} booking(s) cancelled` : 'Maintenance scheduled'); qc.invalidateQueries(); onClose(); } });
  const conflict = (m.error as any)?.status === 409;
  return (
    <Modal open onClose={onClose} title={`Schedule maintenance: ${court.name}`}>
      <div className="grid gap-3 sm:grid-cols-3"><Field label="Date"><Input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field><Field label="From"><Input type="time" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><Input type="time" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div>
      <Field label="Reason" className="mt-3"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Net replacement" /></Field>
      {m.error && <div className="mt-3"><ErrorBox error={m.error} /></div>}
      {conflict && <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-red-600" checked={force} onChange={(e) => setForce(e.target.checked)} />Cancel those bookings and notify the players</label>}
      <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Close</Button><Button disabled={!day || reason.length < 2} loading={m.isPending} onClick={() => m.mutate()}>Schedule</Button></div>
    </Modal>
  );
}

export function CourtList() {
  const { user } = useAuth(); const admin = can.admin(user); const toast = useToast(); const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['courts', 'all'], queryFn: () => api.get('/courts?all=1') });
  const [edit, setEdit] = useState<any>(null); const [maint, setMaint] = useState<any>(null);
  const toggle = useMutation({ mutationFn: (c: any) => api.patch(`/courts/${c.id}`, { status: c.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }), onSuccess: () => { toast('Availability updated'); qc.invalidateQueries(); }, onError: (e: Error) => toast(e.message, 'err') });
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={refetch} />;
  return (
    <>
      <PageHeader title="Courts" sub={`${data.courts.filter((c: any) => c.status === 'ACTIVE').length} of ${data.courts.length} accepting bookings`} actions={admin && <Button onClick={() => setEdit({})}>Add court</Button>} />
      {!data.courts.length ? <Empty title="No courts yet" action={admin && <Button onClick={() => setEdit({})}>Add your first court</Button>}>Add a court and its opening hours to start taking bookings.</Empty> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data.courts.map((c: any) => (
          <Card key={c.id}>
            {c.photoUrl && <img src={c.photoUrl} alt="" className="-mx-5 -mt-5 mb-4 h-36 w-[calc(100%+2.5rem)] max-w-none rounded-t-lg object-cover" />}
            <div className="flex items-start justify-between gap-2"><Link to={`/app/courts/${c.id}`} className="font-display text-2xl font-bold hover:text-court-600">{c.name}</Link><Status value={c.status} /></div>
            <p className="text-sm text-navy-600">{c.location} · {c.indoor ? 'Indoor' : 'Outdoor'} · {c.surface}</p>
            <p className="num mt-2 text-lg font-semibold">{peso(c.hourlyPriceCents)} <span className="text-sm font-normal text-navy-600">per hour · {minutesLabel(c.minDurationMinutes)}–{minutesLabel(c.maxDurationMinutes)}</span></p>
            <p className="mt-1 text-sm text-navy-600">{c.schedules.length ? `Open ${c.schedules.length} days a week` : 'No opening hours set'}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" loading={toggle.isPending && toggle.variables?.id === c.id} onClick={() => toggle.mutate(c)}>{c.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</Button>
              {admin && <Button size="sm" variant="secondary" onClick={() => setEdit(c)}>Edit</Button>}
              {admin && <Button size="sm" variant="secondary" onClick={() => setMaint(c)}>Maintenance</Button>}
            </div>
          </Card>))}
        </div>)}
      {edit && <CourtEditor court={edit.id ? edit : undefined} onClose={() => setEdit(null)} />}
      {maint && <MaintenanceModal court={maint} onClose={() => setMaint(null)} />}
    </>
  );
}

export function CourtDetail() {
  const { id } = useParams(); const { user } = useAuth(); const admin = can.admin(user); const qc = useQueryClient(); const toast = useToast();
  const court = useQuery({ queryKey: ['court', id], queryFn: () => api.get(`/courts/${id}`) });
  const hist = useQuery({ queryKey: ['court-res', id], queryFn: () => api.get(`/courts/${id}/reservations`) });
  const maint = useQuery({ queryKey: ['court-maint', id], queryFn: () => api.get(`/courts/${id}/maintenance`) });
  const del = useMutation({ mutationFn: (mid: string) => api.del(`/courts/maintenance/${mid}`), onSuccess: () => { toast('Maintenance removed'); qc.invalidateQueries(); } });
  if (court.isLoading) return <Loading />;
  if (court.error) return <ErrorBox error={court.error} />;
  const c = court.data.court;
  return (
    <>
      <PageHeader title={c.name} sub={<>{c.location} · {c.indoor ? 'Indoor' : 'Outdoor'} · <Status value={c.status} /></>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Opening hours"><ul className="space-y-1 text-sm">{DAYS.map((d, i) => { const s = c.schedules.find((x: any) => x.dayOfWeek === i); return <li key={d} className="flex justify-between"><span>{d}</span><span className="num">{s ? `${s.openTime}–${s.closeTime}` : 'Closed'}</span></li>; })}</ul></Card>
        <Card title="Maintenance" className="lg:col-span-2" pad={false}>
          {maint.data?.maintenance.length ? <ul className="divide-y divide-navy-100">{maint.data.maintenance.map((m: any) => <li key={m.id} className="flex items-center justify-between px-5 py-3"><div><p className="font-semibold">{m.reason}</p><p className="text-sm text-navy-600">{dateTime(m.startAt)} – {dateTime(m.endAt)}</p></div>{admin && new Date(m.endAt) > new Date() && <Button size="sm" variant="ghost" aria-label="Remove" onClick={() => del.mutate(m.id)}><Trash2 className="h-4 w-4" /></Button>}</li>)}</ul> : <p className="p-5 text-navy-600">No maintenance scheduled.</p>}
        </Card>
      </div>
      <Card title="Reservation history" className="mt-4" pad={false}>
        {hist.isLoading ? <Loading /> : !hist.data?.reservations.length ? <p className="p-5 text-navy-600">No bookings yet.</p> : (
          <Table head={['Reference', 'Player', 'When', 'Total', 'Status']}>{hist.data.reservations.map((r: any) => <tr key={r.id}><Td><Link className="font-semibold text-court-700 hover:underline" to={`/app/reservations/${r.id}`}>{r.reference}</Link></Td><Td>{r.playerName}</Td><Td>{dateTime(r.startAt)}–{time(r.endAt)}</Td><Td className="num">{peso(r.totalPriceCents)}</Td><Td><Status value={r.status} /> {r.paymentStatus === 'UNPAID' && <Badge color="gold">Unpaid</Badge>}</Td></tr>)}</Table>)}
      </Card>
    </>
  );
}
