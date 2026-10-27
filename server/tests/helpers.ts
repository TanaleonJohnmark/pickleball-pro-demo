import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import * as s from '../src/db/schema.js';
import { hashPassword } from '../src/lib/auth.js';
import { localToUtc, addDays, todayYmd } from '../src/lib/time.js';

export const app = createApp();
const H = { 'X-Requested-With': 'PickleballPro' };
let n = 0;
export async function makeUser(role: typeof s.users.$inferInsert.role = 'PLAYER', skill: typeof s.playerProfiles.$inferInsert.skillLevel = 'INTERMEDIATE') {
  const email = `u${Date.now()}_${n++}@test.dev`;
  const [u] = await db.insert(s.users).values({ email, fullName: `Test ${role} ${n}`, role, passwordHash: await hashPassword('Password123') }).returning();
  await db.insert(s.playerProfiles).values({ userId: u.id, skillLevel: skill });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set(H).send({ email, password: 'Password123' });
  if (res.status !== 200) throw new Error('login failed ' + JSON.stringify(res.body));
  const call = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', url: string, body?: unknown) => (agent as any)[method](url).set(H).send(body);
  return { user: u, agent, get: (u: string) => call('get', u), post: (u: string, b?: unknown) => call('post', u, b), patch: (u: string, b?: unknown) => call('patch', u, b), put: (u: string, b?: unknown) => call('put', u, b), del: (u: string, b?: unknown) => call('delete', u, b) };
}
export const ymd = (days: number) => addDays(new Date(`${todayYmd()}T12:00:00Z`), days).toISOString().slice(0, 10);
export const at = (days: number, hhmm: string) => localToUtc(ymd(days), hhmm).toISOString();
export const allWeek = (open = '06:00', close = '22:00') => [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, openTime: open, closeTime: close }));
export { request, H };
