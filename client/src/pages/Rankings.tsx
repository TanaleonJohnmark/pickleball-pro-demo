import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { useAuth, can } from '../lib/auth';
import { humanize } from '../lib/format';
import { PageHeader, Card, Loading, ErrorBox, Tabs, Select, Table, Td, Empty, cx } from '../components/ui';

export default function Rankings() {
  const { user } = useAuth();
  const [format, setFormat] = useState<'DOUBLES' | 'SINGLES'>('DOUBLES'); const [period, setPeriod] = useState<'all' | 'month' | 'week'>('all'); const [skill, setSkill] = useState('');
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['rankings', format, period, skill], queryFn: () => api.get(`/rankings${qs({ format, period, skill })}`) });
  return (
    <>
      <PageHeader title="Rankings" sub="Elo ratings from officiated competitive matches. Everyone starts at 1000; beating a stronger opponent earns more." />
      <div className="mb-4 flex flex-wrap gap-2">
        <Tabs value={format} onChange={setFormat} items={[{ value: 'DOUBLES', label: 'Doubles' }, { value: 'SINGLES', label: 'Singles' }]} />
        <Tabs value={period} onChange={setPeriod} items={[{ value: 'all', label: 'All time' }, { value: 'month', label: '30 days' }, { value: 'week', label: '7 days' }]} />
        <Select className="w-44" value={skill} onChange={(e) => setSkill(e.target.value)} aria-label="Division"><option value="">All levels</option>{['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'COMPETITIVE'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
      </div>
      <Card pad={false}>
        {isLoading ? <Loading /> : error ? <div className="p-4"><ErrorBox error={error} retry={refetch} /></div> : !data.items.length ? <div className="p-5"><Empty title="No rated matches yet">Rankings appear once competitive results are recorded.</Empty></div> : (
          <Table head={['Rank', 'Player', 'Level', 'Played', 'W', 'L', 'Win rate', period === 'all' ? 'Rating' : 'Points gained']}>
            {data.items.map((r: any) => (
              <tr key={r.userId} className={cx(r.userId === user?.id && 'bg-court-50')}>
                <Td className={cx('num font-display text-xl font-bold', r.rank === 1 && 'text-gold-500')}>{r.rank}</Td>
                <Td><span className="flex items-center gap-2">{r.avatarUrl ? <img src={r.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" /> : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-100 text-xs font-bold text-navy-700">{r.name.split(' ').map((x: string) => x[0]).slice(0, 2).join('')}</span>}
                  {can.staff(user) ? <Link className="font-semibold hover:underline" to={`/app/players/${r.userId}`}>{r.name}</Link> : <span className="font-semibold">{r.name}</span>}</span></Td>
                <Td>{humanize(r.skill)}</Td><Td className="num">{r.played}</Td><Td className="num">{r.wins}</Td><Td className="num">{r.losses}</Td>
                <Td className="num">{Math.round(r.winRate * 100)}%</Td>
                <Td className="num font-semibold">{period === 'all' ? r.rating : (r.points > 0 ? `+${r.points}` : r.points)}</Td>
              </tr>))}
          </Table>)}
      </Card>
    </>
  );
}
