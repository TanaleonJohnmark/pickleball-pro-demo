import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trophy } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, can } from '../lib/auth';
import { peso, date, dateTime, humanize, ymd, localIso, addDaysYmd } from '../lib/format';
import { PageHeader, Card, Button, Loading, ErrorBox, Status, Modal, Field, Input, Select, Textarea, useToast, Table, Td, Empty, Badge, Confirm, cx } from '../components/ui';
import { RecordPayment } from '../components/RecordPayment';

const FORMATS = [['SINGLE_ELIMINATION', 'Single elimination'], ['ROUND_ROBIN', 'Round robin'], ['GROUP_KNOCKOUT', 'Group stage + knockout']];

function TournamentEditor({ t, onClose }: { t?: any; onClose: () => void }) {
  const d0 = addDaysYmd(ymd(), 21);
  const [f, setF] = useState({
    name: t?.name ?? '', description: t?.description ?? '', venue: t?.venue ?? 'Main hall', format: t?.format ?? 'SINGLE_ELIMINATION', category: t?.category ?? 'DOUBLES', skillDivision: t?.skillDivision ?? '',
    fee: t ? t.feeCents / 100 : 0, maxParticipants: t?.maxParticipants ?? 16, groupCount: t?.groupCount ?? 2,
    startDay: t ? ymd(new Date(t.startDate)) : d0, endDay: t ? ymd(new Date(t.endDate)) : d0, deadline: t ? ymd(new Date(t.registrationDeadline)) : addDaysYmd(d0, -3),
  });
  const toast = useToast(); const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => {
      const body = { name: f.name, description: f.description || null, venue: f.venue, format: f.format, category: f.category, skillDivision: f.skillDivision || null, feeCents: Math.round(+f.fee * 100), maxParticipants: +f.maxParticipants, groupCount: +f.groupCount, startDate: localIso(f.startDay, '08:00'), endDate: localIso(f.endDay, '20:00'), registrationDeadline: localIso(f.deadline, '23:59') };
      return t ? api.patch(`/tournaments/${t.id}`, body) : api.post('/tournaments', body);
    },
    onSuccess: () => { toast('Tournament saved'); qc.invalidateQueries(); onClose(); },
  });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open onClose={onClose} title={t ? 'Edit tournament' : 'New tournament'} wide>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name" className="sm:col-span-2"><Input value={f.name} onChange={set('name')} /></Field>
        <Field label="Venue"><Input value={f.venue} onChange={set('venue')} /></Field>
        <Field label="Format"><Select value={f.format} onChange={set('format')}>{FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field label="Category"><Select value={f.category} onChange={set('category')}><option value="DOUBLES">Doubles</option><option value="SINGLES">Singles</option></Select></Field>
        <Field label="Division"><Select value={f.skillDivision} onChange={set('skillDivision')}><option value="">Open to all levels</option>{['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'COMPETITIVE'].map((s) => <option key={s} value={s}>{humanize(s)} only</option>)}</Select></Field>
        <Field label="Starts"><Input type="date" value={f.startDay} onChange={set('startDay')} /></Field>
        <Field label="Ends"><Input type="date" value={f.endDay} onChange={set('endDay')} /></Field>
        <Field label="Registration closes"><Input type="date" value={f.deadline} onChange={set('deadline')} /></Field>
        <Field label="Entry fee per player (₱)"><Input type="number" min={0} step="0.01" value={f.fee} onChange={set('fee')} /></Field>
        <Field label={f.category === 'DOUBLES' ? 'Max teams' : 'Max players'}><Input type="number" min={2} value={f.maxParticipants} onChange={set('maxParticipants')} /></Field>
        {f.format === 'GROUP_KNOCKOUT' && <Field label="Groups"><Input type="number" min={2} max={8} value={f.groupCount} onChange={set('groupCount')} /></Field>}
      </div>
      <Field label="Description" className="mt-3"><Textarea value={f.description} onChange={set('description')} /></Field>
      <p className="mt-2 text-sm text-navy-600">Double elimination isn’t available yet.</p>
      {m.error && <div className="mt-3"><ErrorBox error={m.error} /></div>}
      <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Save tournament</Button></div>
    </Modal>
  );
}

export function TournamentList() {
  const { user } = useAuth(); const admin = can.admin(user); const [open, setOpen] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['tournaments'], queryFn: () => api.get('/tournaments') });
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={refetch} />;
  return (
    <>
      <PageHeader title="Tournaments" actions={admin && <Button onClick={() => setOpen(true)}>New tournament</Button>} />
      {!data.tournaments.length ? <Empty title="No tournaments yet">{admin ? 'Create one and open registration when you’re ready.' : 'Check back soon.'}</Empty> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data.tournaments.map((t: any) => (
          <Link key={t.id} to={`/app/tournaments/${t.id}`} className="block rounded-lg border border-navy-100 bg-white p-5 hover:border-navy-300">
            <div className="flex items-start justify-between gap-2"><h2 className="text-2xl font-bold">{t.name}</h2><Status value={t.status} /></div>
            <p className="mt-1 text-sm text-navy-600">{date(t.startDate)} · {t.venue}</p>
            <p className="mt-2 text-sm">{humanize(t.category)} · {FORMATS.find((x) => x[0] === t.format)?.[1] ?? humanize(t.format)}{t.skillDivision ? ` · ${humanize(t.skillDivision)}` : ''}</p>
            <div className="mt-3 flex items-center justify-between"><span className="num text-sm text-navy-700">{t.entries}/{t.maxParticipants} entries · {t.feeCents ? peso(t.feeCents) : 'Free'}</span>{t.registered && <Badge color="green">You’re in</Badge>}</div>
          </Link>))}
        </div>)}
      {open && <TournamentEditor onClose={() => setOpen(false)} />}
    </>
  );
}

function teamName(teams: any[], id: string | null) { return id ? teams.find((t) => t.id === id)?.name ?? 'TBD' : null; }

function EliminationBracket({ b, teams, champion }: { b: any; teams: any[]; champion: string | null }) {
  const rounds = Math.max(...b.matches.map((m: any) => m.round));
  const label = (r: number) => r === rounds ? 'Final' : r === rounds - 1 ? 'Semifinals' : r === rounds - 2 ? 'Quarterfinals' : `Round ${r}`;
  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-max gap-6">
        {Array.from({ length: rounds }, (_, i) => i + 1).map((r) => (
          <div key={r} className="flex w-60 flex-col">
            <p className="mb-2 font-display text-lg font-semibold text-navy-700">{label(r)}</p>
            <div className="flex flex-1 flex-col justify-around gap-3">
              {b.matches.filter((m: any) => m.round === r).map((m: any) => {
                const line = (slot: 1 | 2) => { const id = slot === 1 ? m.team1Id : m.team2Id; const won = m.winnerTeamId && m.winnerTeamId === id; const g = m.games.map((x: any) => slot === 1 ? x.side1Score : x.side2Score).join(' ');
                  return <div className={cx('flex items-center justify-between px-3 py-1.5 text-sm', won && 'font-bold', id === champion && r === rounds && 'text-gold-500')}><span className="truncate">{teamName(teams, id) ?? (m.isBye ? 'Bye' : 'TBD')}</span><span className="num">{g}</span></div>; };
                const inner = <div className={cx('divide-y divide-navy-100 rounded-md border bg-white', m.status === 'IN_PROGRESS' ? 'border-gold-400' : 'border-navy-100')}>{line(1)}{line(2)}</div>;
                return <div key={m.id}>{m.matchId ? <Link to={`/app/matches/${m.matchId}`} className="block hover:opacity-80">{inner}</Link> : inner}
                  {m.matchId && m.status === 'SCHEDULED' && <p className="mt-0.5 text-xs text-navy-600">{m.courtId ? dateTime(m.startAt) : 'Court and time to be set'}</p>}</div>;
              })}
            </div>
          </div>))}
      </div>
    </div>
  );
}

function RoundRobin({ b, teams }: { b: any; teams: any[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Table head={['#', 'Team', 'P', 'W', 'L', '+/-']}>{(b.standings ?? []).map((s: any, i: number) => <tr key={s.teamId}><Td className="num">{i + 1}</Td><Td className="font-semibold">{teamName(teams, s.teamId)}</Td><Td className="num">{s.played}</Td><Td className="num">{s.wins}</Td><Td className="num">{s.losses}</Td><Td className="num">{s.pointsFor - s.pointsAgainst}</Td></tr>)}</Table>
      <ul className="divide-y divide-navy-100 rounded-md border border-navy-100 text-sm">{b.matches.map((m: any) => (
        <li key={m.id}><Link to={`/app/matches/${m.matchId}`} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-paper">
          <span><span className={m.winnerTeamId === m.team1Id ? 'font-bold' : ''}>{teamName(teams, m.team1Id)}</span> v <span className={m.winnerTeamId === m.team2Id ? 'font-bold' : ''}>{teamName(teams, m.team2Id)}</span></span>
          <span className="num text-navy-600">{m.games.length ? m.games.map((g: any) => `${g.side1Score}-${g.side2Score}`).join(', ') : `Round ${m.round}`}</span>
        </Link></li>))}</ul>
    </div>
  );
}

export function TournamentDetail() {
  const { id } = useParams(); const { user } = useAuth(); const admin = can.admin(user); const staff = can.staff(user); const toast = useToast(); const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['tournament', id], queryFn: () => api.get(`/tournaments/${id}`) });
  const regs = useQuery({ queryKey: ['t-regs', id], queryFn: () => api.get(`/tournaments/${id}/registrations`), enabled: staff });
  const [regOpen, setRegOpen] = useState(false); const [partner, setPartner] = useState(''); const [teamNameIn, setTeamNameIn] = useState('');
  const [edit, setEdit] = useState(false); const [confirm, setConfirm] = useState<string | null>(null); const [pay, setPay] = useState<any>(null); const [withdraw, setWithdraw] = useState(false);
  const refreshAll = () => qc.invalidateQueries();
  const reg = useMutation({ mutationFn: () => api.post(`/tournaments/${id}/register`, { partnerEmail: partner || undefined, teamName: teamNameIn || undefined }), onSuccess: () => { toast('You’re registered'); setRegOpen(false); refreshAll(); } });
  const wd = useMutation({ mutationFn: () => api.del(`/tournaments/${id}/register`), onSuccess: () => { toast('Entry withdrawn'); setWithdraw(false); refreshAll(); }, onError: (e: Error) => toast(e.message, 'err') });
  const st = useMutation({ mutationFn: (action: string) => api.post(`/tournaments/${id}/status`, { action }), onSuccess: () => { toast('Tournament updated'); setConfirm(null); refreshAll(); }, onError: (e: Error) => { toast(e.message, 'err'); setConfirm(null); } });
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={refetch} />;
  const t = data.tournament, teams = data.teams;
  const open = t.status === 'OPEN' && new Date(t.registrationDeadline) > new Date();
  const champ = teamName(teams, t.championTeamId);
  const confirmText: Record<string, [string, string]> = { open: ['Open registration?', 'Players can register until the deadline.'], close: ['Return to draft?', 'Registration closes; existing entries stay.'], start: ['Start the tournament?', 'Entries are seeded by rating and the bracket is created. Registration closes and the format can’t change.'], cancel: ['Cancel the tournament?', 'All scheduled matches are cancelled and players notified. Refund paid fees from the Payments page.'] };
  return (
    <>
      <PageHeader title={t.name} sub={<>{date(t.startDate)}{ymd(new Date(t.startDate)) !== ymd(new Date(t.endDate)) ? ` – ${date(t.endDate)}` : ''} · {t.venue} · <Status value={t.status} /></>} actions={<>
        {admin && ['DRAFT', 'OPEN'].includes(t.status) && <Button variant="secondary" onClick={() => setEdit(true)}>Edit</Button>}
        {admin && t.status === 'DRAFT' && <Button onClick={() => setConfirm('open')}>Open registration</Button>}
        {admin && t.status === 'OPEN' && <Button variant="secondary" onClick={() => setConfirm('close')}>Back to draft</Button>}
        {admin && ['DRAFT', 'OPEN'].includes(t.status) && <Button onClick={() => setConfirm('start')} disabled={teams.length < 2}>Start tournament</Button>}
        {admin && !['COMPLETED', 'CANCELLED'].includes(t.status) && <Button variant="danger" onClick={() => setConfirm('cancel')}>Cancel</Button>}
        {!data.myRegistration && open && user?.role === 'PLAYER' && <Button onClick={() => setRegOpen(true)}>Register</Button>}
        {data.myRegistration && t.status === 'OPEN' && <Button variant="secondary" onClick={() => setWithdraw(true)}>Withdraw</Button>}
      </>} />
      {champ && <div className="mb-6 flex items-center gap-4 rounded-lg bg-navy-900 px-5 py-4 text-white"><Trophy className="h-10 w-10 text-gold-400" /><div><p className="text-sm text-navy-300">Champion</p><p className="font-display text-3xl font-bold text-gold-400">{champ}</p></div></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="About">
          <dl className="grid grid-cols-[120px_1fr] gap-y-1.5 text-sm">
            <dt className="text-navy-600">Format</dt><dd>{FORMATS.find((x) => x[0] === t.format)?.[1] ?? humanize(t.format)}</dd>
            <dt className="text-navy-600">Category</dt><dd>{humanize(t.category)}</dd>
            <dt className="text-navy-600">Division</dt><dd>{t.skillDivision ? humanize(t.skillDivision) : 'All levels'}</dd>
            <dt className="text-navy-600">Entry fee</dt><dd className="num">{t.feeCents ? `${peso(t.feeCents)} per player` : 'Free'}</dd>
            <dt className="text-navy-600">Entries</dt><dd className="num">{teams.length} of {t.maxParticipants}</dd>
            <dt className="text-navy-600">Register by</dt><dd>{dateTime(t.registrationDeadline)}</dd>
          </dl>
          {t.description && <p className="mt-3 text-navy-700">{t.description}</p>}
          {data.myRegistration && <p className="mt-3 rounded-md bg-court-50 px-3 py-2 text-sm text-court-700">You’re registered.{data.myRegistration.paymentStatus === 'UNPAID' ? ' Pay the entry fee at the front desk.' : ''}</p>}
        </Card>
        <Card title={`Entries (${teams.length})`} className="lg:col-span-2" pad={false}>
          {staff && regs.data ? (regs.data.registrations.length ? <Table head={['Team', 'Player', 'Fee', '']}>{regs.data.registrations.map((r: any) => <tr key={r.id}><Td className="font-semibold">{r.teamName}</Td><Td>{r.playerName}<span className="block text-navy-600">{r.email}</span></Td><Td><Status value={r.paymentStatus} /></Td><Td>{r.paymentStatus === 'UNPAID' && t.feeCents > 0 && <Button size="sm" variant="secondary" onClick={() => setPay(r)}>Record fee</Button>}</Td></tr>)}</Table> : <p className="p-5 text-navy-600">No entries yet.</p>)
            : teams.length ? <ul className="grid gap-x-6 px-5 py-3 sm:grid-cols-2">{teams.map((x: any) => <li key={x.id} className="flex justify-between border-b border-navy-100 py-2 text-sm"><span className="font-semibold">{x.name}</span>{x.seed && <span className="num text-navy-600">Seed {x.seed}{x.groupLabel ? ` · Group ${x.groupLabel}` : ''}</span>}</li>)}</ul> : <p className="p-5 text-navy-600">No entries yet.</p>}
        </Card>
      </div>
      {data.brackets.map((b: any) => <Card key={b.id} title={b.name} className="mt-4">{b.kind === 'ELIMINATION' ? <EliminationBracket b={b} teams={teams} champion={t.championTeamId} /> : <RoundRobin b={b} teams={teams} />}</Card>)}
      {t.format === 'GROUP_KNOCKOUT' && t.status === 'IN_PROGRESS' && !data.brackets.some((b: any) => b.stage === 2) && <p className="mt-3 text-sm text-navy-600">The knockout bracket appears automatically when every group match is finished. The top two from each group advance.</p>}
      <Modal open={regOpen} onClose={() => setRegOpen(false)} title={`Register for ${t.name}`}>
        {t.category === 'DOUBLES' && <Field label="Partner’s account email" hint="Your partner needs a club account."><Input type="email" value={partner} onChange={(e) => setPartner(e.target.value)} /></Field>}
        <Field label="Team name (optional)" className="mt-3"><Input value={teamNameIn} onChange={(e) => setTeamNameIn(e.target.value)} /></Field>
        {t.feeCents > 0 && <p className="mt-3 text-sm text-navy-600">Entry fee {peso(t.feeCents)} per player, paid at the front desk.</p>}
        {reg.error && <div className="mt-3"><ErrorBox error={reg.error} /></div>}
        <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={() => setRegOpen(false)}>Cancel</Button><Button loading={reg.isPending} disabled={t.category === 'DOUBLES' && !partner} onClick={() => reg.mutate()}>Register</Button></div>
      </Modal>
      <Confirm open={!!confirm} onClose={() => setConfirm(null)} title={confirm ? confirmText[confirm][0] : ''} confirmLabel={confirm === 'cancel' ? 'Cancel tournament' : 'Continue'} danger={confirm === 'cancel'} loading={st.isPending} onConfirm={() => st.mutate(confirm!)}>{confirm && confirmText[confirm][1]}</Confirm>
      <Confirm open={withdraw} onClose={() => setWithdraw(false)} title="Withdraw your entry?" confirmLabel="Withdraw" danger loading={wd.isPending} onConfirm={() => wd.mutate()}>Your team is removed. Your partner will be notified.</Confirm>
      {edit && <TournamentEditor t={t} onClose={() => setEdit(false)} />}
      {pay && <RecordPayment open onClose={() => setPay(null)} purpose="TOURNAMENT" targetId={pay.id} amountCents={t.feeCents} label={`${t.name} entry · ${pay.playerName}`} onDone={() => regs.refetch()} />}
    </>
  );
}
