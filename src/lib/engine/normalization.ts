import type { NormalizationInfo, Sport } from '../../types';
import { topMean } from './projections';

/**
 * Cross-sport fantasy point normalization.
 *
 * NFL is the baseline scale. Every other sport's raw fantasy points are
 * multiplied by a factor derived from the *selected player pool* so that the
 * production of a strong MLB or NBA player is worth about as much as that of a
 * strong NFL player. Nothing here is hand-entered.
 *
 * The anchor for a sport is the mean expected fantasy output of the players who
 * would realistically be rostered from that sport's pool (its top slice), which
 * makes the factor adapt to the specific games the creator selected rather than to
 * league-wide averages.
 */

/**
 * Fallback anchors, in each sport's own scoring scale, used only when a sport
 * needs a baseline that the contest itself cannot supply: specifically, when a
 * contest contains no NFL games there is no measured NFL anchor to scale to.
 */
export const REFERENCE_ANCHORS: Record<Sport, number> = {
  nfl: 14,
  mlb: 9.5,
  nba: 33,
};

/** How many of the best projections define a sport's anchor. */
export function anchorCount(poolSize: number): number {
  return Math.max(6, Math.min(24, Math.round(poolSize * 0.12)));
}

export function computeNormalization(rawProjectionsBySport: Map<Sport, number[]>): NormalizationInfo {
  const anchors: Partial<Record<Sport, number>> = {};
  for (const [sport, projections] of rawProjectionsBySport.entries()) {
    const positive = projections.filter((p) => p > 0);
    anchors[sport] = round3(topMean(positive, anchorCount(positive.length)));
  }

  const nflAnchor = anchors.nfl;
  const usesMeasuredBaseline = typeof nflAnchor === 'number' && nflAnchor > 0;
  const baselineAnchor = usesMeasuredBaseline ? nflAnchor : REFERENCE_ANCHORS.nfl;

  const factors: Partial<Record<Sport, number>> = {};
  const method: Partial<Record<Sport, 'pool' | 'reference'>> = {};
  for (const [sport, anchor] of Object.entries(anchors) as [Sport, number][]) {
    if (sport === 'nfl') {
      factors.nfl = 1;
      method.nfl = 'pool';
      continue;
    }
    factors[sport] = anchor > 0 ? clamp(round3(baselineAnchor / anchor), 0.05, 20) : 1;
    method[sport] = usesMeasuredBaseline ? 'pool' : 'reference';
  }

  return {
    factors,
    anchors,
    baselineAnchor: round3(baselineAnchor),
    method,
    computedAt: new Date().toISOString(),
  };
}

/** Factor for a sport; unknown sports pass through unchanged. */
export function normalizationFactor(normalization: NormalizationInfo | undefined, sport: Sport): number {
  const factor = normalization?.factors?.[sport];
  return typeof factor === 'number' && Number.isFinite(factor) && factor > 0 ? factor : 1;
}

export function normalizePoints(
  rawPoints: number,
  sport: Sport,
  normalization: NormalizationInfo | undefined,
): number {
  return Math.round(rawPoints * normalizationFactor(normalization, sport) * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
