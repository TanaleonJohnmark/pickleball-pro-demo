import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import { api, qs } from '../lib/api';
import { has } from '../lib/brand';
import { peso, ymd, addDaysYmd, date } from '../lib/format';
import { PageHeader, Card, Button, Loading, ErrorBox, Field, Input, Select, Table, Td, Empty, Pagination, cx } from '../components/ui';

const ALL_TYPES = [['revenue', 'Revenue'], ['reservations', 'Reservations'], ['utilization', 'Court utilization'], ['cancellations', 'Cancellation rate'], ['outstanding', 'Outstanding payments'], ['registrations', 'Player registrations'], ['memberships', 'Membership growth'], ['tournaments', 'Tournament participation'], ['matches', 'Match results']];
const TYPES = ALL_TYPES.filter(([v]) => !(v === 'memberships' && !has('memberships')) && !(v === 'tournaments' && !has('tournaments')) && !(v === 'matches' && !has('matches')));
const noRange = ['outstanding'];

export default function Reports() {
  const [type, setType] = useState('revenue'); const [from, setFrom] = useState(addDaysYmd(ymd(), -30)); const [to, setTo] = useState(ymd()); const [group, setGroup] = useState('day');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null); const [q, setQ] = useState(''); const [page, setPage] = useState(1);
  const params = qs({ from, to, group });
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['report', type, params], queryFn: () => api.get(`/reports/${type}${params}`) });
  let rows: any[] = data?.rows ?? [];
  if (q) rows = rows.filter((r) => Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(q.toLowerCase())));
  if (sort) { const { key, dir } = sort; rows = [...rows].sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * dir); }
  const pageRows = rows.slice((page - 1) * 25, page * 25);
  return (
    <>
      <PageHeader title="Reports" sub="Built from live records. Export to CSV for spreadsheets." actions={<>
        <a href={`/api/reports/${type}${params}&format=csv`} className="no-print"><Button variant="secondary"><Download className="h-4 w-4" />Export CSV</Button></a>
        <Button className="no-print" variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" />Print</Button></>} />
      <div className="no-print mb-4 flex flex-wrap items-end gap-2">
        <Field label="Report"><Select className="w-56" value={type} onChange={(e) => { setType(e.target.value); setSort(null); setPage(1); }}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        {!noRange.includes(type) && <><Field label="From"><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></Field><Field label="To"><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></Field>
          <Field label="Group by"><Select value={group} onChange={(e) => setGroup(e.target.value)}><option value="day">Day</option><option value="month">Month</option></Select></Field></>}
        <Field label="Search"><Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Filter rows" /></Field>
      </div>
      {isLoading ? <Loading /> : error ? <ErrorBox error={error} retry={refetch} /> : (
        <Card title={<>{data.title}{!noRange.includes(type) && <span className="ml-2 font-sans text-sm font-normal text-navy-600">{date(data.from + 'T04:00:00Z')} – {date(data.to + 'T04:00:00Z')}</span>}</>} pad={false}>
          {data.summary && <div className="flex flex-wrap gap-6 border-b border-navy-100 px-5 py-3 text-sm">{Object.entries(data.summary).map(([k, v]: any) => <span key={k}><span className="text-navy-600">{k[0].toUpperCase() + k.slice(1)}: </span><span className="num font-semibold">{['gross', 'refunds', 'net', 'total'].includes(k) && type !== 'registrations' ? peso(v) : v}</span></span>)}</div>}
          {!rows.length ? <div className="p-5"><Empty title="No records in this range">Widen the dates or pick another report.</Empty></div> : <>
            <Table head={data.columns.map((c: any) => <button key={c.key} className="uppercase" onClick={() => setSort({ key: c.key, dir: sort?.key === c.key && sort?.dir === 1 ? -1 : 1 })}>{c.label}{sort?.key === c.key ? (sort?.dir === 1 ? ' ↑' : ' ↓') : ''}</button>)}>
              {pageRows.map((r: any, i: number) => <tr key={i}>{data.columns.map((c: any) => <Td key={c.key} className={cx(c.money && 'num')}>{c.money ? peso(Number(r[c.key] ?? 0)) : String(r[c.key] ?? '—')}</Td>)}</tr>)}
            </Table>
            <Pagination page={page} pageSize={25} total={rows.length} onPage={setPage} /></>}
        </Card>)}
    </>
  );
}
