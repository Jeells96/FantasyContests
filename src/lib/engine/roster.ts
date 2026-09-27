import type { ContestPlayer, RosterSlot, Sport } from '../../types';
import type { PoolPlayer } from '../providers/types';

/**
 * How many roster spots each sport gets by default.
 *
 * Rosters are positionless: a spot takes any player from the contest's pool.
 * That keeps cross-sport contests simple — there is no need to reconcile an
 * NFL FLEX with an MLB outfielder — and it means the salary cap, rather than a
 * position chart, is what shapes a lineup.
 */
export const DEFAULT_ROSTER_SIZE: Record<Sport, number> = {
  nfl: 9,
  mlb: 11,
  nba: 8,
};

/** Roster size used when a contest spans more than one sport. */
export const MULTI_SPORT_ROSTER_SIZE = 9;

/** `count` interchangeable roster spots. */
export function openRoster(count: number): RosterSlot[] {
  return Array.from({ length: Math.max(1, count) }, (_, index) => ({
    id: `spot${index + 1}`,
    label: `#${index + 1}`,
    positions: ['*'],
  }));
}

/** Default roster formats. The admin can rewrite these per contest. */
export const DEFAULT_ROSTERS: Record<Sport, RosterSlot[]> = {
  nfl: openRoster(DEFAULT_ROSTER_SIZE.nfl),
  mlb: openRoster(DEFAULT_ROSTER_SIZE.mlb),
  nba: openRoster(DEFAULT_ROSTER_SIZE.nba),
};

/**
 * Traditional position-by-position formats. Not used by default, but kept as
 * presets an admin can load when they want a positional contest — the engine
 * enforces whatever positions a slot lists.
 */
export const POSITIONAL_PRESETS: Record<Sport, RosterSlot[]> = {
  nfl: [
    { id: 'qb', label: 'QB', positions: ['QB'] },
    { id: 'rb1', label: 'RB', positions: ['RB'] },
    { id: 'rb2', label: 'RB', positions: ['RB'] },
    { id: 'wr1', label: 'WR', positions: ['WR'] },
    { id: 'wr2', label: 'WR', positions: ['WR'] },
    { id: 'te', label: 'TE', positions: ['TE'] },
    { id: 'flex1', label: 'FLEX', positions: ['RB', 'WR', 'TE'] },
    { id: 'flex2', label: 'FLEX', positions: ['RB', 'WR', 'TE'] },
    { id: 'dst', label: 'DST', positions: ['DST'] },
  ],
  mlb: [
    { id: 'p1', label: 'P', positions: ['P'] },
    { id: 'p2', label: 'P', positions: ['P'] },
    { id: 'c', label: 'C', positions: ['C'] },
    { id: '1b', label: '1B', positions: ['1B'] },
    { id: '2b', label: '2B', positions: ['2B'] },
    { id: '3b', label: '3B', positions: ['3B'] },
    { id: 'ss', label: 'SS', positions: ['SS'] },
    { id: 'of1', label: 'OF', positions: ['OF'] },
    { id: 'of2', label: 'OF', positions: ['OF'] },
    { id: 'of3', label: 'OF', positions: ['OF'] },
    { id: 'util', label: 'UTIL', positions: ['*'] },
  ],
  nba: [
    { id: 'pg', label: 'PG', positions: ['PG'] },
    { id: 'sg', label: 'SG', positions: ['SG'] },
    { id: 'sf', label: 'SF', positions: ['SF'] },
    { id: 'pf', label: 'PF', positions: ['PF'] },
    { id: 'c', label: 'C', positions: ['C'] },
    { id: 'g', label: 'G', positions: ['G', 'PG', 'SG'] },
    { id: 'f', label: 'F', positions: ['F', 'SF', 'PF'] },
    { id: 'util', label: 'UTIL', positions: ['*'] },
  ],
};

/**
 * Default roster for a set of sports: interchangeable spots, sized for the
 * sport. A multi-sport contest gets one shared set of spots, so an entrant can
 * take as many or as few players from each sport as their salary allows.
 */
export function buildDefaultRoster(sports: Sport[]): RosterSlot[] {
  const unique = Array.from(new Set(sports));
  if (unique.length === 0) return [];
  if (unique.length === 1) return openRoster(DEFAULT_ROSTER_SIZE[unique[0]]);
  return openRoster(MULTI_SPORT_ROSTER_SIZE);
}

type EligiblePlayer = Pick<ContestPlayer, 'sport' | 'positions'> | Pick<PoolPlayer, 'sport' | 'positions'>;

/** Can this player legally occupy this slot? */
export function isEligible(player: EligiblePlayer, slot: RosterSlot): boolean {
  if (slot.sport && player.sport !== slot.sport) return false;
  if (slot.positions.includes('*')) return true;
  return player.positions.some((position) => slot.positions.includes(position));
}

/** Slots ordered from most restrictive to least, by eligible-player count. */
export function slotsByScarcity<T extends EligiblePlayer>(slots: RosterSlot[], players: T[]): RosterSlot[] {
  return [...slots].sort(
    (a, b) =>
      players.filter((p) => isEligible(p, a)).length - players.filter((p) => isEligible(p, b)).length,
  );
}

/**
 * Roster demand for each position: a slot that accepts several positions
 * spreads its demand across them, so a UTIL slot does not look like a full
 * extra starter at every position.
 */
export function positionDemand<T extends EligiblePlayer & { position: string }>(
  slots: RosterSlot[],
  players: T[],
): Map<string, number> {
  const demand = new Map<string, number>();
  const positions = Array.from(new Set(players.map((p) => p.position)));
  for (const slot of slots) {
    const eligible = positions.filter((position) =>
      players.some((p) => p.position === position && isEligible(p, slot)),
    );
    if (eligible.length === 0) continue;
    for (const position of eligible) {
      demand.set(position, (demand.get(position) ?? 0) + 1 / eligible.length);
    }
  }
  return demand;
}

export function rosterSummary(slots: RosterSlot[]): string {
  if (slots.length === 0) return 'No roster spots';
  // A positionless roster is described by its size, not by a position chart.
  if (isOpenRoster(slots)) return `${slots.length} roster spots`;
  const counts = new Map<string, number>();
  for (const slot of slots) counts.set(slot.label, (counts.get(slot.label) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([label, count]) => (count > 1 ? `${count}×${label}` : label))
    .join(' · ');
}

/** True when every spot takes any player from the pool. */
export function isOpenRoster(slots: RosterSlot[]): boolean {
  return slots.length > 0 && slots.every((slot) => slot.positions.includes('*') && !slot.sport);
}

/** Roster slots are identified by id; keep them unique when editing. */
export function normalizeSlotIds(slots: RosterSlot[]): RosterSlot[] {
  const seen = new Map<string, number>();
  return slots.map((slot) => {
    const base = slot.id || slot.label.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'slot';
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return { ...slot, id: count === 0 ? base : `${base}${count + 1}` };
  });
}
