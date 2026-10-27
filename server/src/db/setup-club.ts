/**
 * Prepares a fresh club: creates the owner's super-admin account and sets the
 * club name. Safe to run repeatedly — it never overwrites an existing account.
 * Reads: CLUB_NAME, ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD (+ optional CLUB_PHONE, CLUB_EMAIL, CLUB_ADDRESS)
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from './index.js';
import { users, playerProfiles, systemSettings } from './schema.js';
import { hashPassword } from '../lib/auth.js';

export async function setupClub(log = console.log) {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (process.env.CLUB_NAME) {
    const pairs: [string, string | undefined][] = [['clubName', process.env.CLUB_NAME], ['contactPhone', process.env.CLUB_PHONE], ['contactEmail', process.env.CLUB_EMAIL], ['address', process.env.CLUB_ADDRESS]];
    for (const [key, value] of pairs) if (value) {
      const [existing] = await db.select().from(systemSettings).where(eq(systemSettings.key, key));
      if (!existing) await db.insert(systemSettings).values({ key, value });
    }
  }
  if (!email || !password) return log('setup-club: ADMIN_EMAIL / ADMIN_PASSWORD not set, skipping owner account.');
  const [found] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (found) return log(`setup-club: owner account ${email} already exists.`);
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) throw new Error('ADMIN_PASSWORD needs 8+ characters with a letter and a number');
  const [u] = await db.insert(users).values({ email, fullName: process.env.ADMIN_NAME || 'Club Owner', role: 'SUPER_ADMIN', passwordHash: await hashPassword(password) }).returning();
  await db.insert(playerProfiles).values({ userId: u.id });
  log(`setup-club: created owner account ${email}.`);
}

if (process.argv[1]?.includes('setup-club')) {
  setupClub().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
}
