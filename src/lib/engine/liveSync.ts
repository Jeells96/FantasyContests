import type { Contest, ContestGame, ContestPlayer, ScoringLogEntry } from '../../types';
import type { GamePlay, LiveGameStats } from '../providers/types';
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
  /** Point increases in this round, newest first. */
  events: ScoringLogEntry[];
}

/** Ignore rounding noise; only real scoring is logged. */
const MIN_DELTA = 0.05;
/** How much of the feed the contest keeps. */
export const SCORING_LOG_LIMIT = 80;

/**
 * Fold a round of live feed results into a contest's games and player pool.
 *
 * Pure so the same code path runs in a browser tab and in the headless
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
      situation: result.situation
        ? { detail: result.situation.detail, clock: result.situation.clock }
        : game.situation ?? null,
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

  // Compare against what the pool held before this round to build the feed.
  const previousPoints = new Map(pool.map((player) => [player.id, player.normalizedPoints ?? 0]));
  const situations = new Map(live.map((result) => [result.gameId, result.situation]));
  const playsByGame = new Map(live.map((result) => [result.gameId, result.plays ?? []]));
  const gamesById = new Map(games.map((game) => [game.id, game]));
  const at = new Date().toISOString();
  const events: ScoringLogEntry[] = [];
  for (const player of players) {
    const before = previousPoints.get(player.id) ?? 0;
    const after = player.normalizedPoints ?? 0;
    const delta = round2(after - before);
    // Losses count too: a defense giving up a touchdown is scoring news.
    if (Math.abs(delta) < MIN_DELTA) continue;
    const situation = situations.get(player.gameId);
    const game = gamesById.get(player.gameId);
    // The play that moved this player, not wherever the game happens to be now:
    // one round of syncing usually spans several plays.
    const play = findPlay(player, playsByGame.get(player.gameId) ?? [], game);
    const awayScore = play?.awayScore ?? situation?.awayScore ?? game?.away.score ?? 0;
    const homeScore = play?.homeScore ?? situation?.homeScore ?? game?.home.score ?? 0;
    events.push({
      id: `${player.id}-${at}`,
      playerId: player.id,
      playerName: player.name,
      teamAbbr: player.teamAbbr,
      sport: player.sport,
      headshot: player.headshot,
      delta,
      total: round2(after),
      statLine: player.statLine,
      playId: play ? `${player.gameId}-${play.id}` : undefined,
      situation: play?.detail ?? situation?.detail,
      clock: play?.clock ?? situation?.clock,
      scoreLine: game
        ? `${game.away.abbreviation} ${awayScore} - ${homeScore} ${game.home.abbreviation}`
        : undefined,
      at,
    });
  }
  events.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return {
    games,
    players,
    status: deriveStatus({ ...contest, games }),
    scoringPlayers: players.filter((player) => (player.normalizedPoints ?? 0) !== 0).length,
    events,
  };
}


/** Team units score off their opponent's plays, so they match differently. */
function isTeamUnit(player: ContestPlayer): boolean {
  return player.position === 'DST' || player.isTeamUnit === true;
}

/**
 * Which play moved this player's score.
 *
 * Basketball and baseball name the athletes on a play outright. Football does
 * not, so the play text is matched against the abbreviated name it uses
 * ("K.Williams"), then the full name. A team defense is matched to its
 * opponent's last consequential play instead, since that is what its score
 * moves on.
 */
function findPlay(
  player: ContestPlayer,
  plays: GamePlay[],
  game: ContestGame | undefined,
): GamePlay | undefined {
  if (plays.length === 0) return undefined;

  if (isTeamUnit(player)) {
    if (!game) return undefined;
    const opponentId = player.isHome ? game.away.id : game.home.id;
    const theirs = plays.filter((play) => play.offenseTeamId === opponentId);
    if (theirs.length === 0) return undefined;
    const consequential = theirs.filter(
      (play) => play.scoring || play.turnover || /sack|safety|blocked/i.test(play.text ?? ''),
    );
    const candidates = consequential.length > 0 ? consequential : theirs;
    return candidates[candidates.length - 1];
  }

  for (let index = plays.length - 1; index >= 0; index -= 1) {
    if (plays[index].athleteIds?.includes(player.id)) return plays[index];
  }

  const patterns = namePatterns(player.name);
  if (patterns.length === 0) return undefined;
  for (let index = plays.length - 1; index >= 0; index -= 1) {
    const text = plays[index].text;
    if (text && patterns.some((pattern) => text.includes(pattern))) return plays[index];
  }
  return undefined;
}

/** "Kyren Williams" -> ["K.Williams", "Kyren Williams"], the forms feeds use. */
function namePatterns(name: string): string[] {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ? [parts[0]] : [];
  const last = parts[parts.length - 1];
  return [`${parts[0][0]}.${last}`, name.trim()];
}

/** Newest first, oldest trimmed. */
export function mergeScoringLog(existing: ScoringLogEntry[] | undefined, events: ScoringLogEntry[]): ScoringLogEntry[] {
  if (events.length === 0) return existing ?? [];
  // A stat correction arriving a round later belongs to the play it corrects,
  // so fold it into that row instead of listing the same play twice.
  const previous = [...(existing ?? [])];
  const merged: ScoringLogEntry[] = [];
  for (const event of events) {
    const index = event.playId
      ? previous.findIndex((row) => row.playerId === event.playerId && row.playId === event.playId)
      : -1;
    if (index === -1) {
      merged.push(event);
      continue;
    }
    const [older] = previous.splice(index, 1);
    merged.push({ ...event, delta: round2(older.delta + event.delta) });
  }
  return [...merged.filter((event) => Math.abs(event.delta) >= MIN_DELTA), ...previous].slice(0, SCORING_LOG_LIMIT);
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
