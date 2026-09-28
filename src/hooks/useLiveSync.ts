import { useCallback, useEffect, useRef, useState } from 'react';
import { getContest, getPool, patchContest, writeLivePool } from '../lib/db';
import { deriveStatus } from '../lib/engine/contestState';
import { applyLiveResults, mergeScoringLog } from '../lib/engine/liveSync';
import { fetchLiveForGames } from '../lib/providers';
import type { Contest } from '../types';

/** How often a tab considers syncing. */
const TICK_MS = 20_000;
/** A sync this recent means another tab already did the work. */
const FRESH_MS = 25_000;

/** How long the refresh button spins before handing the tab back. */
const ROUND_TIMEOUT_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface LiveSyncControls {
  /** Run a round now, whatever the coordination window says. */
  syncNow: () => void;
  syncing: boolean;
}

/**
 * Keeps a live contest scoring without anyone having to run anything.
 *
 * While a contest is live, whichever tabs have it open take turns polling the
 * sports feeds and writing the results back, coordinating through the contest's
 * `lastSyncAt` so they do not all hammer the providers at once. Scoring
 * therefore runs whenever a single participant is watching, instead of
 * depending on the contest owner leaving a tab open or a worker running somewhere.
 *
 * `syncNow` runs a round straight away and ignores the coordination window, for
 * when somebody would rather not wait for the next tick. The result is written
 * to Firestore like any other round, so one person refreshing updates everyone.
 */
export function useLiveSync(contest: Contest | null, enabled: boolean): LiveSyncControls {
  /** The round currently under way in this tab, if any. */
  const inFlight = useRef<Promise<void> | null>(null);
  const [syncing, setSyncing] = useState(false);
  const contestId = contest?.id ?? null;

  const round = useCallback(
    async function round(force: boolean): Promise<void> {
      if (!contestId) return;
      try {
        const fresh = await getContest(contestId);
        if (!fresh || deriveStatus(fresh) !== 'live') return;

        const last = Date.parse(fresh.lastSyncAt ?? '');
        if (!force && Number.isFinite(last) && Date.now() - last < FRESH_MS) return;

        // Claim this round before doing the slow part, so other tabs stand down.
        await patchContest(contestId, { lastSyncAt: new Date().toISOString() });

        const pool = await getPool(contestId);
        if (pool.length === 0) return;
        const live = await fetchLiveForGames(fresh.games);
        if (live.length === 0) return;

        const { games, players, status, events } = applyLiveResults(fresh, pool, live);
        await writeLivePool(contestId, players);
        await patchContest(contestId, {
          games,
          status,
          scoringLog: mergeScoringLog(fresh.scoringLog, events),
          lastSyncAt: new Date().toISOString(),
        });
      } catch {
        // A failed round is not worth surfacing; the next tick retries.
      }
    },
    [contestId],
  );

  /**
   * One round at a time per tab. An automatic tick stands down while another is
   * running; a manual refresh queues behind it, because dropping the tap would
   * leave the button looking broken.
   */
  const sync = useCallback(
    async function sync(force: boolean): Promise<void> {
      if (!contestId) return;
      if (inFlight.current) {
        if (!force) return;
        await inFlight.current;
      }
      const started = round(force).finally(() => {
        if (inFlight.current === started) inFlight.current = null;
      });
      inFlight.current = started;
      await started;
    },
    [contestId, round],
  );

  useEffect(() => {
    if (!enabled || !contestId) return;
    void sync(false);
    const timer = window.setInterval(() => void sync(false), TICK_MS);
    return () => window.clearInterval(timer);
  }, [enabled, contestId, sync]);

  const syncNow = useCallback(() => {
    void (async () => {
      setSyncing(true);
      try {
        // A write that is never acknowledged must not pin the button; it still
        // lands whenever the connection comes back.
        await Promise.race([sync(true), sleep(ROUND_TIMEOUT_MS)]);
      } finally {
        setSyncing(false);
      }
    })();
  }, [sync]);

  return { syncNow, syncing };
}
