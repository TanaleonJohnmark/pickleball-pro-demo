import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { notifications, announcements, users } from '../db/schema.js';
import { ah, parse, notFound } from '../lib/http.js';
import { requireAuth, requireRole, ADMIN } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { sql } from 'drizzle-orm';

export const r = Router();
r.use(requireAuth);
r.get('/', ah(async (req, res) => {
  const items = await db.select().from(notifications).where(and(eq(notifications.userId, req.user!.id), req.query.unread === '1' ? isNull(notifications.readAt) : undefined)).orderBy(desc(notifications.createdAt)).limit(100);
  res.json({ items });
}));
r.post('/read-all', ah(async (req, res) => {
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, req.user!.id), isNull(notifications.readAt)));
  res.json({ ok: true });
}));
r.post('/:id/read', ah(async (req, res) => {
  const [n] = await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, req.params.id), eq(notifications.userId, req.user!.id))).returning();
  if (!n) throw notFound('Notification');
  res.json({ ok: true });
}));

export const ann = Router();
ann.get('/', ah(async (_req, res) => {
  const rows = await db.select({ a: announcements, author: users.fullName }).from(announcements).innerJoin(users, eq(users.id, announcements.authorId)).orderBy(desc(announcements.pinned), desc(announcements.publishedAt)).limit(50);
  res.json({ items: rows.map((x) => ({ ...x.a, authorName: x.author })) });
}));
const annSchema = z.object({ title: z.string().trim().min(3).max(120), body: z.string().trim().min(3).max(4000), pinned: z.boolean().default(false), notifyPlayers: z.boolean().default(true) });
ann.post('/', requireRole(...ADMIN), ah(async (req, res) => {
  const b = parse(annSchema, req.body);
  const a = await db.transaction(async (tx) => {
    const [a] = await tx.insert(announcements).values({ title: b.title, body: b.body, pinned: b.pinned, authorId: req.user!.id }).returning();
    if (b.notifyPlayers) await tx.execute(sql`insert into notifications (user_id, type, title, body, link) select id, 'ANNOUNCEMENT', ${b.title}, ${b.body.slice(0, 200)}, '/app/announcements' from users where status = 'ACTIVE'`);
    await audit(req, 'announcement.create', 'announcement', a.id, { title: b.title }, tx);
    return a;
  });
  res.status(201).json({ announcement: a });
}));
ann.patch('/:id', requireRole(...ADMIN), ah(async (req, res) => {
  const b = parse(annSchema.omit({ notifyPlayers: true }).partial(), req.body);
  const [a] = await db.update(announcements).set(b).where(eq(announcements.id, req.params.id)).returning();
  if (!a) throw notFound('Announcement');
  await audit(req, 'announcement.update', 'announcement', a.id, b);
  res.json({ announcement: a });
}));
ann.delete('/:id', requireRole(...ADMIN), ah(async (req, res) => {
  const [a] = await db.delete(announcements).where(eq(announcements.id, req.params.id)).returning();
  if (!a) throw notFound('Announcement');
  await audit(req, 'announcement.delete', 'announcement', a.id, { title: a.title });
  res.json({ ok: true });
}));
