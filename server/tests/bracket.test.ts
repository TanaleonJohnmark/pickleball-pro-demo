import { describe, it, expect } from 'vitest';
import { seedOrder, singleElimination, roundRobin, snakeGroups, standings, crossSeed } from '../src/services/bracket.js';
import { eloDelta } from '../src/services/rating.js';

describe('brackets', () => {
  it('uses standard seeding', () => { expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]); });
  it('gives byes to top seeds and links rounds', () => {
    const p = singleElimination(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(p.filter((m) => m.round === 1)).toHaveLength(4);
    expect(p).toHaveLength(7);
    const r1 = p.filter((m) => m.round === 1);
    expect(r1[0]).toMatchObject({ t1: 'A', t2: null }); // seed 1 bye
    expect(r1.filter((m) => !m.t1 || !m.t2)).toHaveLength(2);
    expect(r1[1].next).toEqual({ round: 2, position: 0, slot: 2 });
    expect(p.find((m) => m.round === 3)!.next).toBeUndefined();
  });
  it('round robin pairs everyone exactly once', () => {
    const p = roundRobin(['A', 'B', 'C', 'D', 'E']);
    expect(p).toHaveLength(10);
    const keys = new Set(p.map((m) => [m.t1, m.t2].sort().join()));
    expect(keys.size).toBe(10);
  });
  it('snake groups and cross seeding keep group-mates apart in round one', () => {
    const g = snakeGroups(['1', '2', '3', '4', '5', '6', '7', '8'], 2);
    expect(g).toEqual([['1', '4', '5', '8'], ['2', '3', '6', '7']]);
    const ko = singleElimination(crossSeed([['A1', 'A2'], ['B1', 'B2']]));
    const r1 = ko.filter((m) => m.round === 1).map((m) => [m.t1, m.t2]);
    expect(r1).toEqual([['A1', 'B2'], ['B1', 'A2']]);
  });
  it('ranks standings by wins then point difference', () => {
    const s = standings(['a', 'b', 'c'], [{ t1: 'a', t2: 'b', winner: 'a', p1: 11, p2: 2 }, { t1: 'b', t2: 'c', winner: 'b', p1: 11, p2: 9 }, { t1: 'c', t2: 'a', winner: 'c', p1: 11, p2: 9 }]);
    expect(s[0].teamId).toBe('a');
  });
});

describe('elo', () => {
  it('is zero-sum and rewards upsets more', () => {
    const even = eloDelta([1000], [1000], true); expect(even).toEqual({ a: 16, b: -16 });
    const upset = eloDelta([900], [1100], true); expect(upset.a).toBeGreaterThan(16);
  });
});
