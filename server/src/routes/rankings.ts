import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { rankings, ratingHistory, users, playerProfiles } from '../db/schema.js';
import { ah, parse } from '../lib/http.js';

export const r = Router();
r.get('/', ah(async (req, res) => {
  const q = parse(z.object({ format: z.enum(['SINGLES', 'DOUBLES']).default('DOUBLES'), period: z.enum(['all', 'month', 'week']).default('all'), skill: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'COMPETITIVE']).optional() }), req.query);
  const skillW = q.skill ? eq(playerProfiles.skillLevel, q.skill) : undefined;
  if (q.period === 'all') {
    const rows = await db.select({ userId: users.id, name: users.fullName, avatarUrl: playerProfiles.avatarUrl, skill: playerProfiles.skillLevel, rating: rankings.rating, wins: rankings.wins, losses: rankings.losses })
      .from(rankings).innerJoin(users, eq(users.id, rankings.userId)).leftJoin(playerProfiles, eq(playerProfiles.userId, users.id))
      .where(and(eq(rankings.format, q.format), eq(users.status, 'ACTIVE'), sql`${rankings.wins} + ${rankings.losses} > 0`, skillW))
      .orderBy(desc(rankings.rating), desc(rankings.wins)).limit(100);
    return res.json({ basis: 'rating', items: rows.map((x, i) => ({ ...x, rank: i + 1, played: x.wins + x.losses, winRate: x.wins + x.losses ? x.wins / (x.wins + x.losses) : 0, points: x.rating })) });
  }
  const since = new Date(Date.now() - (q.period === 'week' ? 7 : 30) * 86400000);
  const rows = await db.select({
    userId: users.id, name: users.fullName, avatarUrl: playerProfiles.avatarUrl, skill: playerProfiles.skillLevel,
    points: sql<number>`sum(${ratingHistory.delta})::int`, wins: sql<number>`count(*) filter (where ${ratingHistory.won})::int`, played: sql<number>`count(*)::int`,
    rating: sql<number>`(array_agg(${ratingHistory.ratingAfter} order by ${ratingHistory.createdAt} desc))[1]`,
  }).from(ratingHistory).innerJoin(users, eq(users.id, ratingHistory.userId)).leftJoin(playerProfiles, eq(playerProfiles.userId, users.id))
    .where(and(eq(ratingHistory.format, q.format), gte(ratingHistory.createdAt, since), eq(users.status, 'ACTIVE'), skillW))
    .groupBy(users.id, users.fullName, playerProfiles.avatarUrl, playerProfiles.skillLevel)
    .orderBy(sql`sum(${ratingHistory.delta}) desc`, sql`count(*) filter (where ${ratingHistory.won}) desc`).limit(100);
  res.json({ basis: 'points gained', items: rows.map((x, i) => ({ ...x, rank: i + 1, losses: x.played - x.wins, winRate: x.played ? x.wins / x.played : 0 })) });
}));
