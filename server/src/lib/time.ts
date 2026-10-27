/** Club-timezone helpers. All instants are stored in UTC; opening hours are club-local. */
export const CLUB_TZ = process.env.CLUB_TIMEZONE || 'Asia/Manila';

export function localParts(d: Date, tz = CLUB_TZ) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { ymd: `${p.year}-${p.month}-${p.day}`, dow, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** Offset (minutes) of tz from UTC at instant d. */
function tzOffset(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return (asUtc - d.getTime()) / 60000;
}

/** Convert a club-local date + "HH:MM" to a UTC Date. */
export function localToUtc(ymd: string, hhmm: string, tz = CLUB_TZ) {
  const [y, m, d] = ymd.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, h, mi));
  const off = tzOffset(guess, tz);
  const result = new Date(guess.getTime() - off * 60000);
  const off2 = tzOffset(result, tz); // second pass handles DST edges
  return off2 === off ? result : new Date(guess.getTime() - off2 * 60000);
}

export const toMinutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
export const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60000);
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
/** Start/end (UTC) of a club-local day. */
export function dayRange(ymd: string) {
  const start = localToUtc(ymd, '00:00');
  return { start, end: addDays(start, 1) };
}
export const todayYmd = () => localParts(new Date()).ymd;
