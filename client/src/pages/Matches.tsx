import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Undo2 } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAuth, can } from '../lib/auth';
import { dateTime, humanize, ymd, localIso, localHHMM } from '../lib/format';
import { PageHeader, Card, Button, Loading, ErrorBox, Status, Modal, Field, Input, Select, useToast, Table, Td, Empty, Pagination, Tabs, Badge, Confirm, Textarea, cx } from '../components/ui';
import { PlayerPicker } from '../components/PlayerPicker';

const sideNames = (m: any, s: number) => m.participants.filter((p: any) => p.side === s).map((p: any) => p.user.fullName).join(' & ');
const scoreLine = (m: any) => [...(m.games ?? [])].sort((a: any, b: any) => a.gameNumber - b.gameNumber).map((g: any) => `${g.side1Score}-${g.side2Score}`).join(', ');

function NewMatch({ onClose }: { onClose: () => void }) {
  const { user } = useAuth(); const staff = can.staff(user); const toast = useToast(); const qc = useQueryClient();
  const courts = useQuery({ queryKey: ['courts'], queryFn: () => api.get('/courts') });
  const me = { id: user!.id, fullName: user!.fullName };
  const [f, setF] = useState({ format: 'DOUBLES', category: 'FRIENDLY', courtId: '', day: ymd(), hhmm: '18:00', duration: 60, scoring: 'SIDE_OUT', targetScore: 11, winBy: 2, bestOf: 1 });
  const [p, setP] = useState<(any | null)[]>([staff ? null : me, null, null, null]);
  const n = f.format === 'SINGLES' ? 1 : 2;
  const side1 = p.slice(0, n), side2 = p.slice(2, 2 + n);
  const m = useMutation({ mutationFn: () => api.post('/matches', { format: f.format, category: f.category, courtId: f.courtId || null, startAt: localIso(f.day, f.hhmm), durationMinutes: f.duration, scoring: f.scoring, targetScore: f.targetScore, winBy: f.winBy, bestOf: f.bestOf, side1: side1.map((x) => x?.id), side2: side2.map((x) => x?.id) }), onSuccess: () => { toast('Match scheduled'); qc.invalidateQueries({ queryKey: ['matches'] }); onClose(); } });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: ['targetScore', 'winBy', 'bestOf', 'duration'].includes(k) ? +e.target.value : e.target.value });
  return (
    <Modal open onClose={onClose} title="Schedule a match" wide>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Format"><Select value={f.format} onChange={set('format')}><option value="DOUBLES">Doubles</option><option value="SINGLES">Singles</option></Select></Field>
        <Field label="Type" hint={staff ? 'Competitive results change ratings' : 'Players can schedule friendly matches'}><Select value={f.category} onChange={set('category')} disabled={!staff}><option value="FRIENDLY">Friendly</option><option value="COMPETITIVE">Competitive</option></Select></Field>
        <Field label="Court (optional)" hint="If you booked the court, pick it here"><Select value={f.courtId} onChange={set('courtId')}><option value="">No court yet</option>{courts.data?.courts.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Date"><Input type="date" value={f.day} onChange={set('day')} /></Field>
        <Field label="Start"><Input type="time" value={f.hhmm} onChange={set('hhmm')} /></Field>
        <Field label="Length (min)"><Input type="number" step={15} value={f.duration} onChange={set('duration')} /></Field>
        <Field label="Scoring"><Select value={f.scoring} onChange={set('scoring')}><option value="SIDE_OUT">Side-out (traditional)</option><option value="RALLY">Rally</option></Select></Field>
        <Field label="Game to"><Select value={f.targetScore} onChange={set('targetScore')}>{[11, 15, 21].map((x) => <option key={x}>{x}</option>)}</Select></Field>
        <Field label="Win by / best of"><div className="flex gap-2"><Select value={f.winBy} onChange={set('winBy')}><option value={2}>Win by 2</option><option value={1}>Win by 1</option></Select><Select value={f.bestOf} onChange={set('bestOf')}><option value={1}>1 game</option><option value={3}>Best of 3</option><option value={5}>Best of 5</option></Select></div></Field>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {[0, 1].map((side) => <fieldset key={side} className="rounded-md border border-navy-100 p-3"><legend className="px-1 text-sm font-semibold">Side {side + 1}</legend><div className="space-y-2">
          {Array.from({ length: n }, (_, i) => side * 2 + i).map((idx) => <PlayerPicker key={idx} value={p[idx]} onChange={(v) => setP(p.map((x, j) => (j === idx ? v : x)))} placeholder="Search player" />)}
        </div></fieldset>)}
      </div>
      {!staff && <p className="mt-2 text-sm text-navy-600">Player search is available to staff. Ask the front desk to add opponents, or schedule from a staff account.</p>}
      {m.error && <div className="mt-3"><ErrorBox error={m.error} /></div>}
      <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={[...side1, ...side2].some((x) => !x)} onClick={() => m.mutate()}>Schedule match</Button></div>
    </Modal>
  );
}

export function MatchList() {
  const { user } = useAuth(); const staff = can.staff(user);
  const [tab, setTab] = useState<'upcoming' | 'results' | 'mine'>(staff ? 'upcoming' : 'mine'); const [page, setPage] = useState(1); const [open, setOpen] = useState(false);
  const status = tab === 'results' ? 'COMPLETED' : tab === 'upcoming' ? 'SCHEDULED,IN_PROGRESS' : '';
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['matches', tab, page], queryFn: () => api.get(`/matches${qs({ status, mine: tab === 'mine' ? 1 : undefined, page })}`) });
  return (
    <>
      <PageHeader title="Matches" actions={<Button onClick={() => setOpen(true)}>Schedule match</Button>} />
      <div className="mb-4"><Tabs value={tab} onChange={(v) => { setTab(v); setPage(1); }} items={[...(staff ? [{ value: 'upcoming' as const, label: 'Upcoming & live' }] : []), { value: 'mine', label: 'My matches' }, { value: 'results', label: 'Results' }]} /></div>
      <Card pad={false}>
        {isLoading ? <Loading /> : error ? <div className="p-4"><ErrorBox error={error} retry={refetch} /></div> : !data.items.length ? <div className="p-5"><Empty title="No matches here" /></div> : <>
          <Table head={['When', 'Format', 'Side 1', 'Side 2', 'Score', 'Status']}>
            {data.items.map((m: any) => <tr key={m.id} className="hover:bg-paper">
              <Td><Link className="font-semibold text-court-700 hover:underline" to={`/app/matches/${m.id}`}>{dateTime(m.startAt)}</Link>{m.court && <span className="block text-navy-600">{m.court.name}</span>}</Td>
              <Td>{humanize(m.format)}<span className="block text-navy-600">{humanize(m.category)}</span></Td>
              <Td className={m.winnerSide === 1 ? 'font-semibold' : ''}>{sideNames(m, 1)}</Td><Td className={m.winnerSide === 2 ? 'font-semibold' : ''}>{sideNames(m, 2)}</Td>
              <Td className="num">{scoreLine(m) || '—'}</Td><Td><Status value={m.status} /></Td>
            </tr>)}
          </Table>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /></>}
      </Card>
      {open && <NewMatch onClose={() => setOpen(false)} />}
    </>
  );
}

/** The scoreboard — the one loud element in the app. */
function Scoreboard({ m, state, call }: { m: any; state: any; call: string | null }) {
  const games = state?.games ?? (m.games ?? []).map((g: any) => ({ s1: g.side1Score, s2: g.side2Score, winner: g.winnerSide }));
  const cur = games[games.length - 1] ?? { s1: 0, s2: 0 };
  const won = (s: number) => games.filter((g: any) => g.winner === s).length;
  return (
    <div className="overflow-hidden rounded-xl bg-navy-900 text-white">
      {[1, 2].map((s) => (
        <div key={s} className={cx('flex items-center gap-4 px-5 py-4', s === 1 && 'border-b border-navy-700')}>
          <span className={cx('h-3 w-3 rounded-full', state && !state.completed && state.servingSide === s ? 'bg-gold-400' : 'bg-transparent')} aria-label={state?.servingSide === s ? 'serving' : undefined} />
          <span className={cx('flex-1 truncate font-display text-2xl font-semibold sm:text-3xl', m.winnerSide === s && 'text-gold-400')}>{sideNames(m, s)}</span>
          {m.bestOf > 1 && <span className="num font-display text-xl text-navy-300">{won(s)}</span>}
          <span className="num w-20 text-right font-display text-6xl font-extrabold leading-none">{s === 1 ? cur.s1 : cur.s2}</span>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-navy-800 px-5 py-2 text-sm text-navy-300">
        <span>{humanize(m.scoring)} scoring · to {m.targetScore}, win by {m.winBy}{m.bestOf > 1 ? ` · best of ${m.bestOf} · game ${games.length}` : ''}</span>
        {call && m.status === 'IN_PROGRESS' && <span className="num font-display text-xl font-bold tracking-wider text-cyan-400">Call: {call}</span>}
      </div>
    </div>
  );
}

export function MatchDetail() {
  const { id } = useParams(); const { user } = useAuth(); const staff = can.staff(user); const toast = useToast(); const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['match', id], queryFn: () => api.get(`/matches/${id}`), refetchInterval: (q) => (q.state.data?.match.status === 'IN_PROGRESS' ? 4000 : false) });
  const [live, setLive] = useState<{ state: any; call: string } | null>(null);
  const [resultOpen, setResultOpen] = useState<null | 'result' | 'correct'>(null); const [schedOpen, setSchedOpen] = useState(false); const [cancelOpen, setCancelOpen] = useState(false); const [first, setFirst] = useState(1);
  const done = () => { qc.invalidateQueries({ queryKey: ['match', id] }); };
  const start = useMutation({ mutationFn: () => api.post(`/matches/${id}/start`, { firstServingSide: first }), onSuccess: done, onError: (e: Error) => toast(e.message, 'err') });
  const rally = useMutation({ mutationFn: (winner: number) => api.post(`/matches/${id}/rally`, { winner }), onSuccess: (r) => { setLive(r); if (r.state.completed) toast('Match complete'); done(); }, onError: (e: Error) => toast(e.message, 'err') });
  const undo = useMutation({ mutationFn: () => api.post(`/matches/${id}/undo`), onSuccess: (r) => { setLive(r); done(); }, onError: (e: Error) => toast(e.message, 'err') });
  const cancel = useMutation({ mutationFn: () => api.post(`/matches/${id}/cancel`), onSuccess: () => { toast('Match cancelled'); setCancelOpen(false); done(); } });
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={refetch} />;
  const m = data.match; const state = live?.state ?? m.liveState; const call = live?.call ?? data.call;
  return (
    <>
      <PageHeader title={`${humanize(m.format)} match`} sub={<>{dateTime(m.startAt)}{m.court ? ` · ${m.court.name}` : ''} · {humanize(m.category)} · <Status value={m.status} />{data.tournamentId && <> · <Link className="font-semibold text-court-600 underline" to={`/app/tournaments/${data.tournamentId}`}>Tournament</Link></>}</>} actions={<>
        {staff && m.status === 'SCHEDULED' && <Button variant="secondary" onClick={() => setSchedOpen(true)}>Set court & time</Button>}
        {data.canScore && m.status !== 'COMPLETED' && m.status !== 'CANCELLED' && <Button variant="secondary" onClick={() => setResultOpen('result')}>Enter final score</Button>}
        {data.canCorrect && m.status === 'COMPLETED' && <Button variant="secondary" onClick={() => setResultOpen('correct')}>Correct score</Button>}
        {m.status === 'SCHEDULED' && !data.tournamentId && (staff || m.category === 'FRIENDLY') && <Button variant="danger" onClick={() => setCancelOpen(true)}>Cancel match</Button>}
      </>} />
      <Scoreboard m={m} state={state} call={call} />
      {m.bestOf > 1 && m.games.length > 0 && <p className="num mt-2 text-sm text-navy-600">Games: {scoreLine(m)}</p>}
      {data.canScore && m.status === 'SCHEDULED' && (
        <Card className="mt-4" title="Score this match live">
          <div className="flex flex-wrap items-end gap-3"><Field label="First serve"><Select value={first} onChange={(e) => setFirst(+e.target.value)}><option value={1}>Side 1 — {sideNames(m, 1)}</option><option value={2}>Side 2 — {sideNames(m, 2)}</option></Select></Field><Button loading={start.isPending} onClick={() => start.mutate()}>Start match</Button></div>
        </Card>
      )}
      {data.canScore && m.status === 'IN_PROGRESS' && (
        <div className="mt-4">
          <p className="mb-2 text-sm text-navy-600">Tap the side that won the rally. The server, side-outs and game ends are handled for you.</p>
          <div className="grid grid-cols-2 gap-3">
            {[1, 2].map((s) => <button key={s} disabled={rally.isPending} onClick={() => rally.mutate(s)} className="rounded-xl border-2 border-court-600 bg-white px-4 py-6 text-center hover:bg-court-50 disabled:opacity-60"><span className="block font-display text-2xl font-bold text-court-700">Side {s} won the rally</span><span className="text-sm text-navy-600">{sideNames(m, s)}</span></button>)}
          </div>
          <Button variant="ghost" className="mt-3" loading={undo.isPending} onClick={() => undo.mutate()}><Undo2 className="h-4 w-4" />Undo last rally</Button>
        </div>
      )}
      <Card title="Score history" className="mt-6" pad={false}>
        {data.history.length ? <ul className="divide-y divide-navy-100 text-sm">{data.history.map((h: any) => <li key={h.id} className="flex justify-between gap-3 px-5 py-2"><span>{humanize(h.action)}{h.reason && <span className="text-navy-600"> — {h.reason}</span>}</span><span className="text-navy-600">{h.actorName} · {dateTime(h.createdAt)}</span></li>)}</ul> : <p className="p-5 text-navy-600">No score updates yet.</p>}
      </Card>
      {resultOpen && <ResultModal m={m} mode={resultOpen} onClose={() => setResultOpen(null)} />}
      {schedOpen && <ScheduleModal m={m} onClose={() => setSchedOpen(false)} />}
      <Confirm open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel this match?" confirmLabel="Cancel match" danger loading={cancel.isPending} onConfirm={() => cancel.mutate()}>All players will be notified.</Confirm>
    </>
  );
}

function ResultModal({ m, mode, onClose }: { m: any; mode: 'result' | 'correct'; onClose: () => void }) {
  const init = mode === 'correct' ? [...m.games].sort((a: any, b: any) => a.gameNumber - b.gameNumber).map((g: any) => ({ s1: g.side1Score, s2: g.side2Score })) : [{ s1: 0, s2: 0 }];
  const [games, setGames] = useState(init); const [reason, setReason] = useState(''); const toast = useToast(); const qc = useQueryClient();
  const x = useMutation({ mutationFn: () => api.post(`/matches/${m.id}/${mode}`, { games, ...(mode === 'correct' && { reason }) }), onSuccess: () => { toast(mode === 'correct' ? 'Score corrected' : 'Result saved'); qc.invalidateQueries(); onClose(); } });
  return (
    <Modal open onClose={onClose} title={mode === 'correct' ? 'Correct the score' : 'Enter final score'}>
      <p className="mb-3 text-sm text-navy-600">Games to {m.targetScore}, win by {m.winBy}{m.bestOf > 1 ? `, best of ${m.bestOf}` : ''}. Impossible scores are rejected.</p>
      <div className="space-y-2">{games.map((g, i) => <div key={i} className="grid grid-cols-[70px_1fr_1fr] items-center gap-2"><span className="text-sm font-semibold">Game {i + 1}</span>
        <Input type="number" min={0} aria-label={`Game ${i + 1} side 1`} value={g.s1} onChange={(e) => setGames(games.map((y, j) => j === i ? { ...y, s1: +e.target.value } : y))} />
        <Input type="number" min={0} aria-label={`Game ${i + 1} side 2`} value={g.s2} onChange={(e) => setGames(games.map((y, j) => j === i ? { ...y, s2: +e.target.value } : y))} />
      </div>)}</div>
      <div className="mt-1 grid grid-cols-[70px_1fr_1fr] gap-2 text-xs text-navy-600"><span /><span>{sideNames(m, 1)}</span><span>{sideNames(m, 2)}</span></div>
      {m.bestOf > 1 && <div className="mt-2 flex gap-2">{games.length < m.bestOf && <Button size="sm" variant="secondary" onClick={() => setGames([...games, { s1: 0, s2: 0 }])}>Add game</Button>}{games.length > 1 && <Button size="sm" variant="ghost" onClick={() => setGames(games.slice(0, -1))}>Remove last</Button>}</div>}
      {mode === 'correct' && <Field label="Reason (kept in the audit log)" className="mt-3"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
      {x.error && <div className="mt-3"><ErrorBox error={x.error} /></div>}
      <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={x.isPending} disabled={mode === 'correct' && reason.trim().length < 5} onClick={() => x.mutate()}>{mode === 'correct' ? 'Save correction' : 'Save result'}</Button></div>
    </Modal>
  );
}

function ScheduleModal({ m, onClose }: { m: any; onClose: () => void }) {
  const courts = useQuery({ queryKey: ['courts'], queryFn: () => api.get('/courts') });
  const [courtId, setCourtId] = useState(m.courtId ?? ''); const [day, setDay] = useState(ymd(new Date(m.startAt))); const [hhmm, setHhmm] = useState(localHHMM(m.startAt));
  const [dur, setDur] = useState((new Date(m.endAt).getTime() - new Date(m.startAt).getTime()) / 60000); const toast = useToast(); const qc = useQueryClient();
  const x = useMutation({ mutationFn: () => api.post(`/matches/${m.id}/schedule`, { courtId: courtId || null, startAt: localIso(day, hhmm), durationMinutes: dur }), onSuccess: () => { toast('Match scheduled'); qc.invalidateQueries(); onClose(); } });
  return (
    <Modal open onClose={onClose} title="Set court and time">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Court"><Select value={courtId} onChange={(e) => setCourtId(e.target.value)}><option value="">No court</option>{courts.data?.courts.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Date"><Input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
        <Field label="Start"><Input type="time" value={hhmm} onChange={(e) => setHhmm(e.target.value)} /></Field>
        <Field label="Length (min)"><Input type="number" step={15} value={dur} onChange={(e) => setDur(+e.target.value)} /></Field>
      </div>
      {x.error && <div className="mt-3"><ErrorBox error={x.error} /></div>}
      <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={x.isPending} onClick={() => x.mutate()}>Save</Button></div>
    </Modal>
  );
}
void Badge;
