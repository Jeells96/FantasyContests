import { useEffect, useMemo, useState } from 'react';
import { getMyEntry, listMyContestsOnce } from '../lib/db';
import type { Contest, LineupSelection } from '../types';

export interface CopyableLineup {
  contest: Contest;
  lineup: LineupSelection[];
  picks: Record<string, string>;
}

/**
 * What makes two contests take the same lineup: the same games, so the same
 * players at the same prices; the same roster spots to put them in; the same
 * cap; and the same captain rule, since a captain changes what a lineup costs.
 */
export function rulesSignature(contest: Contest): string {
  const games = contest.games.map((game) => game.id).sort().join(',');
  const slots = contest.rosterSlots
    .map((slot) => `${slot.id}:${[...slot.positions].sort().join('/')}`)
    .join(',');
  const captain = contest.captain?.enabled ? `c${contest.captain.multiplier}` : 'c0';
  return `${games}|${slots}|${contest.salaryCapInfo.cap}|${captain}`;
}

export function sameRules(a: Contest, b: Contest): boolean {
  return rulesSignature(a) === rulesSignature(b);
}

/**
 * Lineups this device has already built in other contests with the same rules.
 *
 * Copying one is a one-off: it fills in the draft on this contest, which is a
 * separate entry from then on, so editing either leaves the other alone.
 */
export function useCopyableLineups(contest: Contest | null, uid: string, enabled: boolean): CopyableLineup[] {
  const [found, setFound] = useState<CopyableLineup[]>([]);
  const contestId = contest?.id ?? null;
  // A signature rather than the contest itself, so a live snapshot arriving
  // does not send this looking again.
  const signature = useMemo(() => (contest ? rulesSignature(contest) : ''), [contest]);

  useEffect(() => {
    if (!enabled || !contestId || signature === '') {
      setFound([]);
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const mine = await listMyContestsOnce(uid);
        const candidates = mine.filter(
          (other) => other.id !== contestId && rulesSignature(other) === signature,
        );
        const results: CopyableLineup[] = [];
        for (const candidate of candidates) {
          // Reading one entry by its own id is allowed at any time, unlike
          // listing them all, so this works while both contests are still open.
          const entry = await getMyEntry(candidate.id, uid).catch(() => null);
          if (!entry || entry.lineup.length === 0) continue;
          results.push({ contest: candidate, lineup: entry.lineup, picks: entry.picks ?? {} });
        }
        if (!cancelled) setFound(results);
      } catch {
        // Nothing to offer is a fine outcome; the lineup is built by hand.
        if (!cancelled) setFound([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, contestId, signature, uid]);

  return found;
}
