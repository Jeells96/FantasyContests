import { useCallback, useEffect, useRef, useState } from 'react';
import { runSyncRound, withDeadline } from '../lib/engine/syncRound';
import type { Contest } from '../types';

/** How often a tab considers syncing. */
const TICK_MS = 20_000;
/** A round that has not finished by now is abandoned, not waited on. */
const ROUND_LIMIT_MS = 45_000;
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
 * sports feeds and writing the results back. Scoring therefore runs whenever a
 * single participant is watching, instead of depending on the contest owner
 * leaving a tab open or a worker running somewhere.
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

  /**
   * One round at a time per tab. An automatic tick stands down while another is
   * running; a manual refresh queues behind it, because dropping the tap would
   * leave the button looking broken. Every round is time-boxed, so a request
   * that never comes back cannot leave this tab standing down for ever.
   */
  const sync = useCallback(
    async function sync(force: boolean): Promise<void> {
      if (!contestId) return;
      if (inFlight.current) {
        if (!force) return;
        await inFlight.current;
      }
      const started = withDeadline(runSyncRound(contestId, force), ROUND_LIMIT_MS).finally(() => {
        if (inFlight.current === started) inFlight.current = null;
      });
      inFlight.current = started;
      await started;
    },
    [contestId],
  );

  useEffect(() => {
    if (!enabled || !contestId) return;
    void sync(false);
    const timer = window.setInterval(() => void sync(false), TICK_MS);

    // A phone freezes this page the moment it sleeps or the app goes to the
    // background, and the interval goes with it. Coming back is when the scores
    // are most out of date, so catch up then rather than up to a tick later —
    // and likewise when the connection returns.
    const resume = () => {
      if (document.visibilityState === 'visible') void sync(false);
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
    };
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

/**
 * Keeps every live contest on this page scoring.
 *
 * The contests list is the other page people leave open, so it drives scoring
 * too. Rounds are claimed through the same `lastSyncAt`, so a contest being
 * watched by somebody on its own page is simply skipped here.
 */
export function useLiveContestsSync(contests: Contest[] | null, enabled = true): void {
  const running = useRef(false);
  const ids = (contests ?? [])
    .filter((contest) => contest.status === 'live')
    .map((contest) => contest.id)
    .join(',');

  useEffect(() => {
    if (!enabled || ids === '') return;
    let cancelled = false;

    async function tick(): Promise<void> {
      if (cancelled || running.current) return;
      running.current = true;
      try {
        for (const id of ids.split(',')) {
          if (cancelled) break;
          await withDeadline(runSyncRound(id), ROUND_LIMIT_MS);
        }
      } finally {
        running.current = false;
      }
    }

    void tick();
    const timer = window.setInterval(() => void tick(), TICK_MS);
    const resume = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
    };
  }, [ids, enabled]);
}
