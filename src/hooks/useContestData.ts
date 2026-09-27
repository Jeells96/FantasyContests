import { useEffect, useMemo, useState } from 'react';
import {
  listenContest,
  listenEntries,
  listenMyEntry,
  listenPool,
  listenStandings,
} from '../lib/db';
import { isContestLocked, deriveStatus } from '../lib/engine/contestState';
import type { Contest, ContestPlayer, Entry, Standing } from '../types';

export interface ContestData {
  contest: Contest | null;
  players: ContestPlayer[];
  playersById: Map<string, ContestPlayer>;
  standings: Standing[];
  entries: Entry[];
  myEntry: Entry | null;
  locked: boolean;
  status: Contest['status'];
  loading: boolean;
  error: string | null;
}

/**
 * Realtime contest state.
 *
 * The entries listener is only attached once the contest has locked, because
 * before that the security rules (correctly) refuse to list other people's
 * lineups. Everything else streams from Firestore, so scores update without the
 * user refreshing.
 */
export function useContestData(contestId: string | undefined, uid: string | null): ContestData {
  const [contest, setContest] = useState<Contest | null>(null);
  const [players, setPlayers] = useState<ContestPlayer[]>([]);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [myEntry, setMyEntry] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!contestId) return;
    setLoading(true);
    const unsubscribers = [
      listenContest(
        contestId,
        (next) => {
          setContest(next);
          setLoading(false);
        },
        (e) => setError(e.message),
      ),
      listenPool(contestId, setPlayers, (e) => setError(e.message)),
      listenStandings(contestId, setStandings, () => undefined),
    ];
    return () => unsubscribers.forEach((fn) => fn());
  }, [contestId]);

  useEffect(() => {
    if (!contestId || !uid) return;
    return listenMyEntry(contestId, uid, setMyEntry, () => undefined);
  }, [contestId, uid]);

  const locked = useMemo(
    () => (contest ? isContestLocked(contest) : false),
    // `tick` re-evaluates the lock as the clock passes the first game time.
    [contest, tick],
  );

  useEffect(() => {
    if (!contest || locked) return;
    const interval = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(interval);
  }, [contest, locked]);

  useEffect(() => {
    if (!contestId || !locked) {
      setEntries([]);
      return;
    }
    return listenEntries(contestId, setEntries, () => undefined);
  }, [contestId, locked]);

  const playersById = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);
  const status = useMemo(() => (contest ? deriveStatus(contest) : 'open'), [contest, tick]);

  return { contest, players, playersById, standings, entries, myEntry, locked, status, loading, error };
}
