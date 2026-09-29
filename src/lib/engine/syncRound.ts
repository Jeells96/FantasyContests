import { getContest, getPool, patchContest, writeLivePool } from '../db';
import { deriveStatus } from './contestState';
import { applyLiveResults, mergeScoringLog } from './liveSync';
import { fetchLiveForGames } from '../providers';

/** A sync this recent means another tab already did the work. */
export const FRESH_MS = 25_000;

/**
 * One round of live scoring for one contest.
 *
 * Reads the feeds, folds them into the contest's pool and writes the result, so
 * every other open page gets it through Firestore. Tabs coordinate through the
 * contest's own `lastSyncAt`: whoever claims the round does the work and the
 * rest stand down, which keeps a group of viewers from all polling at once.
 *
 * Returns whether this call actually did a round, so a caller can tell "somebody
 * else has it" from "done".
 */
export async function runSyncRound(contestId: string, force = false): Promise<boolean> {
  const fresh = await getContest(contestId);
  if (!fresh || deriveStatus(fresh) !== 'live') return false;

  const last = Date.parse(fresh.lastSyncAt ?? '');
  if (!force && Number.isFinite(last) && Date.now() - last < FRESH_MS) return false;

  // Claim this round before doing the slow part, so other tabs stand down.
  await patchContest(contestId, { lastSyncAt: new Date().toISOString() });

  const pool = await getPool(contestId);
  if (pool.length === 0) return false;
  const live = await fetchLiveForGames(fresh.games);
  if (live.length === 0) return false;

  const { games, players, status, events } = applyLiveResults(fresh, pool, live);
  await writeLivePool(contestId, players);
  await patchContest(contestId, {
    games,
    status,
    scoringLog: mergeScoringLog(fresh.scoringLog, events),
    lastSyncAt: new Date().toISOString(),
  });
  return true;
}

/**
 * Stop waiting on a round after `ms`.
 *
 * Every step of a round can hang indefinitely — a phone that sleeps or loses
 * signal mid-write leaves a promise that never settles. Whatever it was doing
 * carries on and may still land; what matters is that the next round is free to
 * start, because a round waited on forever stops scoring for good.
 */
export function withDeadline<T>(work: Promise<T>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    void work
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timer);
        resolve();
      });
  });
}
