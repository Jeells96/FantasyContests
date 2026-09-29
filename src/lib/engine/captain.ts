import type { Contest, ContestPlayer, LineupSelection } from '../../types';

/**
 * Team captain.
 *
 * One player on a roster can be made captain. Their salary and their fantasy
 * points are both multiplied by the same factor, so promoting a star costs real
 * cap space and promoting a cheap player is a genuine gamble rather than a free
 * bonus.
 */

export const DEFAULT_CAPTAIN_MULTIPLIER = 1.5;

export function captainEnabled(contest: Pick<Contest, 'captain'> | null | undefined): boolean {
  return Boolean(contest?.captain?.enabled);
}

export function captainMultiplier(contest: Pick<Contest, 'captain'> | null | undefined): number {
  const value = contest?.captain?.multiplier;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_CAPTAIN_MULTIPLIER;
}

/** Salary charged for a player, including the captain premium. */
export function effectiveSalary(baseSalary: number, isCaptain: boolean, multiplier: number): number {
  return isCaptain ? Math.round(baseSalary * multiplier) : baseSalary;
}

/** Fantasy points credited for a player, including the captain bonus. */
export function effectivePoints(points: number, isCaptain: boolean, multiplier: number): number {
  return isCaptain ? Math.round(points * multiplier * 100) / 100 : points;
}

export function captainIdOf(lineup: LineupSelection[]): string | null {
  return lineup.find((line) => line.captain)?.playerId ?? null;
}

/** The extra cap space promoting this player would take. */
export function captainPremium(player: ContestPlayer, multiplier: number): number {
  return effectiveSalary(player.salary, true, multiplier) - player.salary;
}

/**
 * Captain first, then the rest most expensive to cheapest.
 *
 * Price is the order a roster is read in — the big names at the top — so every
 * place a lineup is shown uses this rather than the order the spots happen to
 * be in. Empty spots sit at the end, since they cost nothing.
 */
export function captainFirst<T extends { isCaptain: boolean; salary?: number }>(lines: T[]): T[] {
  return [...lines].sort(
    (a, b) => Number(b.isCaptain) - Number(a.isCaptain) || (b.salary ?? 0) - (a.salary ?? 0),
  );
}
