import type { LeaderboardRow } from '../../types';

/**
 * How many teams picked each player.
 *
 * The interesting thing about a lineup is rarely one player's score — it is
 * whether everyone else has him too. A player on every roster is the floor of
 * the contest, and one nobody else took is where a lead actually comes from.
 *
 * Only rosters that can be seen are counted, so the fraction never implies
 * knowledge of entries that are still hidden before lock.
 */
export interface Ownership {
  /** playerId -> number of teams holding them. */
  byPlayer: Map<string, number>;
  /** How many teams the count is out of. */
  teams: number;
}

export function ownershipOf(rows: Pick<LeaderboardRow, 'lines'>[]): Ownership {
  const byPlayer = new Map<string, number>();
  let teams = 0;
  for (const row of rows) {
    if (!row.lines) continue;
    teams += 1;
    // A roster counts once per player however many slots they fill.
    const seen = new Set<string>();
    for (const line of row.lines) {
      const id = line.player?.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      byPlayer.set(id, (byPlayer.get(id) ?? 0) + 1);
    }
  }
  return { byPlayer, teams };
}
