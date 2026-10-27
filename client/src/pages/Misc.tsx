import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pin, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, can } from '../lib/auth';
import { dateTime, humanize } from '../lib/format';
import { PageHeader, Card, Button, Loading, ErrorBox, Field, Input, Select, Textarea, useToast, Empty, Tabs, Confirm, cx, Modal } from '../components/ui';

export function Notifications() {
  const nav = useNavigate(); const { refresh } = useAuth(); const qc = useQueryClient();
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['notifications', tab], queryFn: () => api.get(`/notifications${tab === 'unread' ? '?unread=1' : ''}`) });
  const done = () => { qc.invalidateQueries({ queryKey: ['notifications'] }); refresh(); };
  const all = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: done });
  const open = async (n: any) => { if (!n.readAt) { await api.post(`/notifications/${n.id}/read`); done(); } if (n.link) nav(n.link); };
  return (
    <>
      <PageHeader title="Notifications" actions={<Button variant="secondary" loading={all.isPending} onClick={() => all.mutate()}>Mark all as read</Button>} />
      <div className="mb-4"><Tabs value={tab} onChange={setTab} items={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread' }]} /></div>
      <Card pad={false}>
        {isLoading ? <Loading /> : error ? <div className="p-4"><ErrorBox error={error} retry={refetch} /></div> : !data.items.length ? <div className="p-5"><Empty title={tab === 'unread' ? 'You’re all caught up' : 'No notifications yet'} /></div> : (
          <ul className="divide-y divide-navy-100">{data.items.map((n: any) => (
            <li key={n.id}><button onClick={() => open(n)} className="flex w-full gap-3 px-5 py-3 text-left hover:bg-paper">
              <span className={cx('mt-2 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-cyan-500')} aria-label={n.readAt ? undefined : 'Unread'} />
              <span className="flex-1"><span className={cx('block', !n.readAt && 'font-semibold')}>{n.title}</span><span className="block text-sm text-navy-700">{n.body}</span><span className="text-xs text-navy-600">{dateTime(n.createdAt)}</span></span>
            </button></li>))}</ul>)}
      </Card>
    </>
  );
}

export function Announcements() {
  const { user } = useAuth(); const admin = can.admin(user); const toast = useToast(); const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['announcements'], queryFn: () => api.get('/announcements') });
  const [f, setF] = useState({ title: '', body: '', pinned: false, notifyPlayers: true }); const [open, setOpen] = useState(false); const [del, setDel] = useState<any>(null);
  const create = useMutation({ mutationFn: () => api.post('/announcements', f), onSuccess: () => { toast('Announcement published'); setOpen(false); setF({ title: '', body: '', pinned: false, notifyPlayers: true }); qc.invalidateQueries(); } });
  const pin = useMutation({ mutationFn: (a: any) => api.patch(`/announcements/${a.id}`, { pinned: !a.pinned }), onSuccess: () => qc.invalidateQueries({ queryKey: ['announcements'] }) });
  const remove = useMutation({ mutationFn: () => api.del(`/announcements/${del.id}`), onSuccess: () => { toast('Announcement deleted'); setDel(null); qc.invalidateQueries(); } });
  return (
    <>
      <PageHeader title="Announcements" actions={admin && <Button onClick={() => setOpen(true)}>New announcement</Button>} />
      {isLoading ? <Loading /> : error ? <ErrorBox error={error} /> : !data.items.length ? <Empty title="No announcements" /> : (
        <div className="space-y-3">{data.items.map((a: any) => (
          <Card key={a.id} className={a.pinned ? 'border-l-4 border-l-gold-400' : ''}>
            <div className="flex items-start justify-between gap-3"><div><h2 className="text-2xl font-bold">{a.title}</h2><p className="text-sm text-navy-600">{a.authorName} · {dateTime(a.publishedAt)}{a.pinned ? ' · Pinned' : ''}</p></div>
              {admin && <div className="flex gap-1"><Button size="sm" variant="ghost" aria-label={a.pinned ? 'Unpin' : 'Pin'} onClick={() => pin.mutate(a)}><Pin className="h-4 w-4" /></Button><Button size="sm" variant="ghost" aria-label="Delete" onClick={() => setDel(a)}><Trash2 className="h-4 w-4" /></Button></div>}</div>
            <p className="mt-3 whitespace-pre-line text-navy-800">{a.body}</p>
          </Card>))}</div>)}
      <Modal open={open} onClose={() => setOpen(false)} title="New announcement">
        <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Message" className="mt-3"><Textarea rows={6} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        <div className="mt-3 flex flex-wrap gap-6"><label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-court-600" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} />Pin to top</label><label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-court-600" checked={f.notifyPlayers} onChange={(e) => setF({ ...f, notifyPlayers: e.target.checked })} />Send as an in-app notification</label></div>
        {create.error && <div className="mt-3"><ErrorBox error={create.error} /></div>}
        <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={f.title.length < 3 || f.body.length < 3} loading={create.isPending} onClick={() => create.mutate()}>Publish</Button></div>
      </Modal>
      <Confirm open={!!del} onClose={() => setDel(null)} title="Delete this announcement?" confirmLabel="Delete" danger loading={remove.isPending} onConfirm={() => remove.mutate()}>{del?.title}</Confirm>
    </>
  );
}

export function Profile() {
  const { user, refresh } = useAuth(); const toast = useToast();
  const [f, setF] = useState({ fullName: user!.fullName, phone: user!.phone ?? '', skillLevel: user!.profile?.skillLevel ?? 'BEGINNER', preferredFormat: user!.profile?.preferredFormat ?? 'DOUBLES', avatarUrl: user!.profile?.avatarUrl ?? '', bio: user!.profile?.bio ?? '' });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const save = useMutation({ mutationFn: () => api.patch('/auth/me', { ...f, phone: f.phone || null }), onSuccess: () => { toast('Profile saved'); refresh(); } });
  const change = useMutation({ mutationFn: () => api.post('/auth/password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword }), onSuccess: () => { toast('Password changed. Other devices were signed out.'); setPw({ currentPassword: '', newPassword: '', confirm: '' }); } });
  return (
    <>
      <PageHeader title="Profile" sub={user!.email} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Your details">
          <div className="space-y-3">
            <Field label="Full name"><Input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
            <Field label="Mobile"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Skill level"><Select value={f.skillLevel} onChange={(e) => setF({ ...f, skillLevel: e.target.value })}>{['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'COMPETITIVE'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select></Field>
              <Field label="Usually play"><Select value={f.preferredFormat} onChange={(e) => setF({ ...f, preferredFormat: e.target.value })}><option value="DOUBLES">Doubles</option><option value="SINGLES">Singles</option></Select></Field>
            </div>
            <Field label="Profile picture URL" hint="A link to an image (https://…)"><Input value={f.avatarUrl} onChange={(e) => setF({ ...f, avatarUrl: e.target.value })} /></Field>
            <Field label="About you"><Textarea value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} /></Field>
            {save.error && <ErrorBox error={save.error} />}
            <Button loading={save.isPending} onClick={() => save.mutate()}>Save profile</Button>
          </div>
        </Card>
        <Card title="Change password">
          <div className="space-y-3">
            <Field label="Current password"><Input type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
            <Field label="New password" hint="8+ characters with a letter and a number"><Input type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
            <Field label="Confirm new password" error={pw.confirm && pw.confirm !== pw.newPassword ? 'Passwords don’t match' : undefined}><Input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
            {change.error && <ErrorBox error={change.error} />}
            <Button variant="navy" disabled={!pw.currentPassword || pw.newPassword.length < 8 || pw.confirm !== pw.newPassword} loading={change.isPending} onClick={() => change.mutate()}>Change password</Button>
          </div>
        </Card>
      </div>
    </>
  );
}
