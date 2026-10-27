/** Pure bracket generators. Teams are passed in seed order (index 0 = top seed). */
export interface PlannedMatch { round: number; position: number; t1: string | null; t2: string | null; next?: { round: number; position: number; slot: 1 | 2 } }

/** Standard seeding order for a bracket of `size` (power of two): 1 v N, then halves mirrored. */
export function seedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

export function singleElimination(teams: string[]): PlannedMatch[] {
  if (teams.length < 2) throw new Error('At least 2 teams are needed for a bracket');
  let size = 2; while (size < teams.length) size *= 2;
  const order = seedOrder(size);
  const rounds = Math.log2(size);
  const out: PlannedMatch[] = [];
  for (let r = 1; r <= rounds; r++) {
    const count = size / 2 ** r;
    for (let p = 0; p < count; p++) {
      const m: PlannedMatch = { round: r, position: p, t1: null, t2: null };
      if (r === 1) {
        m.t1 = teams[order[p * 2] - 1] ?? null; // missing seeds become byes
        m.t2 = teams[order[p * 2 + 1] - 1] ?? null;
      }
      if (r < rounds) m.next = { round: r + 1, position: Math.floor(p / 2), slot: (p % 2 === 0 ? 1 : 2) };
      out.push(m);
    }
  }
  return out;
}

/** Round robin via the circle method: every team meets every other team once. */
export function roundRobin(teams: string[]): PlannedMatch[] {
  if (teams.length < 2) throw new Error('At least 2 teams are needed');
  const list: (string | null)[] = [...teams];
  if (list.length % 2) list.push(null);
  const n = list.length, out: PlannedMatch[] = [];
  for (let r = 0; r < n - 1; r++) {
    let pos = 0;
    for (let i = 0; i < n / 2; i++) {
      const a = list[i], b = list[n - 1 - i];
      if (a && b) out.push({ round: r + 1, position: pos++, t1: a, t2: b });
    }
    list.splice(1, 0, list.pop()!); // rotate all but the first
  }
  return out;
}

/** Snake-seed teams into groups: A B C C B A … */
export function snakeGroups(teams: string[], groups: number): string[][] {
  const g: string[][] = Array.from({ length: groups }, () => []);
  teams.forEach((t, i) => {
    const row = Math.floor(i / groups);
    const col = row % 2 === 0 ? i % groups : groups - 1 - (i % groups);
    g[col].push(t);
  });
  return g;
}

export interface Standing { teamId: string; played: number; wins: number; losses: number; pointsFor: number; pointsAgainst: number }
/** Group standings: wins, then point differential, then points scored. */
export function standings(teamIds: string[], results: { t1: string; t2: string; winner: string; p1: number; p2: number }[]): Standing[] {
  const m = new Map(teamIds.map((t) => [t, { teamId: t, played: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 }]));
  for (const r of results) {
    const a = m.get(r.t1), b = m.get(r.t2); if (!a || !b) continue;
    a.played++; b.played++; a.pointsFor += r.p1; a.pointsAgainst += r.p2; b.pointsFor += r.p2; b.pointsAgainst += r.p1;
    if (r.winner === r.t1) { a.wins++; b.losses++; } else { b.wins++; a.losses++; }
  }
  return [...m.values()].sort((x, y) => y.wins - x.wins || (y.pointsFor - y.pointsAgainst) - (x.pointsFor - x.pointsAgainst) || y.pointsFor - x.pointsFor);
}

/** Cross-seed group qualifiers into knockout order: seeds group winners first, then runners-up, so seed 1 v last seed puts A1 against the other group's runner-up. */
export function crossSeed(groupRankings: string[][]): string[] {
  const winners = groupRankings.map((g) => g[0]);
  const runners = groupRankings.map((g) => g[1]);
  return [...winners, ...runners].filter(Boolean);
}
