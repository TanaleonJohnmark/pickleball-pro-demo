import { describe, it, expect } from 'vitest';
import { initialState, applyRally, undo, callout, validateFinalGame, validateFinalMatch, replay, type ScoringConfig } from '../src/services/scoring.js';

const dbl: ScoringConfig = { format: 'DOUBLES', scoring: 'SIDE_OUT', targetScore: 11, winBy: 2, bestOf: 1 };
const sgl: ScoringConfig = { ...dbl, format: 'SINGLES' };

describe('side-out doubles scoring', () => {
  it('starts at 0-0-2 and sides out after the first fault', () => {
    let s = initialState(dbl, 1);
    expect(callout(dbl, s)).toBe('0-0-2');
    s = applyRally(dbl, s, 2); // serving team loses rally → side out immediately at start
    expect(s.servingSide).toBe(2); expect(s.serverNumber).toBe(1); expect(callout(dbl, s)).toBe('0-0-1');
  });
  it('only the serving team scores, and the partner serves before a side-out', () => {
    let s = initialState(dbl, 1);
    s = applyRally(dbl, s, 2); // side out → team 2 server 1
    s = applyRally(dbl, s, 2); // team 2 scores
    expect(s.games[0]).toMatchObject({ s1: 0, s2: 1 });
    s = applyRally(dbl, s, 1); // fault → server 2 of team 2, no point to team 1
    expect(s.games[0].s1).toBe(0); expect(s.servingSide).toBe(2); expect(s.serverNumber).toBe(2);
    expect(callout(dbl, s)).toBe('1-0-2');
    s = applyRally(dbl, s, 1); // side out
    expect(s.servingSide).toBe(1); expect(s.serverNumber).toBe(1);
  });
  it('requires a two-point lead past the target', () => {
    let s = replay(dbl, 1, [...Array(10).fill(1)]); // 10-0 for side 1 (serving 1 at 0-0-2)
    expect(s.games[0].s1).toBe(10);
    s = applyRally(dbl, s, 1);
    expect(s.completed).toBe(true); expect(s.winnerSide).toBe(1);
    expect(() => applyRally(dbl, s, 1)).toThrow(/already complete/);
  });
});

describe('rally scoring', () => {
  const rally: ScoringConfig = { ...sgl, scoring: 'RALLY', targetScore: 11 };
  it('awards a point on every rally and switches serve to the rally winner', () => {
    let s = initialState(rally, 1);
    s = applyRally(rally, s, 2);
    expect(s.games[0]).toMatchObject({ s1: 0, s2: 1 }); expect(s.servingSide).toBe(2);
  });
  it('goes past the target until someone leads by two', () => {
    const log = [] as (1 | 2)[];
    for (let i = 0; i < 10; i++) log.push(1, 2); // 10-10
    let s = replay(rally, 1, log);
    s = applyRally(rally, s, 1); expect(s.completed).toBe(false); // 11-10
    s = applyRally(rally, s, 2); s = applyRally(rally, s, 2); expect(s.completed).toBe(false); // 11-12
    s = applyRally(rally, s, 2); expect(s.completed).toBe(true); expect(s.games[0]).toMatchObject({ s1: 11, s2: 13 });
  });
});

describe('best of three', () => {
  const bo3: ScoringConfig = { ...sgl, bestOf: 3 };
  it('starts a new game and alternates first serve', () => {
    let s = replay(bo3, 1, Array(11).fill(1));
    expect(s.games.length).toBe(2); expect(s.servingSide).toBe(2); expect(s.completed).toBe(false);
  });
  it('undo restores the exact previous state', () => {
    const s = replay(bo3, 1, [1, 1, 2, 2, 1]);
    const u = undo(bo3, s);
    expect(u).toEqual(replay(bo3, 1, [1, 1, 2, 2]));
  });
});

describe('final score validation', () => {
  it('accepts legal finals', () => {
    expect(validateFinalGame(dbl, 11, 4)).toBe(1);
    expect(validateFinalGame(dbl, 12, 14)).toBe(2);
  });
  it('rejects impossible or unfinished scores', () => {
    expect(() => validateFinalGame(dbl, 11, 10)).toThrow(/not a finished game/);
    expect(() => validateFinalGame(dbl, 15, 11)).toThrow(/impossible/);
    expect(() => validateFinalGame(dbl, 9, 3)).toThrow();
    expect(() => validateFinalGame(dbl, -1, 11)).toThrow();
  });
  it('validates match structure', () => {
    const bo3: ScoringConfig = { ...dbl, bestOf: 3 };
    expect(validateFinalMatch(bo3, [{ s1: 11, s2: 5 }, { s1: 7, s2: 11 }, { s1: 11, s2: 9 }]).winner).toBe(1);
    expect(() => validateFinalMatch(bo3, [{ s1: 11, s2: 5 }, { s1: 11, s2: 3 }, { s1: 11, s2: 9 }])).toThrow(/already decided/);
    expect(() => validateFinalMatch(bo3, [{ s1: 11, s2: 5 }])).toThrow(/No side/);
  });
});
