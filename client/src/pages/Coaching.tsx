import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth, can } from '../lib/auth';
import { peso, dateTime, time, humanize, ymd, localIso } from '../lib/format';
import { PageHeader, Card, Button, Loading, ErrorBox, Status, Modal, Field, Input, Select, useToast, Table, Td, Empty, Badge, Tabs, Confirm } from '../components/ui';
import { PlayerPicker } from '../components/PlayerPicker';
import { RecordPayment } from '../components/RecordPayment';

function NewSession({ onClose }: { onClose: () => void }) {
  const { user } = useAuth(); const isCoach = can.coach(user); const toast = useToast(); const qc = useQueryClient();
  const coaches = useQuery({ queryKey: ['coaches'], queryFn: () => api.get('/coaching/coaches') });
  const courts = useQuery({ queryKey: ['courts'], queryFn: () => api.get('/courts') });
  const [f, setF] = useState({ coachId: '', title: '', kind: 'INDIVIDUAL', day: ymd(), hhmm: '08:00', duration: 60, courtId: '', price: 800, capacity: 1 });
  const m = useMutation({ mutationFn: () => api.post('/coaching/sessions', { ...(isCoach ? {} : { coachId: f.coachId }), title: f.title, kind: f.kind, startAt: localIso(f.day, f.hhmm), durationMinutes: +f.duration, courtId: f.courtId || null, priceCents: Math.round(+f.price * 100), capacity: f.kind === 'INDIVIDUAL' ? 1 : +f.capacity }), onSuccess: () => { toast('Session scheduled'); qc.invalidateQueries(); onClose(); } });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open onClose={onClose} title="Schedule a session" wide>
      <div className="grid gap-3 sm:grid-cols-3">
        {!isCoach && <Field label="Coach"><Select value={f.coachId} onChange={set('coachId')}><option value="">Choose…</option>{coaches.data?.coaches.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>}
        <Field label="Title" className={isCoach ? 'sm:col-span-2' : ''}><Input value={f.title} onChange={set('title')} placeholder="e.g. Third-shot drop clinic" /></Field>
        <Field label="Type"><Select value={f.kind} onChange={set('kind')}><option value="INDIVIDUAL">Private lesson</option><option value="GROUP">Group clinic</option></Select></Field>
        <Field label="Date"><Input type="date" value={f.day} onChange={set('day')} /></Field>
        <Field label="Start"><Input type="time" value={f.hhmm} onChange={set('hhmm')} /></Field>
        <Field label="Length (min)"><Input type="number" step={15} value={f.duration} onChange={set('duration')} /></Field>
        <Field label="Court (optional)"><Select value={f.courtId} onChange={set('courtId')}><option value="">Decide later</option>{courts.data?.courts.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Price per player (₱)"><Input type="number" min={0} value={f.price} onChange={set('price')} /></Field>
        {f.kind === 'GROUP' && <Field label="Spots"><Input type="number" min={2} max={16} value={f.capacity} onChange={set('capacity')} /></Field>}
      </div>
      {m.error && <div className="mt-3"><ErrorBox error={m.error} /></div>}
      <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={f.title.length < 3 || (!isCoach && !f.coachId)} onClick={() => m.mutate()}>Schedule session</Button></div>
    </Modal>
  );
}

function AddCoach({ onClose }: { onClose: () => void }) {
  const [u, setU] = useState<any>(null); const [rate, setRate] = useState(800); const [bio, setBio] = useState(''); const toast = useToast(); const qc = useQueryClient();
  const m = useMutation({ mutationFn: () => api.post('/coaching/coaches', { userId: u.id, hourlyRateCents: Math.round(rate * 100), bio }), onSuccess: () => { toast(`${u.fullName} is now a coach`); qc.invalidateQueries(); onClose(); } });
  return (
    <Modal open onClose={onClose} title="Add a coach">
      <p className="mb-3 text-sm text-navy-600">Choose an existing account. Its role changes to Coach.</p>
      <Field label="Account"><PlayerPicker value={u} onChange={setU} /></Field>
      <Field label="Hourly rate (₱)" className="mt-3"><Input type="number" value={rate} onChange={(e) => setRate(+e.target.value)} /></Field>
      <Field label="Bio" className="mt-3"><Input value={bio} onChange={(e) => setBio(e.target.value)} /></Field>
      {m.error && <div className="mt-3"><ErrorBox error={m.error} /></div>}
      <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!u} loading={m.isPending} onClick={() => m.mutate()}>Add coach</Button></div>
    </Modal>
  );
}

export function CoachingList() {
  const { user } = useAuth(); const canCreate = can.admin(user) || can.coach(user); const toast = useToast(); const qc = useQueryClient();
  const [tab, setTab] = useState<'sessions' | 'coaches'>('sessions'); const [open, setOpen] = useState(false); const [addCoach, setAddCoach] = useState(false);
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get(`/coaching/sessions${can.coach(user) ? '?mine=1' : ''}`) });
  const coaches = useQuery({ queryKey: ['coaches'], queryFn: () => api.get('/coaching/coaches') });
  const enroll = useMutation({ mutationFn: (id: string) => api.post(`/coaching/sessions/${id}/enroll`), onSuccess: () => { toast('You’re enrolled'); qc.invalidateQueries(); }, onError: (e: Error) => toast(e.message, 'err') });
  const leave = useMutation({ mutationFn: (id: string) => api.del(`/coaching/sessions/${id}/enroll`), onSuccess: () => { toast('Enrollment cancelled'); qc.invalidateQueries(); }, onError: (e: Error) => toast(e.message, 'err') });
  return (
    <>
      <PageHeader title="Coaching" actions={<>{can.admin(user) && <Button variant="secondary" onClick={() => setAddCoach(true)}>Add coach</Button>}{canCreate && <Button onClick={() => setOpen(true)}>Schedule session</Button>}</>} />
      <div className="mb-4"><Tabs value={tab} onChange={setTab} items={[{ value: 'sessions', label: 'Sessions' }, { value: 'coaches', label: 'Coaches' }]} /></div>
      {tab === 'coaches' ? (coaches.isLoading ? <Loading /> : !coaches.data?.coaches.length ? <Empty title="No coaches yet" /> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{coaches.data.coaches.map((c: any) => <Card key={c.id}><p className="font-display text-2xl font-bold">{c.name}</p><p className="num text-sm text-navy-600">{peso(c.hourlyRateCents)} per hour</p><p className="mt-2 text-navy-700">{c.bio}</p></Card>)}</div>
      )) : sessions.isLoading ? <Loading /> : sessions.error ? <ErrorBox error={sessions.error} /> : !sessions.data.sessions.length ? <Empty title="No sessions scheduled" /> : (
        <Card pad={false}><Table head={['Session', 'Coach', 'When', 'Price', 'Spots', 'Status', '']}>
          {sessions.data.sessions.map((s: any) => {
            const full = s.enrolled >= s.capacity; const future = new Date(s.startAt) > new Date();
            return <tr key={s.id} className="hover:bg-paper">
              <Td><Link className="font-semibold text-court-700 hover:underline" to={`/app/coaching/${s.id}`}>{s.title}</Link><span className="block text-navy-600">{s.kind === 'GROUP' ? 'Group clinic' : 'Private lesson'}{s.courtName ? ` · ${s.courtName}` : ''}</span></Td>
              <Td>{s.coachName}</Td><Td>{dateTime(s.startAt)}–{time(s.endAt)}</Td><Td className="num">{s.priceCents ? peso(s.priceCents) : 'Free'}</Td><Td className="num">{s.enrolled}/{s.capacity}</Td><Td><Status value={s.status} /></Td>
              <Td>{user?.role === 'PLAYER' && s.status === 'SCHEDULED' && future && (s.myEnrollment ? <Button size="sm" variant="secondary" onClick={() => leave.mutate(s.id)}>Leave</Button> : <Button size="sm" disabled={full} onClick={() => enroll.mutate(s.id)}>{full ? 'Full' : 'Enroll'}</Button>)}
                {s.myEnrollment && <Badge color="green" className="ml-1">Enrolled</Badge>}</Td>
            </tr>;
          })}
        </Table></Card>
      )}
      {open && <NewSession onClose={() => setOpen(false)} />}
      {addCoach && <AddCoach onClose={() => setAddCoach(false)} />}
    </>
  );
}

export function CoachingDetail() {
  const { id } = useParams(); const { user } = useAuth(); const staff = can.staff(user); const toast = useToast(); const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['session', id], queryFn: () => api.get(`/coaching/sessions/${id}`) });
  const [add, setAdd] = useState<any>(null); const [pay, setPay] = useState<any>(null); const [closing, setClosing] = useState<string | null>(null);
  const att = useMutation({ mutationFn: (v: { playerId: string; attended: boolean }) => api.post(`/coaching/sessions/${id}/attendance`, v), onSuccess: () => qc.invalidateQueries({ queryKey: ['session', id] }), onError: (e: Error) => toast(e.message, 'err') });
  const enrollFor = useMutation({ mutationFn: () => api.post(`/coaching/sessions/${id}/enroll`, { playerId: add.id }), onSuccess: () => { toast('Player enrolled'); setAdd(null); qc.invalidateQueries(); }, onError: (e: Error) => toast(e.message, 'err') });
  const st = useMutation({ mutationFn: (status: string) => api.post(`/coaching/sessions/${id}/status`, { status }), onSuccess: () => { toast('Session updated'); setClosing(null); qc.invalidateQueries(); }, onError: (e: Error) => toast(e.message, 'err') });
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const s = data.session; const owner = can.admin(user) || s.coach.userId === user?.id;
  return (
    <>
      <PageHeader title={s.title} sub={<>{s.coach.user.fullName} · {dateTime(s.startAt)}–{time(s.endAt)}{s.court ? ` · ${s.court.name}` : ''} · <Status value={s.status} /></>} actions={owner && s.status === 'SCHEDULED' && <><Button variant="secondary" onClick={() => setClosing('COMPLETED')}>Mark completed</Button><Button variant="danger" onClick={() => setClosing('CANCELLED')}>Cancel session</Button></>} />
      <Card title={`Roster (${data.roster.length}/${s.capacity})`} pad={false} action={staff && s.status === 'SCHEDULED' && data.roster.length < s.capacity && <div className="w-64"><PlayerPicker value={add} onChange={(v) => setAdd(v)} placeholder="Enroll a player" /></div>}>
        {add && <div className="flex items-center gap-2 border-b border-navy-100 px-5 py-2"><span>Enroll {add.fullName}?</span><Button size="sm" loading={enrollFor.isPending} onClick={() => enrollFor.mutate()}>Enroll</Button><Button size="sm" variant="ghost" onClick={() => setAdd(null)}>Cancel</Button></div>}
        {!data.roster.length ? <p className="p-5 text-navy-600">{owner || staff ? 'No one has enrolled yet.' : 'The roster is visible to the coach and staff.'}</p> : (
          <Table head={['Player', 'Payment', 'Attendance', '']}>
            {data.roster.map((r: any) => <tr key={r.id}><Td className="font-semibold">{(owner || staff) ? <Link className="hover:underline" to={`/app/players/${r.playerId}`}>{r.playerName}</Link> : r.playerName}</Td><Td><Status value={r.paymentStatus} /></Td>
              <Td>{owner ? <Select className="w-36" value={r.attended === null ? '' : r.attended ? 'yes' : 'no'} onChange={(e) => e.target.value && att.mutate({ playerId: r.playerId, attended: e.target.value === 'yes' })} aria-label="Attendance"><option value="">Not marked</option><option value="yes">Attended</option><option value="no">Absent</option></Select> : r.attended === null ? '—' : r.attended ? 'Attended' : 'Absent'}</Td>
              <Td>{staff && r.paymentStatus === 'UNPAID' && s.priceCents > 0 && <Button size="sm" variant="secondary" onClick={() => setPay(r)}>Record payment</Button>}</Td></tr>)}
          </Table>)}
      </Card>
      <p className="mt-3 text-sm text-navy-600">{s.kind === 'GROUP' ? 'Group clinic' : 'Private lesson'} · {s.priceCents ? `${peso(s.priceCents)} per player` : 'Free'}</p>
      {pay && <RecordPayment open onClose={() => setPay(null)} purpose="COACHING" targetId={pay.id} amountCents={s.priceCents} label={`${s.title} · ${pay.playerName}`} />}
      <Confirm open={!!closing} onClose={() => setClosing(null)} title={closing === 'CANCELLED' ? 'Cancel this session?' : 'Mark as completed?'} confirmLabel={closing === 'CANCELLED' ? 'Cancel session' : 'Mark completed'} danger={closing === 'CANCELLED'} loading={st.isPending} onConfirm={() => st.mutate(closing!)}>{closing === 'CANCELLED' ? 'Enrolled players are notified. Refund paid fees from Payments.' : 'Record attendance first if you haven’t.'}</Confirm>
    </>
  );
}
void humanize;
