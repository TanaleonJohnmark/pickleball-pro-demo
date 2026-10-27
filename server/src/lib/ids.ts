import { randomBytes } from 'node:crypto';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export function reference(prefix: string) {
  const b = randomBytes(8);
  let s = ''; for (const x of b) s += ALPHA[x % ALPHA.length];
  return `${prefix}-${s.slice(0, 4)}-${s.slice(4)}`;
}
