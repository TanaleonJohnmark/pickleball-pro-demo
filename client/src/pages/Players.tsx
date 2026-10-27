import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { useAuth, can } from '../lib/auth';
import { peso, date, dateTime, humanize } from '../lib/format';
import { PageHeader, Card, Button, Loading, ErrorBox, Status, Modal, Field, Input, Select, Textarea, useToast, Table, Td, Empty, Pagination, Badge, Confirm, Tabs, StatCard } from '../components/ui';

function WalkIn({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ fullName: '', email: '', phone: '', skillLevel: 'BEGINNER' }); const qc = useQueryClient();
  const m = useMutation({ mutationFn: () => api.post('/players', f), onSuccess: () => qc.invalidateQueries({ queryKey: ['players'] }) });
  return (
    <Modal open onClose={onClose} title="Register a walk-in player">
      {m.data ? (
        <div>
          <p className="text-navy-700"><span className="font-semibold">{m.data.player.fullName}</span> can sign in with:</p>
          <dl className="mt-3 rounded-md bg-paper p-4 font-mono text-sm"><div>{m.data.player.email}</div><div className="mt-1">Temporary password: <span className="font-bold">{m.data.temporaryPassword}</span></div></dl>
          <p className="mt-2 text-sm text-navy-600">Shown once. Ask the player to change it from their profile.</p>
          <div className="mt-5 flex justify-end gap-2"><Link to="/app/book"><Button variant="secondary">Book a court for them</Button></Link><Button onClick={onClose}>Done</Button></div>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="space-y-3">
          <Field label="Full name"><Input required value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Email"><Input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field><Field label="Mobile"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field></div>
          <Field label="Skill level"><Select value={f.skillLevel} onChange={(e) => setF({ ...f, skillLevel: e.target.value })}>{['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'COMPETITIVE'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select></Field>
          {m.error && <ErrorBox error={m.error} />}
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={m.isPending}>Register player</Button></div>
        </form>
      )}
    </Modal>
  );
}

export function PlayerList() {
  const { user } = useAuth(); const staff = can.staff(user);
  const [q, setQ] = useState(''); const [skill, setSkill] = useState(''); const [status, setStatus] = useState(''); const [membership, setMembership] = useState(''); const [page, setPage] = useState(1); const [walk, setWalk] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['players', q, skill, status, membership, page], queryFn: () => api.get(`/players${qs({ q, skill, status, membership, page })}`) });
  return (
    <>
      <PageHeader title={staff ? 'Players' : 'My students'} actions={staff && <Button onClick={() => setWalk(true)}>Register walk-in</Button>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Search name, email or phone" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <Select className="w-40" value={skill} onChange={(e) => { setSkill(e.target.value); setPage(1); }} aria-label="Skill"><option value="">Any level</option>{['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'COMPETITIVE'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
        {staff && <Select className="w-40" value={membership} onChange={(e) => { setMembership(e.target.value); setPage(1); }} aria-label="Membership"><option value="">Members and not</option><option value="member">Members</option><option value="none">Non-members</option></Select>}
        {staff && <Select className="w-36" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status"><option value="">Any status</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option></Select>}
      </div>
      <Card pad={false}>
        {isLoading ? <Loading /> : error ? <div className="p-4"><ErrorBox error={error} retry={refetch} /></div> : !data.items.length ? <div className="p-5"><Empty title="No players match">Try a different search or filter.</Empty></div> : <>
          <Table head={['Name', ...(staff ? ['Contact'] : []), 'Level', 'Membership', 'Joined', 'Status']}>
            {data.items.map((p: any) => <tr key={p.id} className="hover:bg-paper">
              <Td><Link className="font-semibold text-court-700 hover:underline" to={`/app/players/${p.id}`}>{p.fullName}</Link></Td>
              {staff && <Td><span className="block">{p.email}</span><span className="text-navy-600">{p.phone}</span></Td>}
              <Td>{humanize(p.skillLevel)}</Td><Td>{p.membership ? <Badge color="gold">{p.membership.plan}</Badge> : <span className="text-navy-600">—</span>}</Td>
              <Td>{date(p.createdAt)}</Td><Td><Status value={p.status} /></Td>
            </tr>)}
          </Table>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /></>}
      </Card>
      {walk && <WalkIn onClose={() => setWalk(false)} />}
    </>
  );
}

export function PlayerDetail() {
  const { id } = useParams(); const { user } = useAuth(); const admin = can.admin(user); const toast = useToast(); const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['player', id], queryFn: () => api.get(`/players/${id}`) });
  const [tab, setTab] = useState<'bookings' | 'matches' | 'memberships' | 'tournaments' | 'payments'>('bookings');
  const [edit, setEdit] = useState(false); const [susp, setSusp] = useState(false); const [note, setNote] = useState('');
  const status = useMutation({ mutationFn: (s: string) => api.post(`/players/${id}/status`, { status: s }), onSuccess: () => { toast('Account updated'); setSusp(false); qc.invalidateQueries(); } , onError: (e: Error) => toast(e.message, 'err') });
  const addNote = useMutation({ mutationFn: () => api.post('/coaching/notes', { playerId: id, note }), onSuccess: () => { toast('Note saved'); setNote(''); qc.invalidateQueries({ queryKey: ['player', id] }); }, onError: (e: Error) => toast(e.message, 'err') });
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={refetch} />;
  const p = data.player, pr = data.profile;
  const coachView = !!data.notes;
  return (
    <>
      <PageHeader title={p.fullName} sub={<>{humanize(pr?.skillLevel)} · prefers {humanize(pr?.preferredFormat)} · joined {date(p.createdAt)} · <Status value={p.status} /></>} actions={admin && <>
        <Button variant="secondary" onClick={() => setEdit(true)}>Edit</Button>
        {p.status === 'ACTIVE' ? <Button variant="danger" onClick={() => setSusp(true)}>Suspend</Button> : <Button onClick={() => status.mutate('ACTIVE')}>Reactivate</Button>}
      </>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Matches played" value={data.stats.played} />
        <StatCard label="Win rate" value={data.stats.played ? `${Math.round((data.stats.wins / data.stats.played) * 100)}%` : '—'} />
        {['DOUBLES', 'SINGLES'].map((f) => { const r = data.rankings.find((x: any) => x.format === f); return <StatCard key={f} label={`${humanize(f)} rating`} value={r?.rating ?? '—'} note={r ? `${r.wins}W ${r.losses}L` : undefined} accent="cyan" />; })}
      </div>
      {!coachView && <Card className="mt-4"><p className="text-sm text-navy-600">{p.email} · {p.phone ?? 'no phone'}</p></Card>}
      {coachView ? (
        <Card title="Development notes" className="mt-4">
          <form className="mb-4 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); addNote.mutate(); }}><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you work on? What's next?" /><Button className="self-end" disabled={note.trim().length < 2} loading={addNote.isPending}>Save note</Button></form>
          {data.notes.length ? <ul className="space-y-3">{data.notes.map((n: any) => <li key={n.id} className="border-l-2 border-court-500 pl-3"><p>{n.note}</p><p className="text-xs text-navy-600">{dateTime(n.createdAt)}</p></li>)}</ul> : <p className="text-navy-600">No notes yet.</p>}
        </Card>
      ) : <>
        <div className="mb-3 mt-6"><Tabs value={tab} onChange={setTab} items={[{ value: 'bookings', label: 'Bookings' }, { value: 'matches', label: 'Matches' }, { value: 'memberships', label: 'Memberships' }, { value: 'tournaments', label: 'Tournaments' }, { value: 'payments', label: 'Payments' }]} /></div>
        <Card pad={false}>
          {tab === 'bookings' && (data.reservations.length ? <Table head={['Reference', 'Court', 'When', 'Total', 'Status']}>{data.reservations.map((r: any) => <tr key={r.id}><Td><Link className="font-semibold text-court-700 hover:underline" to={`/app/reservations/${r.id}`}>{r.reference}</Link></Td><Td>{r.courtName}</Td><Td>{dateTime(r.startAt)}</Td><Td className="num">{peso(r.totalPriceCents)}</Td><Td><Status value={r.status} /></Td></tr>)}</Table> : <p className="p-5 text-navy-600">No bookings.</p>)}
          {tab === 'matches' && (data.matches.length ? <Table head={['Date', 'Format', 'Type', 'Result']}>{data.matches.map((m: any) => <tr key={m.id}><Td><Link className="font-semibold text-court-700 hover:underline" to={`/app/matches/${m.id}`}>{dateTime(m.startAt)}</Link></Td><Td>{humanize(m.format)}</Td><Td>{humanize(m.category)}</Td><Td>{m.status === 'COMPLETED' ? (m.winnerSide === m.side ? <Badge color="green">Won</Badge> : <Badge color="red">Lost</Badge>) : <Status value={m.status} />}</Td></tr>)}</Table> : <p className="p-5 text-navy-600">No matches.</p>)}
          {tab === 'memberships' && (data.memberships.length ? <Table head={['Plan', 'From', 'Until', 'Price', 'Status']}>{data.memberships.map((m: any) => <tr key={m.id}><Td>{m.planName}</Td><Td>{date(m.startDate)}</Td><Td>{date(m.endDate)}</Td><Td className="num">{peso(m.priceCents)}</Td><Td><Status value={m.status} /></Td></tr>)}</Table> : <p className="p-5 text-navy-600">No memberships.</p>)}
          {tab === 'tournaments' && (data.tournaments.length ? <Table head={['Tournament', 'Starts', 'Status', 'Fee']}>{data.tournaments.map((t: any) => <tr key={t.id}><Td><Link className="font-semibold text-court-700 hover:underline" to={`/app/tournaments/${t.id}`}>{t.name}</Link></Td><Td>{date(t.startDate)}</Td><Td><Status value={t.status} /></Td><Td><Status value={t.paymentStatus} /></Td></tr>)}</Table> : <p className="p-5 text-navy-600">No tournaments.</p>)}
          {tab === 'payments' && (data.payments.length ? <Table head={['Receipt', 'For', 'Method', 'Amount', 'Date']}>{data.payments.map((x: any) => <tr key={x.id}><Td><Link className="font-semibold text-court-700 hover:underline" to={`/app/payments/${x.id}`}>{x.reference}</Link></Td><Td>{humanize(x.purpose)}</Td><Td>{humanize(x.method)}</Td><Td className="num">{peso(x.amountCents)}</Td><Td>{dateTime(x.paidAt)}</Td></tr>)}</Table> : <p className="p-5 text-navy-600">No payments.</p>)}
        </Card>
      </>}
      {edit && <EditPlayer p={p} pr={pr} onClose={() => setEdit(false)} />}
      <Confirm open={susp} onClose={() => setSusp(false)} title={`Suspend ${p.fullName}?`} confirmLabel="Suspend account" danger loading={status.isPending} onConfirm={() => status.mutate('SUSPENDED')}>They’ll be signed out everywhere and can’t book until reactivated.</Confirm>
    </>
  );
}

function EditPlayer({ p, pr, onClose }: { p: any; pr: any; onClose: () => void }) {
  const [f, setF] = useState({ fullName: p.fullName, phone: p.phone ?? '', skillLevel: pr?.skillLevel ?? 'BEGINNER', preferredFormat: pr?.preferredFormat ?? 'DOUBLES' }); const qc = useQueryClient(); const toast = useToast();
  const m = useMutation({ mutationFn: () => api.patch(`/players/${p.id}`, { ...f, phone: f.phone || null }), onSuccess: () => { toast('Player saved'); qc.invalidateQueries(); onClose(); } });
  return (
    <Modal open onClose={onClose} title="Edit player">
      <div className="space-y-3">
        <Field label="Full name"><Input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
        <Field label="Mobile"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Skill level"><Select value={f.skillLevel} onChange={(e) => setF({ ...f, skillLevel: e.target.value })}>{['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'COMPETITIVE'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select></Field>
          <Field label="Preferred format"><Select value={f.preferredFormat} onChange={(e) => setF({ ...f, preferredFormat: e.target.value })}><option value="DOUBLES">Doubles</option><option value="SINGLES">Singles</option></Select></Field>
        </div>
        {m.error && <ErrorBox error={m.error} />}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Save player</Button></div>
      </div>
    </Modal>
  );
}
