import type { ContestScoring, Sport, StatMap } from '../../types';
import { computeRawFantasyPoints } from '../scoring';
import type { PoolPlayer } from '../providers/types';

/** Weight given to recent form when it is available. */
const RECENT_WEIGHT = 0.4;

/**
 * Expected fantasy points for a player, in that player's own sport scale.
 *
 * Season per-game production is blended with recent form and then adjusted for
 * the game context (market-implied team total for NFL/NBA, opposing starter for
 * MLB). Small samples are shrunk toward the positional baseline by the caller.
 */
export function projectRawPoints(player: PoolPlayer, scoring: ContestScoring): number {
  const table = scoring[player.sport];
  if (!table) return 0;
  const season = computeRawFantasyPoints(player.seasonStats, table);
  const recent = player.recentStats ? computeRawFantasyPoints(player.recentStats, table) : null;
  const blended = recent === null ? season : season * (1 - RECENT_WEIGHT) + recent * RECENT_WEIGHT;
  const context = player.contextMultiplier ?? 1;
  return Math.max(0, round2(blended * context));
}

/**
 * Shrink a projection toward a baseline when the sample is small, so that a
 * player with one big game does not price like an established star.
 */
export function shrinkProjection(projection: number, gamesPlayed: number, baseline: number): number {
  const weight = gamesPlayed <= 0 ? 0 : gamesPlayed / (gamesPlayed + 2.5);
  return round2(projection * weight + baseline * (1 - weight));
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Mean of the top `count` values. */
export function topMean(values: number[], count: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => b - a);
  return mean(sorted.slice(0, Math.max(1, Math.min(count, sorted.length))));
}

export function statTotals(stats: StatMap | undefined): number {
  if (!stats) return 0;
  return Object.values(stats).reduce((sum, v) => sum + Math.abs(v), 0);
}

export function sportsOf(players: { sport: Sport }[]): Sport[] {
  return Array.from(new Set(players.map((p) => p.sport)));
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
