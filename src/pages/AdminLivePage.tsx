import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Banner, Empty, KeyValue, Spinner, StatusPill } from '../components/ui';
import {
  countEntrants,
  getContest,
  getEntries,
  getPool,
  getStandings,
  patchContest,
  writeLivePool,
} from '../lib/db';
import { allGamesFinal, deriveStatus } from '../lib/engine/contestState';
import { buildLeaderboard, toResults } from '../lib/engine/leaderboard';
import { applyLiveResults } from '../lib/engine/liveSync';
import { fetchLiveForGames } from '../lib/providers';
import { useSession } from '../state/SessionContext';
import type { Contest, ContestPlayer } from '../types';

const INTERVALS = [20, 30, 60, 120];

/**
 * Live scoring control.
 *
 * Polls the sports feeds, converts new statistics into raw and normalized
 * fantasy points and writes them to the contest's player pool. Every connected
 * user then receives the update through Firestore without refreshing. Only the
 * admin session can write these documents, so live statistics and player scores
 * are not user-writable.
 *
 * `scripts/live-sync.mjs` runs the same loop headlessly if you would rather not
 * keep a browser tab open.
 */
export function AdminLivePage() {
  const { contestId } = useParams<{ contestId: string }>();
  const { isAdmin } = useSession();
  const [contest, setContest] = useState<Contest | null>(null);
  const [players, setPlayers] = useState<ContestPlayer[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [interval, setIntervalSeconds] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<number | null>(null);

  const append = useCallback((line: string) => {
    const stamp = new Date().toLocaleTimeString();
    setLog((current) => [`${stamp} · ${line}`, ...current].slice(0, 40));
  }, []);

  const load = useCallback(async () => {
    if (!contestId) return;
    const [next, pool] = await Promise.all([getContest(contestId), getPool(contestId)]);
    setContest(next);
    setPlayers(pool);
    setLoading(false);
  }, [contestId]);

  useEffect(() => {
    void load();
  }, [load]);

  const sync = useCallback(async () => {
    if (!contestId) return;
    setBusy(true);
    setError(null);
    try {
      const current = await getContest(contestId);
      const pool = await getPool(contestId);
      if (!current) throw new Error('Contest missing');

      const live = await fetchLiveForGames(current.games);
      const { games, players: updated, status, scoringPlayers } = applyLiveResults(current, pool, live);

      const chunks = await writeLivePool(contestId, updated);
      const entrants = await countEntrants(contestId).catch(() => current.entrantCount);
      await patchContest(contestId, { games, status, entrantCount: entrants });

      setPlayers(updated);
      setContest({ ...current, games, status, entrantCount: entrants });
      append(
        `Synced ${live.length}/${current.games.length} games · ${scoringPlayers} players scoring · ${chunks} chunk(s) written`,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Sync failed';
      setError(message);
      append(`Error: ${message}`);
    } finally {
      setBusy(false);
    }
  }, [contestId, append]);

  useEffect(() => {
    if (!running) {
      if (timer.current) window.clearInterval(timer.current);
      timer.current = null;
      return;
    }
    void sync();
    timer.current = window.setInterval(() => void sync(), interval * 1000);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
      timer.current = null;
    };
  }, [running, interval, sync]);

  async function finalize() {
    if (!contestId || !contest) return;
    setBusy(true);
    try {
      const [entries, standings] = await Promise.all([getEntries(contestId), getStandings(contestId)]);
      const rows = buildLeaderboard({
        contest,
        standings,
        entries,
        players: new Map(players.map((player) => [player.id, player])),
        selfUid: null,
        locked: true,
      });
      await patchContest(contestId, {
        status: 'complete',
        finalizedAt: new Date().toISOString(),
        results: toResults(rows),
      });
      append(`Finalized with ${rows.length} entries. Winner: ${rows[0]?.displayName ?? 'n/a'}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Finalize failed');
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) {
    return (
      <main className="page">
        <Empty title="Admin only" hint="Unlock the admin area with the PIN first." />
      </main>
    );
  }
  if (loading) {
    return (
      <main className="page">
        <Spinner label="Loading contest…" />
      </main>
    );
  }
  if (!contest) {
    return (
      <main className="page">
        <Empty title="Contest not found" />
      </main>
    );
  }

  const topScorers = [...players]
    .sort((a, b) => (b.normalizedPoints ?? 0) - (a.normalizedPoints ?? 0))
    .slice(0, 12);

  return (
    <main className="page">
      <div className="stack stack--lg">
        <div>
          <Link to="/admin" className="tiny faint">
            ← Admin
          </Link>
          <div className="row row--between" style={{ marginTop: 6 }}>
            <h1 style={{ fontSize: 20, fontWeight: 900 }}>{contest.name}</h1>
            <StatusPill status={deriveStatus(contest)} />
          </div>
        </div>

        {error ? <Banner tone="bad">{error}</Banner> : null}

        <div className="card">
          <div className="section-title">
            <h2 style={{ fontSize: 15 }}>Live sync</h2>
            {busy ? <Spinner /> : null}
          </div>
          <div className="row row--wrap" style={{ gap: 8 }}>
            <button
              type="button"
              className={`btn btn--sm${running ? ' btn--danger' : ' btn--go'}`}
              onClick={() => setRunning((value) => !value)}
            >
              {running ? 'Stop auto-sync' : 'Start auto-sync'}
            </button>
            <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void sync()}>
              Sync once
            </button>
            <select
              className="select"
              style={{ maxWidth: 130 }}
              value={interval}
              aria-label="Sync interval"
              onChange={(event) => setIntervalSeconds(Number(event.target.value))}
            >
              {INTERVALS.map((seconds) => (
                <option key={seconds} value={seconds}>
                  every {seconds}s
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn--sm"
              disabled={busy || !allGamesFinal(contest)}
              onClick={() => void finalize()}
              title={allGamesFinal(contest) ? '' : 'Available once every game is final'}
            >
              Finalize results
            </button>
          </div>
          <p className="tiny faint" style={{ marginBottom: 0, marginTop: 10 }}>
            Keep this tab open while games are running, or run <code>npm run live-sync</code> instead.
          </p>
        </div>

        <div className="card">
          <div className="section-title">
            <h2 style={{ fontSize: 15 }}>Games</h2>
            <span className="tiny faint">{contest.entrantCount} entries</span>
          </div>
          {contest.games.map((game) => (
            <KeyValue
              key={game.id}
              label={`${game.shortName} · ${game.sport.toUpperCase()}`}
              value={
                game.state === 'pre'
                  ? 'scheduled'
                  : `${game.away.score ?? 0}-${game.home.score ?? 0} ${game.statusDetail ?? ''}${
                      game.winnerTeamId
                        ? ` · W ${[game.home, game.away].find((t) => t.id === game.winnerTeamId)?.abbreviation ?? ''}`
                        : ''
                    }`
              }
            />
          ))}
        </div>

        <div className="card">
          <div className="section-title">
            <h2 style={{ fontSize: 15 }}>Top scorers</h2>
          </div>
          <table className="table-mini">
            <thead>
              <tr>
                <th>Player</th>
                <th className="num">Raw</th>
                <th className="num">Contest</th>
              </tr>
            </thead>
            <tbody>
              {topScorers.map((player) => (
                <tr key={player.id}>
                  <td>
                    {player.name}
                    <div className="tiny faint">{player.statLine}</div>
                  </td>
                  <td className="num">{(player.rawPoints ?? 0).toFixed(1)}</td>
                  <td className="num">{(player.normalizedPoints ?? 0).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="section-title">
            <h2 style={{ fontSize: 15 }}>Activity</h2>
          </div>
          {log.length === 0 ? (
            <p className="tiny faint" style={{ margin: 0 }}>
              No syncs yet.
            </p>
          ) : (
            <div className="list">
              {log.map((line, index) => (
                <div className="tiny muted" key={`${line}-${index}`}>
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
