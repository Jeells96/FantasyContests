import { useEffect, useRef } from 'react';
import { getContest, patchContest } from '../lib/db';
import { deriveStatus } from '../lib/engine/contestState';
import { hasSpread, pickOpen } from '../lib/engine/spread';
import { withSpreads } from '../lib/providers/odds';
import type { Contest } from '../types';

/** How often an open contest looks for lines that have not posted yet. */
const TICK_MS = 120_000;
/** A check this recent means another tab already did it. */
const FRESH_MS = 150_000;

/**
 * Fetch any lines that have not posted yet and store them.
 *
 * Returns how many games got a line. Games that already carry one are never
 * touched, so a line stays frozen at whatever it was when first captured.
 */
export async function pullMissingSpreads(contestId: string): Promise<number> {
  const fresh = await getContest(contestId);
  if (!fresh) throw new Error('That contest no longer exists.');
  if (deriveStatus(fresh) === 'complete') throw new Error('This contest is over.');

  /*
   * Only games that can still be picked, which is not the same as the contest
   * being open. A contest locks when its first game starts; a game tomorrow is
   * still to come, and a line that posts for it is still worth fetching.
   */
  const pending = fresh.games.filter((game) => !hasSpread(game) && pickOpen(game));
  if (pending.length === 0) return 0;

  const filled = await withSpreads(pending);
  const found = new Map(filled.filter((game) => hasSpread(game)).map((game) => [game.id, game.spread]));
  await patchContest(contestId, {
    ...(found.size > 0
      ? {
          games: fresh.games.map((game) =>
            found.has(game.id) ? { ...game, spread: found.get(game.id) ?? null } : game,
          ),
        }
      : {}),
    lastSpreadCheckAt: new Date().toISOString(),
  });
  return found.size;
}

/**
 * Picks up spreads that post after a contest is created.
 *
 * A line is frozen the moment it is captured, exactly as before — this only
 * fills in the games that had no line to freeze yet. Games that already carry
 * one are never touched, and the check stops once every game that can still be
 * picked has a line. It keeps running past the contest's own lock, because a
 * game that has not started is still a game to be called.
 */
export function usePendingSpreads(contest: Contest | null, enabled: boolean): void {
  const running = useRef(false);
  const contestId = contest?.id ?? null;
  const missing =
    Boolean(contest?.gameWinner.enabled) &&
    (contest?.games ?? []).some((game) => !hasSpread(game) && pickOpen(game));

  useEffect(() => {
    if (!enabled || !contestId || !missing) return;
    let cancelled = false;

    async function check(): Promise<void> {
      if (cancelled || running.current) return;
      running.current = true;
      try {
        const fresh = await getContest(contestId!);
        if (!fresh || deriveStatus(fresh) === 'complete') return;
        const pending = fresh.games.filter((game) => !hasSpread(game) && pickOpen(game));
        if (pending.length === 0) return;

        const last = Date.parse(fresh.lastSpreadCheckAt ?? '');
        if (Number.isFinite(last) && Date.now() - last < FRESH_MS) return;

        await pullMissingSpreads(contestId!);
      } catch {
        // The line simply is not out yet; the next check tries again.
      } finally {
        running.current = false;
      }
    }

    void check();
    const timer = window.setInterval(() => void check(), TICK_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled, contestId, missing]);
}
