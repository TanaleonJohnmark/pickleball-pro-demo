import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodError, type ZodTypeAny, type output } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'ERROR', public details?: unknown) { super(message); }
}
export const badRequest = (m: string, details?: unknown) => new HttpError(400, m, 'BAD_REQUEST', details);
export const notFound = (what = 'Record') => new HttpError(404, `${what} not found`, 'NOT_FOUND');
export const forbidden = (m = 'You do not have permission to do this') => new HttpError(403, m, 'FORBIDDEN');
export const conflict = (m: string) => new HttpError(409, m, 'CONFLICT');

export const ah = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res, next).catch(next); };

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): output<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(422, 'Some fields are invalid', 'VALIDATION', r.error.flatten());
  return r.data;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  if (err instanceof ZodError) return res.status(422).json({ error: { code: 'VALIDATION', message: 'Some fields are invalid', details: err.flatten() } });
  const pg = err as { code?: string; constraint?: string };
  if (pg?.code === '23P01') return res.status(409).json({ error: { code: 'CONFLICT', message: 'That time overlaps an existing booking on this court.' } });
  if (pg?.code === '23505') return res.status(409).json({ error: { code: 'DUPLICATE', message: 'A record with these details already exists.' } });
  if (pg?.code === '23514') return res.status(422).json({ error: { code: 'VALIDATION', message: `Value rejected by rule ${pg.constraint}` } });
  console.error(err);
  res.status(500).json({ error: { code: 'SERVER', message: 'Something went wrong on the server. Try again.' } });
}

/** Pagination helper: ?page=1&pageSize=20 */
export function paging(q: Record<string, unknown>) {
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
