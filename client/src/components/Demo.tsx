import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { UserRound, Store } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, useToast } from './ui';

export const useDemo = () => useQuery({ queryKey: ['demo'], queryFn: () => api.get('/demo/info'), retry: false, staleTime: 300_000 });

export function DemoBanner() {
  const { data } = useDemo();
  if (!data?.demo) return null;
  const mins = Math.max(0, Math.round((new Date(data.nextResetAt).getTime() - Date.now()) / 60000));
  const when = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
  return (
    <div className="no-print flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-gold-400 px-4 py-2 text-center text-sm font-semibold text-navy-900">
      <span>🏓 Live demo of Pickleball Pro. Sample data resets in {when}.</span>
      {data.contactUrl && <a href={data.contactUrl} target="_blank" rel="noreferrer" className="rounded-full bg-navy-900 px-3 py-0.5 text-white hover:bg-navy-800">Get this for your court →</a>}
    </div>
  );
}

export function DemoButtons({ dark }: { dark?: boolean }) {
  const { data } = useDemo(); const { refresh } = useAuth(); const nav = useNavigate(); const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  if (!data?.demo) return null;
  const go = async (as: 'player' | 'owner') => {
    setBusy(as);
    try { await api.post('/demo/login', { as }); await refresh(); nav(as === 'player' ? '/app/book' : '/app'); }
    catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(null); }
  };
  return (
    <div className="flex flex-wrap gap-3">
      <Button className="h-12 px-6 text-base" loading={busy === 'player'} onClick={() => go('player')}><UserRound className="h-5 w-5" />Try as a player</Button>
      <Button variant={dark ? 'secondary' : 'navy'} className="h-12 px-6 text-base" loading={busy === 'owner'} onClick={() => go('owner')}><Store className="h-5 w-5" />Try as the court owner</Button>
    </div>
  );
}
