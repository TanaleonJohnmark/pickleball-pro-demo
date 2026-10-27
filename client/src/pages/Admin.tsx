import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { useAuth, can } from '../lib/auth';
import { dateTime, humanize } from '../lib/format';
import { PageHeader, Card, Button, Loading, ErrorBox, Field, Input, Select, useToast, Table, Td, Pagination, Status, Modal, Empty } from '../components/ui';

export function StaffUsers() {
  const { user } = useAuth(); const toast = useToast(); const qc = useQueryClient();
  const [page, setPage] = useState(1); const [q, setQ] = useState(''); const [open, setOpen] = useState(false);
  const [f, setF] = useState({ fullName: '', email: '', role: 'STAFF', password: '' });
  const { data, isLoading, error } = useQuery({ queryKey: ['staff', page, q], queryFn: () => api.get(`/admin/users${qs({ page, q })}`) });
  const create = useMutation({ mutationFn: () => api.post('/admin/users', f), onSuccess: () => { toast('Account created'); setOpen(false); qc.invalidateQueries({ queryKey: ['staff'] }); } });
  const role = useMutation({ mutationFn: (v: { id: string; role: string }) => api.post(`/admin/users/${v.id}/role`, { role: v.role }), onSuccess: () => { toast('Role changed; they’ll need to sign in again'); qc.invalidateQueries({ queryKey: ['staff'] }); }, onError: (e: Error) => toast(e.message, 'err') });
  return (
    <>
      <PageHeader title="Staff accounts" sub="Administrators, front-desk staff and coaches." actions={<Button onClick={() => setOpen(true)}>Add account</Button>} />
      <Input className="mb-4 max-w-xs" placeholder="Search by name" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      <Card pad={false}>
        {isLoading ? <Loading /> : error ? <div className="p-4"><ErrorBox error={error} /></div> : !data.items.length ? <div className="p-5"><Empty title="No accounts found" /></div> : <>
          <Table head={['Name', 'Email', 'Role', 'Status', 'Since']}>
            {data.items.map((u: any) => <tr key={u.id}><Td className="font-semibold">{u.fullName}</Td><Td>{u.email}</Td>
              <Td>{u.id === user!.id ? humanize(u.role) : <Select className="w-40" value={u.role} onChange={(e) => role.mutate({ id: u.id, role: e.target.value })} aria-label={`Role for ${u.fullName}`}>{['SUPER_ADMIN', 'CLUB_ADMIN', 'STAFF', 'COACH', 'PLAYER'].map((r) => <option key={r} value={r}>{humanize(r)}</option>)}</Select>}</Td>
              <Td><Status value={u.status} /></Td><Td>{dateTime(u.createdAt)}</Td></tr>)}
          </Table>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /></>}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="Add a staff account">
        <div className="space-y-3">
          <Field label="Full name"><Input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Role"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="STAFF">Staff</option><option value="CLUB_ADMIN">Club admin</option><option value="SUPER_ADMIN">Super admin</option></Select></Field>
          <Field label="Initial password" hint="8+ characters with a letter and a number. Share it securely."><Input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          <p className="text-sm text-navy-600">To add a coach, use Coaching → Add coach on an existing account.</p>
          {create.error && <ErrorBox error={create.error} />}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={create.isPending} onClick={() => create.mutate()}>Create account</Button></div>
        </div>
      </Modal>
    </>
  );
}

export function AuditLog() {
  const [page, setPage] = useState(1); const [entity, setEntity] = useState(''); const [action, setAction] = useState(''); const [open, setOpen] = useState<any>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ['audit', page, entity, action], queryFn: () => api.get(`/admin/audit${qs({ page, entity, action, pageSize: 50 })}`) });
  return (
    <>
      <PageHeader title="Audit log" sub="Every sensitive change, who made it and when." />
      <div className="mb-4 flex flex-wrap gap-2">
        <Select className="w-48" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }} aria-label="Record type"><option value="">All records</option>{['reservation', 'payment', 'match', 'tournament', 'court', 'membership', 'membership_plan', 'user', 'coaching_session', 'announcement', 'settings'].map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</Select>
        <Input className="max-w-xs" placeholder="Action contains…" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} />
      </div>
      <Card pad={false}>
        {isLoading ? <Loading /> : error ? <div className="p-4"><ErrorBox error={error} /></div> : !data.items.length ? <div className="p-5"><Empty title="No entries" /></div> : <>
          <Table head={['When', 'Who', 'Action', 'Record', '']}>
            {data.items.map((a: any) => <tr key={a.id}><Td>{dateTime(a.createdAt)}</Td><Td>{a.actorName ?? 'System'}</Td><Td className="font-mono text-xs">{a.action}</Td><Td>{humanize(a.entity)}</Td><Td>{a.details && <Button size="sm" variant="ghost" onClick={() => setOpen(a)}>Details</Button>}</Td></tr>)}
          </Table>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /></>}
      </Card>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.action ?? ''}><pre className="max-h-96 overflow-auto rounded bg-paper p-3 text-xs">{JSON.stringify(open?.details, null, 2)}</pre><p className="mt-2 text-xs text-navy-600">IP {open?.ip ?? '—'} · record {open?.entityId ?? '—'}</p></Modal>
    </>
  );
}

export function SettingsPage() {
  const { user } = useAuth(); const editable = can.superAdmin(user); const toast = useToast(); const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['settings'], queryFn: () => api.get('/admin/settings') });
  const [f, setF] = useState<any>(null);
  useEffect(() => { if (data) setF(data.settings); }, [data]);
  const save = useMutation({ mutationFn: () => api.put('/admin/settings', { ...f, cancellationHours: +f.cancellationHours, defaultAdvanceBookingDays: +f.defaultAdvanceBookingDays, defaultMaxActiveBookings: +f.defaultMaxActiveBookings, reminderHours: +f.reminderHours }), onSuccess: () => { toast('Settings saved'); qc.invalidateQueries(); } });
  if (isLoading || !f) return error ? <ErrorBox error={error} /> : <Loading />;
  const inp = (k: string, type = 'text') => <Input type={type} disabled={!editable} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />;
  return (
    <>
      <PageHeader title="Settings" sub={editable ? undefined : 'Only a super admin can change these.'} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Club details"><div className="space-y-3"><Field label="Club name">{inp('clubName')}</Field><Field label="Address">{inp('address')}</Field><Field label="Phone">{inp('contactPhone')}</Field><Field label="Email">{inp('contactEmail', 'email')}</Field></div></Card>
        <Card title="Booking rules"><div className="space-y-3">
          <Field label="Players can cancel up to (hours before start)">{inp('cancellationHours', 'number')}</Field>
          <Field label="Non-members can book up to (days ahead)" hint="Members use their plan’s limit">{inp('defaultAdvanceBookingDays', 'number')}</Field>
          <Field label="Non-members’ max upcoming bookings">{inp('defaultMaxActiveBookings', 'number')}</Field>
          <Field label="Send booking reminders (hours before)">{inp('reminderHours', 'number')}</Field>
        </div></Card>
      </div>
      {save.error && <div className="mt-4"><ErrorBox error={save.error} /></div>}
      {editable && <Button className="mt-4" loading={save.isPending} onClick={() => save.mutate()}>Save settings</Button>}
    </>
  );
}
