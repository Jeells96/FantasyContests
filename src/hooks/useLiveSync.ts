import { useEffect, useRef } from 'react';
import { getContest, getPool, patchContest, writeLivePool } from '../lib/db';
import { deriveStatus } from '../lib/engine/contestState';
import { applyLiveResults } from '../lib/engine/liveSync';
import { fetchLiveForGames } from '../lib/providers';
import type { Contest } from '../types';

/** How often a tab considers syncing. */
const TICK_MS = 20_000;
/** A sync this recent means another tab already did the work. */
const FRESH_MS = 25_000;

/**
 * Keeps a live contest scoring without anyone having to run anything.
 *
 * While a contest is live, whichever tabs have it open take turns polling the
 * sports feeds and writing the results back, coordinating through the contest's
 * `lastSyncAt` so they do not all hammer the providers at once. Scoring
 * therefore runs whenever a single participant is watching, instead of
 * depending on an admin leaving a tab open or a worker running somewhere.
 */
export function useLiveSync(contest: Contest | null, enabled: boolean): void {
  const running = useRef(false);

  useEffect(() => {
    if (!enabled || !contest) return;
    const contestId = contest.id;
    let cancelled = false;

    async function tick(): Promise<void> {
      if (cancelled || running.current) return;
      running.current = true;
      try {
        const fresh = await getContest(contestId);
        if (!fresh || deriveStatus(fresh) !== 'live') return;

        const last = Date.parse(fresh.lastSyncAt ?? '');
        if (Number.isFinite(last) && Date.now() - last < FRESH_MS) return;

        // Claim this round before doing the slow part, so other tabs stand down.
        await patchContest(contestId, { lastSyncAt: new Date().toISOString() });

        const pool = await getPool(contestId);
        if (pool.length === 0) return;
        const live = await fetchLiveForGames(fresh.games);
        if (live.length === 0) return;

        const { games, players, status } = applyLiveResults(fresh, pool, live);
        await writeLivePool(contestId, players);
        await patchContest(contestId, { games, status, lastSyncAt: new Date().toISOString() });
      } catch {
        // A failed round is not worth surfacing; the next tick retries.
      } finally {
        running.current = false;
      }
    }

    void tick();
    const timer = window.setInterval(() => void tick(), TICK_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [contest, enabled]);
}
