import { getContest, getEntries, getPool, getStandings, patchContest, writeLivePool } from '../db';
import { deriveStatus } from './contestState';
import { buildLeaderboard, toResults } from './leaderboard';
import { applyLiveResults, mergeScoringLog } from './liveSync';
import { fetchLiveForGames } from '../providers';
import type { Contest, ContestPlayer } from '../../types';

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

  const { games, players, status, lockTime, events } = applyLiveResults(fresh, pool, live);
  await writeLivePool(contestId, players);
  await patchContest(contestId, {
    games,
    status,
    // Only when a game actually moved; patchContest re-derives the lock the
    // security rules compare against from it.
    ...(lockTime ? { lockTime } : {}),
    scoringLog: mergeScoringLog(fresh.scoringLog, events),
    lastSyncAt: new Date().toISOString(),
  });

  if (status === 'complete') await recordResults({ ...fresh, games, status }, players);
  return true;
}

/**
 * Write down who won, once the last game is over.
 *
 * Standings and entries are only ever assembled while someone is looking, so a
 * contest nobody opens again would have no record of its own result — and the
 * contest list has to be able to say who won without rebuilding every finished
 * contest's leaderboard. Finalising by hand already did this; the difference is
 * that a contest now does it for itself when its last game ends.
 *
 * Written once: a result that is already recorded is the one that stands.
 */
async function recordResults(contest: Contest, players: ContestPlayer[]): Promise<void> {
  if (contest.finalizedAt || (contest.results?.length ?? 0) > 0) return;
  try {
    const [entries, standings] = await Promise.all([getEntries(contest.id), getStandings(contest.id)]);
    if (standings.length === 0) return;
    const rows = buildLeaderboard({
      contest,
      standings,
      entries,
      players: new Map(players.map((player) => [player.id, player])),
      selfUid: null,
      locked: true,
    });
    await patchContest(contest.id, {
      finalizedAt: new Date().toISOString(),
      results: toResults(rows),
    });
  } catch {
    // The result is still there to be read from the contest itself; recording
    // it is a convenience for the list, never a thing worth failing a round for.
  }
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
