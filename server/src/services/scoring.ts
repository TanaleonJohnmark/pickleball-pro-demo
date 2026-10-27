/**
 * Pickleball scoring engine (pure, framework-free, fully unit-tested).
 *
 * Supports singles/doubles, traditional side-out scoring and rally scoring,
 * configurable target score, win-by (1 or 2) and best-of (1/3/5).
 * Scores only change rally-by-rally, so impossible transitions cannot happen.
 * The state keeps a log of rally winners, which makes "undo" an exact replay.
 */
export type Side = 1 | 2;
export interface ScoringConfig {
  format: 'SINGLES' | 'DOUBLES';
  scoring: 'SIDE_OUT' | 'RALLY';
  targetScore: number;
  winBy: number;
  bestOf: number;
}
export interface Game { s1: number; s2: number; winner: Side | null }
export interface ScoreState {
  games: Game[];
  servingSide: Side;
  serverNumber: 1 | 2;
  firstServingSide: Side;
  completed: boolean;
  winnerSide: Side | null;
  log: Side[];
}

const other = (s: Side): Side => (s === 1 ? 2 : 1);
/** Traditional doubles starts each game at "0-0-2": only one server before the first side-out. */
const startServer = (cfg: ScoringConfig): 1 | 2 => (cfg.format === 'DOUBLES' && cfg.scoring === 'SIDE_OUT' ? 2 : 1);

export function validateConfig(cfg: ScoringConfig) {
  if (![1, 3, 5].includes(cfg.bestOf)) throw new Error('Best-of must be 1, 3 or 5');
  if (![1, 2].includes(cfg.winBy)) throw new Error('Win-by must be 1 or 2');
  if (cfg.targetScore < 5 || cfg.targetScore > 25) throw new Error('Target score must be between 5 and 25');
}

export function initialState(cfg: ScoringConfig, firstServingSide: Side = 1): ScoreState {
  validateConfig(cfg);
  return { games: [{ s1: 0, s2: 0, winner: null }], servingSide: firstServingSide, serverNumber: startServer(cfg), firstServingSide, completed: false, winnerSide: null, log: [] };
}

export function gameWinner(cfg: ScoringConfig, s1: number, s2: number): Side | null {
  const hi = Math.max(s1, s2), lo = Math.min(s1, s2);
  if (hi >= cfg.targetScore && hi - lo >= cfg.winBy) return s1 > s2 ? 1 : 2;
  return null;
}

export const gamesWon = (st: ScoreState, side: Side) => st.games.filter((g) => g.winner === side).length;

export function applyRally(cfg: ScoringConfig, prev: ScoreState, rallyWinner: Side): ScoreState {
  if (prev.completed) throw new Error('Match is already complete');
  if (rallyWinner !== 1 && rallyWinner !== 2) throw new Error('Rally winner must be side 1 or 2');
  const st: ScoreState = structuredClone(prev);
  const g = st.games[st.games.length - 1];
  const point = (s: Side) => { if (s === 1) g.s1++; else g.s2++; };

  if (cfg.scoring === 'RALLY') {
    point(rallyWinner);
    if (rallyWinner !== st.servingSide) { st.servingSide = rallyWinner; st.serverNumber = 1; }
  } else if (rallyWinner === st.servingSide) {
    point(rallyWinner); // only the serving side scores in side-out scoring
  } else if (cfg.format === 'DOUBLES' && st.serverNumber === 1) {
    st.serverNumber = 2; // partner serves next
  } else {
    st.servingSide = other(st.servingSide); // side-out
    st.serverNumber = 1;
  }

  const w = gameWinner(cfg, g.s1, g.s2);
  if (w) {
    g.winner = w;
    const needed = Math.floor(cfg.bestOf / 2) + 1;
    if (gamesWon(st, w) >= needed) { st.completed = true; st.winnerSide = w; }
    else {
      st.games.push({ s1: 0, s2: 0, winner: null });
      // serve alternates between sides at the start of each new game
      st.servingSide = st.games.length % 2 === 1 ? st.firstServingSide : other(st.firstServingSide);
      st.serverNumber = startServer(cfg);
    }
  }
  st.log.push(rallyWinner);
  return st;
}

export function undo(cfg: ScoringConfig, st: ScoreState): ScoreState {
  if (!st.log.length) throw new Error('Nothing to undo');
  return replay(cfg, st.firstServingSide, st.log.slice(0, -1));
}

export function replay(cfg: ScoringConfig, firstServingSide: Side, log: Side[]): ScoreState {
  return log.reduce((s, w) => applyRally(cfg, s, w), initialState(cfg, firstServingSide));
}

/** Score call as spoken by the server, e.g. "4-2-1" (doubles side-out) or "4-2". */
export function callout(cfg: ScoringConfig, st: ScoreState): string {
  const g = st.games[st.games.length - 1];
  const serving = st.servingSide === 1 ? g.s1 : g.s2;
  const receiving = st.servingSide === 1 ? g.s2 : g.s1;
  return cfg.format === 'DOUBLES' && cfg.scoring === 'SIDE_OUT' ? `${serving}-${receiving}-${st.serverNumber}` : `${serving}-${receiving}`;
}

/**
 * Validate a final game score entered after play (no rally-by-rally tracking).
 * A legal final: winner reached the target and leads by win-by; if play went
 * past the target with win-by-2, the margin must be exactly 2 (e.g. 13-11, never 14-11).
 */
export function validateFinalGame(cfg: ScoringConfig, s1: number, s2: number): Side {
  if (!Number.isInteger(s1) || !Number.isInteger(s2) || s1 < 0 || s2 < 0) throw new Error('Scores must be whole numbers of zero or more');
  const w = gameWinner(cfg, s1, s2);
  if (!w) throw new Error(`${s1}-${s2} is not a finished game (play to ${cfg.targetScore}, win by ${cfg.winBy})`);
  const hi = Math.max(s1, s2), lo = Math.min(s1, s2);
  if (hi > cfg.targetScore && hi - lo !== cfg.winBy) throw new Error(`${s1}-${s2} is impossible: once past ${cfg.targetScore}, a game ends as soon as one side leads by ${cfg.winBy}`);
  return w;
}

/** Validate a full set of final game scores against best-of rules. Returns the match winner. */
export function validateFinalMatch(cfg: ScoringConfig, games: { s1: number; s2: number }[]): { winner: Side; games: Game[] } {
  validateConfig(cfg);
  const needed = Math.floor(cfg.bestOf / 2) + 1;
  if (!games.length || games.length > cfg.bestOf) throw new Error(`Enter between 1 and ${cfg.bestOf} games`);
  const out: Game[] = []; const wins = { 1: 0, 2: 0 } as Record<Side, number>;
  for (const [i, g] of games.entries()) {
    if (wins[1] >= needed || wins[2] >= needed) throw new Error(`Game ${i + 1} was entered after the match was already decided`);
    const w = validateFinalGame(cfg, g.s1, g.s2);
    wins[w]++; out.push({ s1: g.s1, s2: g.s2, winner: w });
  }
  if (wins[1] < needed && wins[2] < needed) throw new Error(`No side has won ${needed} game(s) yet`);
  return { winner: wins[1] >= needed ? 1 : 2, games: out };
}
