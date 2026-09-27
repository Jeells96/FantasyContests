import type { Contest, ContestGame, ContestPlayer } from '../../types';
import type { LiveGameStats } from '../providers/types';
import { computeRawFantasyPoints } from '../scoring';
import { formatStatLine, hasActivity } from '../stats';
import { normalizationFactor } from './normalization';
import { deriveStatus } from './contestState';

export interface LiveSyncResult {
  games: ContestGame[];
  players: ContestPlayer[];
  status: Contest['status'];
  /** Players currently holding a non-zero score. */
  scoringPlayers: number;
}

/**
 * Fold a round of live feed results into a contest's games and player pool.
 *
 * Pure so the same code path runs in the admin browser tab and in the headless
 * worker: raw fantasy points come from the contest's own scoring table, and the
 * normalized contest points are the raw points times the sport's frozen
 * normalization factor. Both are stored.
 */
export function applyLiveResults(
  contest: Contest,
  pool: ContestPlayer[],
  live: LiveGameStats[],
): LiveSyncResult {
  const byGame = new Map(live.map((result) => [result.gameId, result]));

  const games: ContestGame[] = contest.games.map((game) => {
    const result = byGame.get(game.id);
    if (!result) return game;
    return {
      ...game,
      state: result.state,
      statusDetail: result.statusDetail,
      winnerTeamId: result.winnerTeamId,
      home: { ...game.home, score: result.homeScore },
      away: { ...game.away, score: result.awayScore },
    };
  });

  const stateByGame = new Map(games.map((game) => [game.id, game.state]));

  const players: ContestPlayer[] = pool.map((player) => {
    const result = byGame.get(player.gameId);
    const stats = result?.players[player.id];
    const table = contest.scoring[player.sport];
    const raw = stats ? computeRawFantasyPoints(stats, table) : player.rawPoints ?? 0;
    const factor = normalizationFactor(contest.normalization, player.sport);
    return {
      ...player,
      liveStats: stats ?? player.liveStats,
      rawPoints: round2(raw),
      normalizedPoints: round2(raw * factor),
      started: (stateByGame.get(player.gameId) ?? 'pre') !== 'pre',
      statLine: hasActivity(stats) ? formatStatLine(player.sport, player.position, stats) : player.statLine,
    };
  });

  return {
    games,
    players,
    status: deriveStatus({ ...contest, games }),
    scoringPlayers: players.filter((player) => (player.normalizedPoints ?? 0) !== 0).length,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Deterministic signature of the live-scoring fields in a pool chunk.
 *
 * Used to skip writing chunks that did not change. It must not depend on object
 * key order, because a chunk read back from Firestore does not necessarily
 * serialise its stat maps in the same order as the locally built one — comparing
 * raw JSON would report every chunk as changed on every poll.
 */
export function poolChunkSignature(players: ContestPlayer[]): string {
  return players
    .map((player) => {
      const stats = player.liveStats
        ? Object.keys(player.liveStats)
            .sort()
            .map((key) => `${key}=${player.liveStats?.[key]}`)
            .join(',')
        : '';
      return [
        player.id,
        player.rawPoints ?? 0,
        player.normalizedPoints ?? 0,
        player.started ? 1 : 0,
        player.salary,
        stats,
      ].join('|');
    })
    .join(';');
}
