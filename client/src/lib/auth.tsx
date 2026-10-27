import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export type Role = 'SUPER_ADMIN' | 'CLUB_ADMIN' | 'STAFF' | 'COACH' | 'PLAYER';
export interface Me { id: string; email: string; fullName: string; phone: string | null; role: Role; profile: any; membership: any; unread: number; trialEndsAt?: string | null }
interface Ctx { user: Me | null; loading: boolean; refresh: () => Promise<void>; logout: () => Promise<void> }
const AuthCtx = createContext<Ctx>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['me'], queryFn: () => api.get<{ user: Me | null }>('/auth/me'), staleTime: 30_000, refetchInterval: 60_000 });
  const refresh = async () => { await qc.invalidateQueries({ queryKey: ['me'] }); };
  const logout = async () => { await api.post('/auth/logout'); qc.clear(); await qc.invalidateQueries({ queryKey: ['me'] }); };
  return <AuthCtx.Provider value={{ user: data?.user ?? null, loading: isLoading, refresh, logout }}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);
export const can = {
  admin: (u?: Me | null) => !!u && ['SUPER_ADMIN', 'CLUB_ADMIN'].includes(u.role),
  staff: (u?: Me | null) => !!u && ['SUPER_ADMIN', 'CLUB_ADMIN', 'STAFF'].includes(u.role),
  coach: (u?: Me | null) => u?.role === 'COACH',
  superAdmin: (u?: Me | null) => u?.role === 'SUPER_ADMIN',
};
