import type { ContestPlayer, RosterSlot, Sport } from '../../types';
import type { PoolPlayer } from '../providers/types';

/** Default roster formats. The admin can rewrite these per contest. */
export const DEFAULT_ROSTERS: Record<Sport, RosterSlot[]> = {
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

/** Trimmed per-sport cores used to compose a multi-sport roster. */
const MULTI_SPORT_CORE: Record<Sport, RosterSlot[]> = {
  nfl: [
    { id: 'qb', label: 'QB', positions: ['QB'] },
    { id: 'rb', label: 'RB', positions: ['RB'] },
    { id: 'wr', label: 'WR', positions: ['WR'] },
    { id: 'nflflex', label: 'NFL FLEX', positions: ['RB', 'WR', 'TE'] },
  ],
  mlb: [
    { id: 'p', label: 'P', positions: ['P'] },
    { id: 'bat1', label: 'BAT', positions: ['*'] },
    { id: 'bat2', label: 'BAT', positions: ['*'] },
  ],
  nba: [
    { id: 'g', label: 'G', positions: ['G', 'PG', 'SG'] },
    { id: 'f', label: 'F', positions: ['F', 'SF', 'PF', 'C'] },
    { id: 'nbautil', label: 'NBA UTIL', positions: ['*'] },
  ],
};

/**
 * Default roster for a set of sports. Single-sport contests get that sport's
 * full format; multi-sport contests get each sport's core, pinned to its sport
 * so a slot can never be filled from the wrong player pool.
 */
export function buildDefaultRoster(sports: Sport[]): RosterSlot[] {
  const unique = Array.from(new Set(sports));
  if (unique.length === 0) return [];
  if (unique.length === 1) return DEFAULT_ROSTERS[unique[0]].map((slot) => ({ ...slot }));
  return unique.flatMap((sport) =>
    MULTI_SPORT_CORE[sport].map((slot) => ({ ...slot, id: `${sport}-${slot.id}`, sport })),
  );
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
  const counts = new Map<string, number>();
  for (const slot of slots) counts.set(slot.label, (counts.get(slot.label) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([label, count]) => (count > 1 ? `${count}×${label}` : label))
    .join(' · ');
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
