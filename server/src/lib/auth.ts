import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { and, eq, gt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { sessions, users } from '../db/schema.js';
import { HttpError, forbidden } from './http.js';

export type Role = 'SUPER_ADMIN' | 'CLUB_ADMIN' | 'STAFF' | 'COACH' | 'PLAYER';
export interface AuthUser { id: string; email: string; fullName: string; role: Role }
declare global { namespace Express { interface Request { user?: AuthUser } } }

export const COOKIE = 'pp_session';
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 7);
const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export const hashPassword = (p: string) => bcrypt.hash(p, 12);
export const verifyPassword = (p: string, h: string) => bcrypt.compare(p, h);

export async function startSession(res: Response, userId: string) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await db.insert(sessions).values({ tokenHash: hashToken(token), userId, expiresAt });
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
    expires: expiresAt, path: '/',
  });
}

export async function endSession(req: Request, res: Response) {
  const token = req.cookies?.[COOKIE];
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  res.clearCookie(COOKIE, { path: '/' });
}

/** Loads the user from the session cookie if present. Never throws. */
export async function loadUser(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[COOKIE];
    if (token) {
      const [row] = await db.select({ id: users.id, email: users.email, fullName: users.fullName, role: users.role, status: users.status })
        .from(sessions).innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())));
      if (row && row.status === 'ACTIVE') req.user = { id: row.id, email: row.email, fullName: row.fullName, role: row.role };
    }
    next();
  } catch (e) { next(e); }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Sign in to continue', 'UNAUTHENTICATED'));
  next();
}

/** Role guard. SUPER_ADMIN always passes. */
export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(new HttpError(401, 'Sign in to continue', 'UNAUTHENTICATED'));
  if (req.user.role === 'SUPER_ADMIN' || roles.includes(req.user.role)) return next();
  next(forbidden());
};

export const ADMIN: Role[] = ['CLUB_ADMIN'];
export const STAFF_UP: Role[] = ['CLUB_ADMIN', 'STAFF'];
export const isStaff = (u?: AuthUser) => !!u && ['SUPER_ADMIN', 'CLUB_ADMIN', 'STAFF'].includes(u.role);
export const isAdmin = (u?: AuthUser) => !!u && ['SUPER_ADMIN', 'CLUB_ADMIN'].includes(u.role);

/**
 * CSRF defence for cookie-authenticated APIs: state-changing requests must carry
 * a custom header (browsers block cross-site custom headers without CORS approval)
 * and, when present, an Origin that matches the configured client origin.
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'PickleballPro') return next(new HttpError(403, 'Request blocked (missing CSRF header)', 'CSRF'));
  const origin = req.get('origin');
  const allowed = (process.env.CLIENT_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (origin && allowed.length && !allowed.includes(origin)) return next(new HttpError(403, 'Request blocked (origin)', 'CSRF'));
  next();
}
