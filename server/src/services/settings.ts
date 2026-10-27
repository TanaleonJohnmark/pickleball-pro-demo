import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { systemSettings } from '../db/schema.js';

export const DEFAULT_SETTINGS = {
  clubName: 'Pickleball Pro Club',
  contactEmail: 'hello@example.com',
  contactPhone: '+63 900 000 0000',
  address: 'Set your club address in Settings',
  currency: 'PHP',
  cancellationHours: 24, // players may cancel up to this many hours before start
  defaultAdvanceBookingDays: 14, // booking window for players without a membership
  defaultMaxActiveBookings: 2,
  reminderHours: 24,
};
export type Settings = typeof DEFAULT_SETTINGS;

export async function getSettings(): Promise<Settings> {
  const rows = await db.select().from(systemSettings);
  const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) s[r.key] = r.value;
  return s as Settings;
}

export async function setSetting(key: keyof Settings, value: unknown) {
  await db.insert(systemSettings).values({ key, value }).onConflictDoUpdate({ target: systemSettings.key, set: { value } });
}
export async function getSetting<K extends keyof Settings>(key: K): Promise<Settings[K]> {
  const [r] = await db.select().from(systemSettings).where(eq(systemSettings.key, key));
  return (r?.value as Settings[K]) ?? DEFAULT_SETTINGS[key];
}
