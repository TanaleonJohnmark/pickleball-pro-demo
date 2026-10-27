import { Router } from 'express';
import { and, asc, eq, gte, inArray, desc, count } from 'drizzle-orm';
import { db } from '../db/index.js';
import { courts, membershipPlans, tournaments, announcements, tournamentTeams } from '../db/schema.js';
import { ah } from '../lib/http.js';
import { getSettings } from '../services/settings.js';
import { availability } from '../services/booking.js';
import { todayYmd } from '../lib/time.js';

export const r = Router();
r.get('/overview', ah(async (_req, res) => {
  const s = await getSettings();
  const cs = await db.select({ id: courts.id, name: courts.name, indoor: courts.indoor, surface: courts.surface, hourlyPriceCents: courts.hourlyPriceCents, photoUrl: courts.photoUrl, location: courts.location }).from(courts).where(eq(courts.status, 'ACTIVE')).orderBy(asc(courts.name));
  const today = todayYmd();
  const avail = await Promise.all(cs.map(async (c) => { const a = await availability(c.id, today); return { ...c, open: a.open, freeSlots: a.slots.filter((x) => x.available).length, totalSlots: a.slots.length, openTime: (a as any).openTime, closeTime: (a as any).closeTime }; }));
  const plans = await db.select().from(membershipPlans).where(eq(membershipPlans.active, true)).orderBy(asc(membershipPlans.sortOrder));
  const ts = await db.select().from(tournaments).where(and(inArray(tournaments.status, ['OPEN', 'IN_PROGRESS']), gte(tournaments.endDate, new Date()))).orderBy(asc(tournaments.startDate)).limit(4);
  const entries = await db.select({ id: tournamentTeams.tournamentId, n: count() }).from(tournamentTeams).groupBy(tournamentTeams.tournamentId);
  const ann = await db.select({ id: announcements.id, title: announcements.title, body: announcements.body, publishedAt: announcements.publishedAt }).from(announcements).orderBy(desc(announcements.pinned), desc(announcements.publishedAt)).limit(3);
  res.json({ club: { name: s.clubName, email: s.contactEmail, phone: s.contactPhone, address: s.address }, courts: avail, plans, tournaments: ts.map((t) => ({ ...t, entries: entries.find((e) => e.id === t.id)?.n ?? 0 })), announcements: ann, date: today });
}));
