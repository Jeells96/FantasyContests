import type { ContestPlayer, RosterSlot } from '../../types';
import { effectivePoints, effectiveSalary } from './captain';
import type { CaptainRules } from './lineup';
import { isEligible, isOpenRoster } from './roster';

/**
 * The best lineup the pool allows.
 *
 * During a contest this is the highest score anyone could be holding right now;
 * once every game is final it is the perfect lineup. It obeys the contest's own
 * rules — roster size, salary cap and the captain multiplier — because a lineup
 * that breaks them was never available to anyone.
 *
 * With interchangeable spots (the default) this is solved exactly, as a
 * knapsack over salary with one slot reserved for the captain. Position-locked
 * rosters fall back to a greedy fill, which `exact` reports.
 */

export interface OptimalPick {
  player: ContestPlayer;
  isCaptain: boolean;
  points: number;
  salary: number;
}

export interface OptimalLineup {
  picks: OptimalPick[];
  totalPoints: number;
  totalSalary: number;
  exact: boolean;
}

/** Salaries are whole hundreds, so the knapsack works in hundreds. */
const UNIT = 100;
/** Enough of the pool to guarantee the real answer without a huge table. */
const TOP_SCORERS = 90;
const CHEAP_FILLERS = 30;

function pointsOf(player: ContestPlayer): number {
  return player.normalizedPoints ?? 0;
}

export function bestPossibleLineup(
  players: ContestPlayer[],
  slots: RosterSlot[],
  cap: number,
  captain: CaptainRules,
): OptimalLineup | null {
  if (players.length === 0 || slots.length === 0) return null;
  if (isOpenRoster(slots)) {
    const solved = solveOpenRoster(players, slots.length, cap, captain);
    if (solved) return solved;
  }
  return greedyFill(players, slots, cap, captain);
}

/** Exact solve for interchangeable spots. */
function solveOpenRoster(
  players: ContestPlayer[],
  slotCount: number,
  cap: number,
  captain: CaptainRules,
): OptimalLineup | null {
  // Only the best scorers can win a spot, plus a few cheap bodies in case the
  // cap forces filler into the last slots.
  const byPoints = [...players].sort((a, b) => pointsOf(b) - pointsOf(a));
  const bySalary = [...players].sort((a, b) => a.salary - b.salary);
  const pool = dedupe([...byPoints.slice(0, TOP_SCORERS), ...bySalary.slice(0, CHEAP_FILLERS)]);
  if (pool.length < slotCount) return null;

  const budget = Math.floor(cap / UNIT);
  if (budget <= 0) return null;
  const needsCaptain = captain.enabled;
  const captainStates = needsCaptain ? 2 : 1;
  const width = (budget + 1) * captainStates;
  const size = (slotCount + 1) * width;

  const index = (k: number, b: number, c: number) => k * width + b * captainStates + c;

  let previous = new Float32Array(size).fill(Number.NEGATIVE_INFINITY);
  let current = new Float32Array(size);
  for (let b = 0; b <= budget; b += 1) previous[index(0, b, 0)] = 0;

  // 0 = not taken, 1 = taken, 2 = taken as captain.
  const choices: Uint8Array[] = [];

  for (const player of pool) {
    const cost = Math.round(player.salary / UNIT);
    const gain = pointsOf(player);
    const captainCost = Math.round(effectiveSalary(player.salary, true, captain.multiplier) / UNIT);
    const captainGain = effectivePoints(gain, true, captain.multiplier);
    const choice = new Uint8Array(size);
    current.set(previous);

    for (let k = 1; k <= slotCount; k += 1) {
      for (let b = 0; b <= budget; b += 1) {
        for (let c = 0; c < captainStates; c += 1) {
          const target = index(k, b, c);

          if (b >= cost) {
            const from = previous[index(k - 1, b - cost, c)];
            if (from > Number.NEGATIVE_INFINITY && from + gain > current[target]) {
              current[target] = from + gain;
              choice[target] = 1;
            }
          }

          if (needsCaptain && c === 1 && b >= captainCost) {
            const from = previous[index(k - 1, b - captainCost, 0)];
            if (from > Number.NEGATIVE_INFINITY && from + captainGain > current[target]) {
              current[target] = from + captainGain;
              choice[target] = 2;
            }
          }
        }
      }
    }

    choices.push(choice);
    const swap = previous;
    previous = current;
    current = swap;
  }

  // Best finished lineup: every slot filled, captain used when required.
  const finalCaptainState = needsCaptain ? 1 : 0;
  let bestBudget = -1;
  let bestPoints = Number.NEGATIVE_INFINITY;
  for (let b = 0; b <= budget; b += 1) {
    const value = previous[index(slotCount, b, finalCaptainState)];
    if (value > bestPoints) {
      bestPoints = value;
      bestBudget = b;
    }
  }
  if (bestBudget < 0 || bestPoints === Number.NEGATIVE_INFINITY) return null;

  // Walk the choices back to recover the lineup.
  const picks: OptimalPick[] = [];
  let k = slotCount;
  let b = bestBudget;
  let c = finalCaptainState;
  for (let i = choices.length - 1; i >= 0 && k > 0; i -= 1) {
    const taken = choices[i][index(k, b, c)];
    if (taken === 0) continue;
    const player = pool[i];
    const isCaptain = taken === 2;
    const salary = effectiveSalary(player.salary, isCaptain, captain.multiplier);
    picks.push({ player, isCaptain, points: effectivePoints(pointsOf(player), isCaptain, captain.multiplier), salary });
    k -= 1;
    b -= Math.round(salary / UNIT);
    if (isCaptain) c = 0;
  }
  if (picks.length !== slotCount) return null;

  return finalize(picks, true);
}

/** Position-locked rosters: fill the scarcest spots first with what fits. */
function greedyFill(
  players: ContestPlayer[],
  slots: RosterSlot[],
  cap: number,
  captain: CaptainRules,
): OptimalLineup | null {
  const used = new Set<string>();
  const chosen: ContestPlayer[] = [];
  let spend = 0;

  const ordered = [...slots].sort(
    (a, b) =>
      players.filter((p) => isEligible(p, a)).length - players.filter((p) => isEligible(p, b)).length,
  );

  for (const slot of ordered) {
    const eligible = players
      .filter((player) => !used.has(player.id) && isEligible(player, slot))
      .sort((a, b) => pointsOf(b) - pointsOf(a));
    const remainingSlots = ordered.length - chosen.length - 1;
    const cheapestRemaining = Math.min(
      ...players.filter((p) => !used.has(p.id)).map((p) => p.salary),
      0,
    );
    const reserve = Math.max(0, remainingSlots) * Math.max(0, cheapestRemaining);
    // Never take a player the cap cannot actually afford; an over-cap lineup is
    // not one anybody could have built.
    const pick =
      eligible.find((player) => spend + player.salary + reserve <= cap) ??
      [...eligible].sort((a, b) => a.salary - b.salary).find((player) => spend + player.salary <= cap);
    if (!pick) continue;
    used.add(pick.id);
    chosen.push(pick);
    spend += pick.salary;
  }
  // A partial or over-cap fill is not a lineup.
  if (chosen.length !== slots.length || spend > cap) return null;

  // Captain whoever gains the most, if the premium fits.
  let captainId: string | null = null;
  if (captain.enabled) {
    const affordable = [...chosen]
      .map((player) => ({
        player,
        premium: effectiveSalary(player.salary, true, captain.multiplier) - player.salary,
        gain: effectivePoints(pointsOf(player), true, captain.multiplier) - pointsOf(player),
      }))
      .filter((row) => spend + row.premium <= cap)
      .sort((a, b) => b.gain - a.gain);
    if (affordable[0]) captainId = affordable[0].player.id;
  }

  const picks = chosen.map((player) => {
    const isCaptain = player.id === captainId;
    return {
      player,
      isCaptain,
      points: effectivePoints(pointsOf(player), isCaptain, captain.multiplier),
      salary: effectiveSalary(player.salary, isCaptain, captain.multiplier),
    };
  });
  return finalize(picks, false);
}

function finalize(picks: OptimalPick[], exact: boolean): OptimalLineup {
  const ordered = [...picks].sort((a, b) => Number(b.isCaptain) - Number(a.isCaptain) || b.points - a.points);
  return {
    picks: ordered,
    totalPoints: Math.round(ordered.reduce((sum, p) => sum + p.points, 0) * 100) / 100,
    totalSalary: ordered.reduce((sum, p) => sum + p.salary, 0),
    exact,
  };
}

function dedupe(players: ContestPlayer[]): ContestPlayer[] {
  const seen = new Set<string>();
  return players.filter((player) => (seen.has(player.id) ? false : (seen.add(player.id), true)));
}
