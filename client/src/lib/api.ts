export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: any) { super(message); }
}
async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method, credentials: 'include',
      headers: { 'X-Requested-With': 'PickleballPro', ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Can’t reach the server. Check your connection and try again.', 'NETWORK');
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    const e = data?.error;
    const fieldMsg = e?.details?.fieldErrors ? Object.entries(e.details.fieldErrors).map(([k, v]) => `${k}: ${(v as string[])[0]}`).join('; ') : '';
    const formMsg = e?.details?.formErrors?.[0];
    throw new ApiError(res.status, [e?.message || `Request failed (${res.status})`, formMsg || fieldMsg].filter(Boolean).join(' — '), e?.code, e?.details);
  }
  return data as T;
}
export const api = {
  get: <T = any>(u: string) => request<T>('GET', u),
  post: <T = any>(u: string, b: unknown = {}) => request<T>('POST', u, b),
  patch: <T = any>(u: string, b: unknown) => request<T>('PATCH', u, b),
  put: <T = any>(u: string, b: unknown) => request<T>('PUT', u, b),
  del: <T = any>(u: string) => request<T>('DELETE', u),
};
export const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString(); return s ? `?${s}` : '';
};
