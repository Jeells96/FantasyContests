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
  // These changes came from the plays since the last round, however long ago
  // that was, so that is the window a play is looked for in. A quiet minute
  // and a worker that has been down for an hour both get the right answer.
  const since = windowStart(contest.lastSyncAt);
  /**
   * A round that covers more than a few minutes is a catch-up, not a play.
   * Whatever a player gained over twenty minutes did not happen on one snap,
   * so no play is named for it: the change is real, where it came from is not
   * something this round can honestly say.
   */
  const catchingUp = Date.now() - since > CATCHUP_MS;
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
    const plays = playsByGame.get(player.gameId) ?? [];
    const play = catchingUp ? undefined : findPlay(player, playsSince(plays, since), game, delta);
    // A change nothing in the feed explains is still this game's news, so it is
    // timed with the game rather than with the clock on the wall.
    const happenedAt = play?.wallclock ?? plays[plays.length - 1]?.wallclock ?? at;
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
      // Only a play this change was actually traced to gets to say where the
      // game stood. Borrowing the game's current down and clock for a change
      // nothing explains is how the feed came to describe the wrong team's
      // possession; an unexplained change now simply says nothing.
      situation: play?.detail,
      clock: play?.clock,
      scoreLine: game
        ? `${game.away.abbreviation} ${awayScore} - ${homeScore} ${game.home.abbreviation}`
        : undefined,
      // Timed by the play, not by the round that noticed it, so the feed reads
      // as the game's own timeline rather than as a sync history.
      at: happenedAt,
    });
  }
  events.sort(byNewestFirst);

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
export function findPlay(
  player: ContestPlayer,
  plays: GamePlay[],
  game: ContestGame | undefined,
  delta: number,
): GamePlay | undefined {
  if (plays.length === 0) return undefined;

  if (isTeamUnit(player)) {
    if (!game) return undefined;
    const opponentId = player.isHome ? game.away.id : game.home.id;
    const theirs = plays.filter(
      (play) => play.offenseTeamId === opponentId && !ADMIN_PLAY.test(play.text ?? ''),
    );
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

  // Football names nobody on the play, so the text is all there is. Only a
  // play this player's own team ran counts: a receiver cannot catch a pass on
  // the other team's possession, and crediting him there is how a scoring feed
  // ends up claiming a team scored while it did not have the ball.
  const key = abbreviatedName(player.name);
  if (key === '') return undefined;
  const candidates: GamePlay[] = [];
  for (let index = plays.length - 1; index >= 0; index -= 1) {
    const play = plays[index];
    if (play.offenseTeamId !== undefined && play.offenseTeamId !== player.teamId) continue;
    if (ADMIN_PLAY.test(play.text ?? '')) continue;
    if (play.text && squash(play.text).includes(key)) candidates.push(play);
  }
  if (candidates.length === 0) return undefined;
  // Two plays can pass between rounds, and a name appears on plays that were
  // worth nothing. Points came from a play that did something, so prefer one.
  if (delta > 0) {
    // Points cannot come from an incompletion. If the window holds nothing
    // that could have earned them, say nothing rather than point at a play
    // that plainly did not.
    return candidates.find((play) => !BLANK_PLAY.test(play.text ?? ''));
  }
  return candidates[0];
}

/** Clock stoppages and quarter breaks: nothing happened, so nothing is credited to them. */
const ADMIN_PLAY = /^\s*(end (quarter|of|game)|timeout|two-minute warning|end game)/i;

/** Plays a name appears on that cannot have earned anybody points. */
const BLANK_PLAY = /incomplete|no gain|kneels|spiked the ball|sacked|penalty|intercepted|fumble/i;

/** Feeds lag the play itself, so the window reaches a little further back. */
const FEED_LAG_MS = 120_000;
/** Past this, a round is catching up on many plays rather than watching one. */
const CATCHUP_MS = 6 * 60_000;
/** However long the gap, a play this far back is not part of this update. */
const WINDOW_CAP = 80;

/** The moment this round's changes could have started happening. */
function windowStart(lastSyncAt: string | null | undefined): number {
  const last = Date.parse(lastSyncAt ?? '');
  // Nothing to go on means everything so far is fair game: the first round of
  // a contest carries the whole game in one go.
  return Number.isFinite(last) ? last - FEED_LAG_MS : 0;
}

/** The plays that happened in this round's window, newest last. */
export function playsSince(plays: GamePlay[], since: number): GamePlay[] {
  const window = plays.filter((play) => {
    const at = Date.parse(play.wallclock ?? '');
    return Number.isFinite(at) ? at >= since : true;
  });
  return window.slice(-WINDOW_CAP);
}

/**
 * A name in the form play-by-play writes it, reduced to letters.
 *
 * "Luther Burden III" and the feed's "L.Burden" both come out as "lburden", so
 * a suffix cannot make a player invisible to his own plays — which it did, and
 * those players then took whatever the game's current situation happened to be.
 * Multi-word surnames survive too: "Amon-Ra St. Brown" matches "A.St. Brown".
 */
function abbreviatedName(name: string): string {
  const withoutSuffix = name.trim().replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/i, '');
  const parts = withoutSuffix.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return squash(parts[0]);
  return squash(parts[0][0] + parts.slice(1).join(''));
}

/** Letters only, lowercased, so punctuation and spacing cannot break a match. */
function squash(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, '');
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
  return [...merged.filter((event) => Math.abs(event.delta) >= MIN_DELTA), ...previous]
    .sort(byNewestFirst)
    .slice(0, SCORING_LOG_LIMIT);
}

/**
 * Newest first by when the play happened. Entries recorded before plays were
 * timed fall back to when they were noticed, and two changes on the same play
 * are ordered by size so the headline of a play leads it.
 */
function byNewestFirst(a: ScoringLogEntry, b: ScoringLogEntry): number {
  const at = Date.parse(b.at) - Date.parse(a.at);
  if (at !== 0 && Number.isFinite(at)) return at;
  return Math.abs(b.delta) - Math.abs(a.delta);
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
