export const TZ = 'Asia/Manila';
export const peso = (cents: number | null | undefined) => cents === null || cents === undefined ? '—' : '₱' + (cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pesoShort = (cents: number) => '₱' + Math.round(cents / 100).toLocaleString('en-PH');
const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-PH', { timeZone: TZ, ...o });
export const date = (d: string | Date | null | undefined) => (d ? f({ dateStyle: 'medium' }).format(new Date(d)) : '—');
export const time = (d: string | Date) => f({ hour: 'numeric', minute: '2-digit' }).format(new Date(d));
export const dateTime = (d: string | Date | null | undefined) => (d ? f({ dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d)) : '—');
export const weekday = (d: string | Date) => f({ weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(d));
/** Club-local YYYY-MM-DD */
export const ymd = (d: Date = new Date()) => { const p = Object.fromEntries(f({ year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}`; };
export const addDaysYmd = (s: string, n: number) => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** Club-local date + HH:MM → ISO (Manila is UTC+8 with no DST). */
export const localIso = (ymdStr: string, hhmm: string) => new Date(`${ymdStr}T${hhmm}:00+08:00`).toISOString();
export const localHHMM = (d: string | Date) => f({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d));
export const humanize = (s: string | null | undefined) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : '—');
export const minutesLabel = (m: number) => (m % 60 === 0 ? `${m / 60} hr` : m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr ${m % 60} min`);
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
