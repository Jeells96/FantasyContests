import type {
  ContestGame,
  ContestPlayer,
  ContestScoring,
  NormalizationInfo,
  RosterSlot,
  SalaryCapInfo,
  Sport,
} from '../../types';
import { formatStatLine } from '../stats';
import type { PoolPlayer } from '../providers/types';
import { computeNormalization } from './normalization';
import { isEligible, positionDemand, slotsByScarcity } from './roster';
import { median, projectRawPoints, round2, shrinkProjection, topMean } from './projections';
import { effectiveSalary } from './captain';
import type { CaptainRules } from './lineup';

/**
 * Automatic pricing: projections -> cross-sport normalization -> salaries ->
 * salary cap -> contest scoring baseline. The creator supplies games and rules;
 * everything in this module is derived.
 */

const SALARY_MIN = 3000;
const SALARY_MAX = 12000;
const SALARY_STEP = 100;

/**
 * Salary curve. Slightly above 1 so the very top of the pool pulls clear of the
 * merely good, without collapsing the middle of the range.
 */
const CURVE_EXPONENT = 1.15;
/**
 * How salary splits between raw expected production and positional scarcity.
 * Weighting production keeps points-per-dollar broadly flat, so no tier of
 * player is a free lunch; the scarcity term adds the premium that makes elite,
 * hard-to-replace players genuinely expensive.
 */
const PRODUCTION_WEIGHT = 0.65;
/** Ceiling applied to each component before blending, to tame outliers. */
const COMPONENT_CEILING = 1.25;

/**
 * Where the cap sits between a median-priced lineup and the most expensive
 * legal lineup. Below 1 by construction: a full roster of the chalk must never
 * fit under the cap.
 */
const CAP_AGGRESSIVENESS = 0.62;
/** The cap may never reach this share of the most expensive possible lineup. */
const CAP_MAX_SHARE_OF_STARS = 0.92;
/** Headroom above the cheapest legal lineup, so a valid entry always exists. */
const CAP_MIN_HEADROOM = 1.15;

export interface PricingResult {
  players: ContestPlayer[];
  normalization: NormalizationInfo;
  salaryCapInfo: SalaryCapInfo;
  scoringBaseline: number;
}

interface Priced {
  player: PoolPlayer;
  rawProjection: number;
  normalizedProjection: number;
  vor: number;
}

/**
 * Price a player pool for a contest.
 *
 * `games` is only used to attach opponent/gameId context that is already on the
 * pool players; it is accepted so callers cannot forget to keep them in sync.
 */
const NO_CAPTAIN: CaptainRules = { enabled: false, multiplier: 1 };

export function priceContest(
  pool: PoolPlayer[],
  slots: RosterSlot[],
  scoring: ContestScoring,
  games: ContestGame[],
  captain: CaptainRules = NO_CAPTAIN,
): PricingResult {
  const gameIds = new Set(games.map((g) => g.id));
  const candidates = pool.filter((p) => gameIds.size === 0 || gameIds.has(p.gameId));

  // 1. Raw projections, shrunk toward the positional baseline for small samples.
  const rawByPosition = new Map<string, number[]>();
  const rawProjections = new Map<string, number>();
  for (const player of candidates) {
    const raw = projectRawPoints(player, scoring);
    rawProjections.set(player.id, raw);
    const bucket = rawByPosition.get(positionKey(player)) ?? [];
    bucket.push(raw);
    rawByPosition.set(positionKey(player), bucket);
  }
  const positionBaseline = new Map<string, number>();
  for (const [key, values] of rawByPosition.entries()) {
    positionBaseline.set(key, median(values.filter((v) => v > 0)));
  }
  for (const player of candidates) {
    if (player.isTeamUnit) continue;
    const raw = rawProjections.get(player.id) ?? 0;
    const baseline = positionBaseline.get(positionKey(player)) ?? 0;
    rawProjections.set(player.id, shrinkProjection(raw, player.gamesPlayed, baseline * 0.8));
  }

  // 2. Normalization factors from this pool's own distributions.
  const bySport = new Map<Sport, number[]>();
  for (const player of candidates) {
    const bucket = bySport.get(player.sport) ?? [];
    bucket.push(rawProjections.get(player.id) ?? 0);
    bySport.set(player.sport, bucket);
  }
  const normalization = computeNormalization(bySport);

  // 3. Trim unrosterable depth so it does not distort the salary distribution.
  const trimmed = trimPool(candidates, slots, rawProjections);

  // 4. Value over replacement, per position, using this contest's roster demand.
  const priced = computeValueOverReplacement(trimmed, slots, rawProjections, normalization);

  // 5. Salaries from the pool-relative value hierarchy.
  const salaries = assignSalaries(priced, slots.length);

  const players: ContestPlayer[] = priced.map((entry) => {
    const p = entry.player;
    return {
      id: p.id,
      sport: p.sport,
      name: p.name,
      shortName: p.shortName,
      positions: p.positions,
      position: p.position,
      teamId: p.teamId,
      teamAbbr: p.teamAbbr,
      opponentAbbr: p.opponentAbbr,
      isHome: p.isHome,
      gameId: p.gameId,
      headshot: p.headshot,
      jersey: p.jersey,
      injuryStatus: p.injuryStatus,
      isTeamUnit: p.isTeamUnit,
      contextMultiplier: p.contextMultiplier,
      salary: salaries.get(p.id) ?? SALARY_MIN,
      projection: {
        raw: round2(entry.rawProjection),
        normalized: round2(entry.normalizedProjection),
      },
      seasonStats: p.seasonStats,
      recentStats: p.recentStats,
      gamesPlayed: p.gamesPlayed,
      statLine: formatStatLine(p.sport, p.position, p.seasonStats),
      rawPoints: 0,
      normalizedPoints: 0,
      started: false,
    };
  });

  const salaryCapInfo = computeSalaryCap(players, slots, captain);
  const scoringBaseline = computeScoringBaseline(players, slots, captain);

  return { players, normalization, salaryCapInfo, scoringBaseline };
}

function positionKey(player: PoolPlayer): string {
  return `${player.sport}:${player.position}`;
}

/**
 * Drop deep bench players who would never be rostered, while guaranteeing that
 * every position keeps enough bodies to fill its slots several times over.
 */
function trimPool(
  players: PoolPlayer[],
  slots: RosterSlot[],
  rawProjections: Map<string, number>,
): PoolPlayer[] {
  const demand = positionDemand(slots, players);
  const byPosition = new Map<string, PoolPlayer[]>();
  for (const player of players) {
    const key = positionKey(player);
    const bucket = byPosition.get(key) ?? [];
    bucket.push(player);
    byPosition.set(key, bucket);
  }

  const kept: PoolPlayer[] = [];
  for (const [key, bucket] of byPosition.entries()) {
    const sorted = [...bucket].sort(
      (a, b) => (rawProjections.get(b.id) ?? 0) - (rawProjections.get(a.id) ?? 0),
    );
    const position = key.split(':')[1];
    const slotsForPosition = Math.max(1, Math.ceil(demand.get(position) ?? 1));
    const floor = Math.max(4, slotsForPosition * 3);
    const positionMedian = median(sorted.map((p) => rawProjections.get(p.id) ?? 0).filter((v) => v > 0));
    sorted.forEach((player, index) => {
      const projection = rawProjections.get(player.id) ?? 0;
      const viable = player.isTeamUnit || projection >= positionMedian * 0.15;
      if (index < floor || viable) kept.push(player);
    });
  }
  return kept;
}

function computeValueOverReplacement(
  players: PoolPlayer[],
  slots: RosterSlot[],
  rawProjections: Map<string, number>,
  normalization: NormalizationInfo,
): Priced[] {
  const demand = positionDemand(slots, players);
  const normalizedProjection = new Map<string, number>();
  for (const player of players) {
    const factor = normalization.factors[player.sport] ?? 1;
    normalizedProjection.set(player.id, (rawProjections.get(player.id) ?? 0) * factor);
  }

  const replacement = new Map<string, number>();
  const byPosition = new Map<string, PoolPlayer[]>();
  for (const player of players) {
    const key = positionKey(player);
    const bucket = byPosition.get(key) ?? [];
    bucket.push(player);
    byPosition.set(key, bucket);
  }
  for (const [key, bucket] of byPosition.entries()) {
    const position = key.split(':')[1];
    const sorted = [...bucket].sort(
      (a, b) => (normalizedProjection.get(b.id) ?? 0) - (normalizedProjection.get(a.id) ?? 0),
    );
    // The replacement player is the first one who would not be a starter if
    // every entrant filled this position's slots from this pool.
    const index = Math.min(sorted.length - 1, Math.max(1, Math.ceil(demand.get(position) ?? 1)));
    replacement.set(key, normalizedProjection.get(sorted[index].id) ?? 0);
  }

  return players.map((player) => {
    const normalized = normalizedProjection.get(player.id) ?? 0;
    const level = replacement.get(positionKey(player)) ?? 0;
    return {
      player,
      rawProjection: rawProjections.get(player.id) ?? 0,
      normalizedProjection: normalized,
      vor: normalized - level,
    };
  });
}

/**
 * Map the value hierarchy onto salaries.
 *
 * Two components are blended:
 *
 *  - production: expected contest points against the level a "stars" player in
 *    this pool produces. This keeps points-per-dollar comparable across the
 *    pool, so a cheap player is cheap because he is expected to score less, not
 *    because of an artefact of his position.
 *  - scarcity: points above the replacement level at the player's own position,
 *    against the same measure for the pool. This is what makes one or two elite
 *    players at a thin position expensive, and what keeps a deep position from
 *    pricing its whole depth chart as though it were scarce.
 *
 * Both are measured from the selected pool, so the hierarchy is always relative
 * to the contest being created: a slate with many stars spreads its salary
 * across them, and a slate with one star prices that star at the ceiling.
 */
function assignSalaries(priced: Priced[], rosterSize: number): Map<string, number> {
  const salaries = new Map<string, number>();
  if (priced.length === 0) return salaries;
  if (priced.length === 1) {
    salaries.set(priced[0].player.id, SALARY_MAX);
    return salaries;
  }

  const starsCount = Math.max(3, rosterSize);
  const productionScale = topMean(
    priced.map((entry) => entry.normalizedProjection).filter((value) => value > 0),
    starsCount,
  );
  const scarcityScale = topMean(
    priced.map((entry) => Math.max(0, entry.vor)).filter((value) => value > 0),
    starsCount,
  );

  const blend = (entry: Priced): number => {
    const production = productionScale > 0 ? entry.normalizedProjection / productionScale : 0;
    const scarcity = scarcityScale > 0 ? Math.max(0, entry.vor) / scarcityScale : 0;
    return (
      PRODUCTION_WEIGHT * Math.min(COMPONENT_CEILING, Math.max(0, production)) +
      (1 - PRODUCTION_WEIGHT) * Math.min(COMPONENT_CEILING, scarcity)
    );
  };

  // Scale to the strongest player in the pool so the best player in any contest
  // costs the maximum and the tier just below him stays distinguishable, rather
  // than everyone strong clipping at the ceiling.
  const blended = priced.map((entry) => ({ entry, value: blend(entry) }));
  const peak = Math.max(...blended.map((row) => row.value));

  for (const { entry, value } of blended) {
    const score = peak > 0 ? Math.pow(Math.min(1, value / peak), CURVE_EXPONENT) : 0;
    salaries.set(entry.player.id, roundToStep(SALARY_MIN + (SALARY_MAX - SALARY_MIN) * score));
  }

  return salaries;
}

type SalaryPick = 'cheapest' | 'most-expensive' | 'median';

/**
 * Greedy slot filling used to measure what lineups a pool makes possible.
 * Slots are filled most-restrictive-first so a scarce position is never left
 * without an eligible player.
 */
function assignLineup(players: ContestPlayer[], slots: RosterSlot[], pick: SalaryPick): ContestPlayer[] {
  const used = new Set<string>();
  const chosen: ContestPlayer[] = [];
  for (const slot of slotsByScarcity(slots, players)) {
    const eligible = players
      .filter((player) => !used.has(player.id) && isEligible(player, slot))
      .sort((a, b) => a.salary - b.salary);
    if (eligible.length === 0) continue;
    let selected: ContestPlayer;
    if (pick === 'cheapest') selected = eligible[0];
    else if (pick === 'most-expensive') selected = eligible[eligible.length - 1];
    else selected = eligible[Math.floor((eligible.length - 1) / 2)];
    used.add(selected.id);
    chosen.push(selected);
  }
  return chosen;
}

/**
 * What a lineup costs, including the captain premium. A lineup being measured
 * for the cheapest case captains its cheapest player; any other case captains
 * its most expensive, which is what an entrant actually does.
 */
function totalSalary(
  players: ContestPlayer[],
  captain: CaptainRules = NO_CAPTAIN,
  pick: 'cheapest' | 'priciest' = 'priciest',
): number {
  const base = players.reduce((sum, player) => sum + player.salary, 0);
  if (!captain.enabled || players.length === 0) return base;
  const premiums = players.map((player) => effectiveSalary(player.salary, true, captain.multiplier) - player.salary);
  return base + (pick === 'cheapest' ? Math.min(...premiums) : Math.max(...premiums));
}

/**
 * Automatic salary cap.
 *
 * Measured from the pool itself: the cap sits part-way between a median-priced
 * lineup and the most expensive legal lineup, which means a user can afford
 * several stars but never all of them, and always has enough room to field a
 * complete roster.
 */
export function computeSalaryCap(
  players: ContestPlayer[],
  slots: RosterSlot[],
  captain: CaptainRules = NO_CAPTAIN,
): SalaryCapInfo {
  const cheapest = totalSalary(assignLineup(players, slots, 'cheapest'), captain, 'cheapest');
  const priciest = totalSalary(assignLineup(players, slots, 'most-expensive'), captain);
  const middle = totalSalary(assignLineup(players, slots, 'median'), captain);

  if (priciest === 0) {
    return { cap: 0, minLineupCost: 0, maxLineupCost: 0, medianLineupCost: 0, aggressiveness: 0 };
  }

  let cap = middle + CAP_AGGRESSIVENESS * (priciest - middle);
  cap = Math.min(cap, priciest * CAP_MAX_SHARE_OF_STARS);
  cap = Math.max(cap, cheapest * CAP_MIN_HEADROOM);
  // Feasibility always wins over star-denial.
  cap = Math.max(cap, cheapest + SALARY_STEP * 5);
  const rounded = roundToStep(cap);

  return {
    cap: rounded,
    minLineupCost: cheapest,
    maxLineupCost: priciest,
    medianLineupCost: middle,
    aggressiveness:
      priciest > middle ? Math.round(((rounded - middle) / (priciest - middle)) * 1000) / 1000 : 0,
  };
}

/**
 * Contest scoring baseline: the expected normalized score of a solid, ordinary
 * lineup built from this pool. Frozen onto the contest and used as the
 * denominator for the game-winner bonus so that the bonus never depends on any
 * individual user's score (which would make scoring circular).
 */
export function computeScoringBaseline(
  players: ContestPlayer[],
  slots: RosterSlot[],
  captain: CaptainRules = NO_CAPTAIN,
): number {
  const used = new Set<string>();
  let total = 0;
  let best = 0;
  for (const slot of slotsByScarcity(slots, players)) {
    const eligible = players
      .filter((player) => !used.has(player.id) && isEligible(player, slot))
      .sort((a, b) => b.projection.normalized - a.projection.normalized);
    if (eligible.length === 0) continue;
    // Median of the better half: what a competent entrant would expect.
    const upperHalf = eligible.slice(0, Math.max(1, Math.ceil(eligible.length / 2)));
    const selected = upperHalf[Math.floor((upperHalf.length - 1) / 2)];
    used.add(selected.id);
    total += selected.projection.normalized;
    best = Math.max(best, selected.projection.normalized);
  }
  // A realistic entry captains its strongest player, which lifts the expected
  // score the game-winner bonus is a percentage of.
  if (captain.enabled) total += best * (captain.multiplier - 1);
  return round2(total);
}

export function gameWinnerBonusPoints(scoringBaseline: number, bonusPercent: number): number {
  return round2((scoringBaseline * bonusPercent) / 100);
}

function roundToStep(value: number): number {
  return Math.max(SALARY_MIN, Math.round(value / SALARY_STEP) * SALARY_STEP);
}

export { SALARY_MIN, SALARY_MAX };
