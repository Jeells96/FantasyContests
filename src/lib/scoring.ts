import type { ContestScoring, Sport, SportScoring, StatMap } from '../types';

/**
 * Default scoring tables.
 *
 * NFL is the baseline scale for the whole platform: MLB and NBA tables produce
 * points on their own natural scale and are then multiplied by the contest's
 * normalization factor (see lib/engine/normalization.ts) so that a good MLB or
 * NBA game is worth about as much as a good NFL game.
 */

export const DEFAULT_NFL_SCORING: SportScoring = {
  values: {
    passYds: 0.04,
    passTD: 4,
    passInt: -2,
    rushYds: 0.1,
    rushTD: 6,
    rec: 1,
    recYds: 0.1,
    recTD: 6,
    fumLost: -2,
    twoPt: 2,
    // ESPN pays field goals by distance; fgMade itself is left at zero so a
    // kicker is never counted twice.
    fgMade: 0,
    fgMade0_39: 3,
    fgMade40_49: 4,
    fgMade50_59: 5,
    fgMade60: 6,
    fgMissed: -1,
    xpMade: 1,
    xpMissed: 0,
    krTD: 6,
    prTD: 6,
    dstSack: 1,
    dstInt: 2,
    dstFumRec: 2,
    dstTD: 6,
    dstSafety: 2,
    dstBlockedKick: 2,
  },
  tiers: {
    // ESPN's own points-allowed ladder.
    dstPtsAllowed: [
      { min: 0, max: 0, points: 5 },
      { min: 1, max: 6, points: 4 },
      { min: 7, max: 13, points: 3 },
      { min: 14, max: 17, points: 1 },
      { min: 18, max: 27, points: 0 },
      { min: 28, max: 34, points: -1 },
      { min: 35, max: 45, points: -3 },
      { min: 46, max: null, points: -5 },
    ],
  },
};

export const DEFAULT_MLB_SCORING: SportScoring = {
  values: {
    singles: 3,
    doubles: 5,
    triples: 8,
    hr: 10,
    rbi: 2,
    r: 2,
    bb: 2,
    hbp: 2,
    sb: 5,
    cs: -2,
    // Striking out and booting a ball are the two ways a position player
    // actively costs his side, so they cost him here too.
    so: -1,
    e: -2,
    pitchOuts: 0.75, // 2.25 points per full inning
    pitchSO: 2,
    pitchW: 4,
    pitchER: -2,
    pitchH: -0.6,
    pitchBB: -0.6,
    pitchHBP: -0.6,
    pitchSV: 5,
    pitchHLD: 2,
    pitchCG: 2.5,
    pitchSHO: 2.5,
  },
};

export const DEFAULT_NBA_SCORING: SportScoring = {
  values: {
    pts: 1,
    fg3m: 0.5,
    reb: 1.25,
    ast: 1.5,
    stl: 2,
    blk: 2,
    tov: -0.5,
    dd: 1.5,
    td3: 3,
  },
};

export const DEFAULT_SCORING: Record<Sport, SportScoring> = {
  nfl: DEFAULT_NFL_SCORING,
  // Same game, same scoring: ESPN's college scoring matches its NFL table.
  ncaaf: DEFAULT_NFL_SCORING,
  mlb: DEFAULT_MLB_SCORING,
  nba: DEFAULT_NBA_SCORING,
};

export function defaultScoringFor(sports: Sport[]): ContestScoring {
  const out: ContestScoring = {};
  for (const sport of sports) out[sport] = cloneScoring(DEFAULT_SCORING[sport]);
  return out;
}

export function cloneScoring(scoring: SportScoring): SportScoring {
  return {
    values: { ...scoring.values },
    tiers: scoring.tiers
      ? Object.fromEntries(Object.entries(scoring.tiers).map(([k, v]) => [k, v.map((t) => ({ ...t }))]))
      : undefined,
  };
}

/**
 * Raw fantasy points for a stat line, in the sport's own scale.
 * Unknown stats are ignored, missing stats count as zero.
 */
export function computeRawFantasyPoints(stats: StatMap | undefined, scoring: SportScoring | undefined): number {
  if (!stats || !scoring) return 0;
  let total = 0;
  for (const [key, perUnit] of Object.entries(scoring.values)) {
    const value = stats[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    total += value * perUnit;
  }
  for (const [key, tiers] of Object.entries(scoring.tiers ?? {})) {
    const value = stats[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const tier = tiers.find((t) => value >= t.min && (t.max === null || value <= t.max));
    if (tier) total += tier.points;
  }
  return round2(total);
}

/** Per-stat contribution breakdown, used by the player detail sheet. */
export function scoringBreakdown(
  stats: StatMap | undefined,
  scoring: SportScoring | undefined,
): { key: string; value: number; points: number }[] {
  if (!stats || !scoring) return [];
  const rows: { key: string; value: number; points: number }[] = [];
  for (const [key, perUnit] of Object.entries(scoring.values)) {
    const value = stats[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) continue;
    rows.push({ key, value, points: round2(value * perUnit) });
  }
  for (const [key, tiers] of Object.entries(scoring.tiers ?? {})) {
    const value = stats[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const tier = tiers.find((t) => value >= t.min && (t.max === null || value <= t.max));
    if (tier) rows.push({ key, value, points: tier.points });
  }
  return rows.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
