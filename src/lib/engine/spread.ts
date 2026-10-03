import type { ContestGame, ContestTeam } from '../../types';

/**
 * Picking against the spread, explained in plain English.
 *
 * The favorite starts the game with points taken away and the underdog starts
 * with points added, which evens the two sides out. A pick "covers" if its team
 * still comes out ahead once the line is applied. Every label produced here
 * says exactly what has to happen, so nobody needs to know what "-3.5" means.
 */

export type PickResult = 'covered' | 'missed' | 'push' | 'pending';

/**
 * A pick belongs to its own game, not to the slate.
 *
 * The contest locks when its first game starts, which is the right moment to
 * freeze a roster — every player in it is about to be in play. A pick on
 * Sunday's game is not: it stays open until Sunday's game starts, however long
 * ago the contest locked.
 */
export function pickOpen(game: ContestGame, now: Date = new Date()): boolean {
  if (game.state !== 'pre') return false;
  const start = Date.parse(game.startTime);
  return !Number.isFinite(start) || now.getTime() < start;
}

export function hasSpread(game: ContestGame): boolean {
  return Boolean(game.spread) && Number.isFinite(game.spread?.homeSpread);
}

/** Points the given side starts with. */
export function spreadFor(game: ContestGame, side: 'home' | 'away'): number {
  const homeSpread = game.spread?.homeSpread ?? 0;
  return side === 'home' ? homeSpread : -homeSpread;
}

/** "-3.5" / "+3.5" / "PK" */
export function formatLine(value: number): string {
  if (value === 0) return 'PK';
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded}`;
}

/**
 * What this side has to do, in words. A whole-number line can land exactly on
 * the number, which is a push — nobody wins it — so that is spelled out too.
 */
export function requirementText(game: ContestGame, side: 'home' | 'away'): string {
  if (!hasSpread(game)) return 'Pick the winner';
  const value = spreadFor(game, side);
  if (value === 0) return 'Must win the game';

  const line = Math.abs(value);
  const whole = Number.isInteger(line);

  if (value < 0) {
    // Giving points: must win by more than the line.
    const needed = whole ? line + 1 : Math.ceil(line);
    return whole
      ? `Must win by ${needed}+ (exactly ${line} is a tie, no bonus)`
      : `Must win by ${needed}+`;
  }

  // Getting points: can lose by less than the line, or win outright.
  const cushion = whole ? line - 1 : Math.floor(line);
  if (cushion <= 0) {
    return whole ? `Must win, or lose by 0 (exactly ${line} is a tie, no bonus)` : 'Must win the game';
  }
  return whole
    ? `Can lose by up to ${cushion}, or win (exactly ${line} is a tie, no bonus)`
    : `Can lose by up to ${cushion}, or win`;
}

/** "DEN by 3.5" — who is favored, for the header. */
export function favoriteText(game: ContestGame): string {
  const spread = game.spread;
  if (!spread || spread.favorite === 'even') return 'Even matchup — pick the winner';
  const team = spread.favorite === 'home' ? game.home : game.away;
  return `${team.abbreviation} favored by ${spread.line}`;
}

/** How a pick stands, live or final. */
export function gradePick(game: ContestGame, pickedTeamId: string | undefined): PickResult {
  if (!pickedTeamId) return 'pending';
  const decided = game.state === 'post';

  if (!hasSpread(game)) {
    if (!decided || !game.winnerTeamId) return 'pending';
    return game.winnerTeamId === pickedTeamId ? 'covered' : 'missed';
  }

  const homeScore = game.home.score ?? 0;
  const awayScore = game.away.score ?? 0;
  if (!decided && game.state === 'pre') return 'pending';

  const side: 'home' | 'away' = pickedTeamId === game.home.id ? 'home' : 'away';
  const margin = side === 'home' ? homeScore - awayScore : awayScore - homeScore;
  const adjusted = margin + spreadFor(game, side);

  if (!decided) {
    // Live: report where it stands, without calling it final.
    return adjusted > 0 ? 'covered' : adjusted === 0 ? 'push' : 'missed';
  }
  return adjusted > 0 ? 'covered' : adjusted === 0 ? 'push' : 'missed';
}

/** A correct pick earns the bonus; a push earns nothing and costs nothing. */
export function isWinningPick(game: ContestGame, pickedTeamId: string | undefined): boolean {
  return game.state === 'post' && gradePick(game, pickedTeamId) === 'covered';
}

export function teamForSide(game: ContestGame, side: 'home' | 'away'): ContestTeam {
  return side === 'home' ? game.home : game.away;
}
