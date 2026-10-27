import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { Input } from './ui';

/** Staff-only search for a player account. */
export function PlayerPicker({ value, onChange, placeholder = 'Search by name or email' }: { value: { id: string; fullName: string } | null; onChange: (p: { id: string; fullName: string } | null) => void; placeholder?: string }) {
  const [q, setQ] = useState('');
  const { data } = useQuery({ queryKey: ['player-search', q], queryFn: () => api.get(`/players${qs({ q, pageSize: 8 })}`), enabled: q.length >= 2 });
  if (value) return <div className="flex h-10 items-center justify-between rounded-md border border-navy-100 bg-paper px-3"><span className="font-semibold">{value.fullName}</span><button type="button" className="text-sm font-semibold text-court-600" onClick={() => onChange(null)}>Change</button></div>;
  return (
    <div className="relative">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Search players" />
      {q.length >= 2 && data?.items && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-navy-100 bg-white shadow-lg">
          {data.items.length ? data.items.map((p: any) => <li key={p.id}><button type="button" className="w-full px-3 py-2 text-left hover:bg-paper" onClick={() => { onChange({ id: p.id, fullName: p.fullName }); setQ(''); }}>{p.fullName}<span className="ml-2 text-sm text-navy-600">{p.email}</span></button></li>) : <li className="px-3 py-2 text-navy-600">No players found</li>}
        </ul>
      )}
    </div>
  );
}
