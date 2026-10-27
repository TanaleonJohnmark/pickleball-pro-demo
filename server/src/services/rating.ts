/**
 * Ranking algorithm: Elo rating, K = 32, starting rating 1000.
 * Doubles: each team's strength is the average of its players' ratings, and
 * every player on a team receives the team's rating change.
 * Only COMPETITIVE matches that are COMPLETED with an official-validated result
 * change ratings, and each match can be applied only once (ratingApplied flag +
 * unique (user, match) row in rating_history).
 */
export const K = 32;
export const START_RATING = 1000;
export const expected = (a: number, b: number) => 1 / (1 + 10 ** ((b - a) / 400));
export function eloDelta(teamA: number[], teamB: number[], aWon: boolean) {
  const avg = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
  const ea = expected(avg(teamA), avg(teamB));
  const d = Math.round(K * ((aWon ? 1 : 0) - ea));
  return { a: d, b: -d };
}
