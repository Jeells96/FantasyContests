import type { ContestTeam, GameState, StatMap } from '../../types';
import { applyDerivedStats } from '../stats';
import { getJson, mapLimitSettled, toNumber } from './http';
import type {
  GamePlay,
  BuildPoolOptions,
  GameSituation,
  LiveGameStats,
  PoolPlayer,
  ProviderGame,
  SportProvider,
} from './types';

/**
 * MLB provider, backed by the public MLB Stats API.
 *
 * MLB is the one sport where ESPN's box score omits categories this app scores
 * (doubles, triples, stolen bases), so it uses statsapi.mlb.com instead: one
 * request per team returns the active roster plus season and last-10-game
 * splits for hitting and pitching, and one request per game returns a complete
 * live box score.
 */

const API = 'https://statsapi.mlb.com/api/v1';

const LEAGUE_AVERAGE_ERA = 4.1;

const HITTING_MAP: Record<string, string> = {
  atBats: 'ab',
  hits: 'h',
  doubles: 'doubles',
  triples: 'triples',
  homeRuns: 'hr',
  runs: 'r',
  rbi: 'rbi',
  baseOnBalls: 'bb',
  hitByPitch: 'hbp',
  stolenBases: 'sb',
  caughtStealing: 'cs',
  strikeOuts: 'so',
};

const PITCHING_MAP: Record<string, string> = {
  strikeOuts: 'pitchSO',
  wins: 'pitchW',
  earnedRuns: 'pitchER',
  hits: 'pitchH',
  baseOnBalls: 'pitchBB',
  hitByPitch: 'pitchHBP',
  homeRuns: 'pitchHR',
  saves: 'pitchSV',
  holds: 'pitchHLD',
  completeGames: 'pitchCG',
  shutouts: 'pitchSHO',
};

const ELIGIBILITY: Record<string, string[]> = {
  P: ['P'],
  SP: ['P', 'SP'],
  RP: ['P', 'RP'],
  C: ['C'],
  '1B': ['1B'],
  '2B': ['2B'],
  '3B': ['3B'],
  SS: ['SS'],
  LF: ['OF'],
  CF: ['OF'],
  RF: ['OF'],
  OF: ['OF'],
  DH: ['DH'],
  TWP: ['P', 'DH'],
};

function gameStateFrom(status: any): GameState {
  const abstract = String(status?.abstractGameState ?? '').toLowerCase();
  if (abstract === 'live') return 'in';
  if (abstract === 'final') return 'post';
  const coded = String(status?.codedGameState ?? '');
  if (coded === 'F' || coded === 'O') return 'post';
  if (coded === 'I') return 'in';
  return 'pre';
}

/** "145.1" innings pitched -> 436 outs. */
function inningsToOuts(value: unknown): number {
  if (typeof value === 'number') return Math.round(value * 3);
  if (typeof value !== 'string') return 0;
  const [whole, part] = value.split('.');
  return toNumber(whole) * 3 + toNumber(part ?? '0');
}

function statMapFromHitting(stat: any): StatMap {
  const out: StatMap = {};
  for (const [source, canonical] of Object.entries(HITTING_MAP)) {
    const value = stat?.[source];
    if (value === undefined || value === null) continue;
    out[canonical] = toNumber(value);
  }
  return out;
}

function statMapFromPitching(stat: any): StatMap {
  const out: StatMap = {};
  for (const [source, canonical] of Object.entries(PITCHING_MAP)) {
    const value = stat?.[source];
    if (value === undefined || value === null) continue;
    out[canonical] = toNumber(value);
  }
  out.pitchOuts = stat?.outs !== undefined ? toNumber(stat.outs) : inningsToOuts(stat?.inningsPitched);
  return out;
}

function perGame(stats: StatMap, games: number): StatMap {
  if (games <= 0) return {};
  const out: StatMap = {};
  for (const [key, value] of Object.entries(stats)) out[key] = Math.round((value / games) * 100) / 100;
  return out;
}

interface SplitBundle {
  hittingSeason?: any;
  pitchingSeason?: any;
  hittingRecent?: any;
  pitchingRecent?: any;
}

function collectSplits(person: any): SplitBundle {
  const bundle: SplitBundle = {};
  for (const block of person?.stats ?? []) {
    const type = String(block?.type?.displayName ?? '');
    const group = String(block?.group?.displayName ?? '');
    const stat = block?.splits?.[0]?.stat;
    if (!stat) continue;
    if (type === 'season' && group === 'hitting') bundle.hittingSeason = stat;
    if (type === 'season' && group === 'pitching') bundle.pitchingSeason = stat;
    if (type === 'lastXGames' && group === 'hitting') bundle.hittingRecent = stat;
    if (type === 'lastXGames' && group === 'pitching') bundle.pitchingRecent = stat;
  }
  return bundle;
}

export class MlbProvider implements SportProvider {
  readonly sport = 'mlb' as const;

  async listGames(date: string): Promise<ProviderGame[]> {
    const data = await this.fetchSchedule(date, 60_000);
    const games: ProviderGame[] = [];
    for (const day of data?.dates ?? []) {
      for (const game of day?.games ?? []) {
        const parsed = this.parseGame(game);
        if (parsed) games.push(parsed);
      }
    }
    return games;
  }

  private fetchSchedule(date: string, cacheMs: number): Promise<any> {
    return getJson<any>(
      `${API}/schedule?sportId=1&date=${date}&hydrate=team,probablePitcher,linescore`,
      { cacheMs },
    );
  }

  private parseGame(game: any): ProviderGame | null {
    const id = String(game?.gamePk ?? '');
    if (!id) return null;
    const state = gameStateFrom(game?.status);
    const home = this.parseTeam(game?.teams?.home);
    const away = this.parseTeam(game?.teams?.away);
    let winnerTeamId: string | null = null;
    if (game?.teams?.home?.isWinner === true) winnerTeamId = home.id;
    else if (game?.teams?.away?.isWinner === true) winnerTeamId = away.id;
    else if (state === 'post' && home.score !== undefined && away.score !== undefined && home.score !== away.score) {
      winnerTeamId = home.score > away.score ? home.id : away.id;
    }
    return {
      id,
      sport: 'mlb',
      startTime: new Date(game.gameDate).toISOString(),
      shortName: `${away.abbreviation} @ ${home.abbreviation}`,
      state,
      statusDetail: String(game?.status?.detailedState ?? ''),
      winnerTeamId,
      home,
      away,
    };
  }

  private parseTeam(side: any): ContestTeam {
    const team = side?.team ?? {};
    const id = String(team.id ?? '');
    return {
      id,
      abbreviation: team.abbreviation ?? team.teamCode?.toUpperCase() ?? '',
      displayName: team.name ?? team.teamName ?? '',
      logo: id ? `https://www.mlbstatic.com/team-logos/${id}.svg` : undefined,
      score: side?.score !== undefined ? toNumber(side.score) : undefined,
    };
  }

  async buildPool(games: ProviderGame[], options: BuildPoolOptions = {}): Promise<PoolPlayer[]> {
    const relevant = games.filter((g) => g.sport === 'mlb');
    if (relevant.length === 0) return [];
    const progress = options.onProgress ?? (() => {});
    const season = new Date(relevant[0].startTime).getUTCFullYear();

    // Probable starting pitchers, so the pool contains startable pitchers only.
    progress('Loading MLB probable pitchers…');
    const probables = await this.loadProbables(relevant);

    progress('Loading MLB rosters and season splits…');
    const jobs = relevant.flatMap((game) => [
      { game, team: game.home, opponent: game.away, isHome: true },
      { game, team: game.away, opponent: game.home, isHome: false },
    ]);

    const rosters = await mapLimitSettled(jobs, 4, (job) =>
      getJson<any>(
        `${API}/teams/${job.team.id}/roster?rosterType=active` +
          `&hydrate=person(stats(type=[season,lastXGames],limit=10,season=${season}))`,
        { cacheMs: 10 * 60_000 },
      ),
    );

    // First pass: raw entries, so opposing-pitcher context can be applied after.
    interface Draft {
      player: PoolPlayer;
      isPitcher: boolean;
      opponentTeamId: string;
      era: number | null;
    }
    const drafts: Draft[] = [];

    jobs.forEach((job, index) => {
      const roster = rosters[index];
      if (!roster) return;
      for (const entry of roster.roster ?? []) {
        const person = entry?.person ?? {};
        const id = String(person.id ?? '');
        if (!id) continue;
        const rosterPosition = String(entry?.position?.abbreviation ?? '');
        const splits = collectSplits(person);
        const isPitcher = rosterPosition === 'P' || rosterPosition === 'TWP';

        if (isPitcher) {
          const probable = probables.get(job.game.id)?.[job.isHome ? 'home' : 'away'];
          const starts = toNumber(splits.pitchingSeason?.gamesStarted);
          const appearances = toNumber(splits.pitchingSeason?.gamesPlayed);
          const isProbable = probable === id;
          const looksLikeStarter = appearances > 0 && starts / appearances >= 0.5 && starts >= 3;
          // If the probable starter is known, only that pitcher is rosterable.
          if (probable ? !isProbable : !looksLikeStarter) continue;
        }

        const positions = ELIGIBILITY[rosterPosition] ?? [rosterPosition];
        const position = isPitcher ? 'P' : rosterPosition;

        const seasonStat = isPitcher ? splits.pitchingSeason : splits.hittingSeason;
        const recentStat = isPitcher ? splits.pitchingRecent : splits.hittingRecent;
        const gamesPlayed = toNumber(seasonStat?.gamesPlayed);
        const seasonTotals = isPitcher ? statMapFromPitching(seasonStat) : statMapFromHitting(seasonStat);
        const recentGames = toNumber(recentStat?.gamesPlayed);
        const recentTotals = recentStat
          ? isPitcher
            ? statMapFromPitching(recentStat)
            : statMapFromHitting(recentStat)
          : null;

        drafts.push({
          isPitcher,
          opponentTeamId: job.opponent.id,
          era: isPitcher && splits.pitchingSeason ? toNumber(splits.pitchingSeason.era) : null,
          player: {
            id,
            sport: 'mlb',
            name: person.fullName ?? 'Unknown',
            shortName: person.initLastName,
            position,
            positions,
            teamId: job.team.id,
            teamAbbr: job.team.abbreviation,
            opponentAbbr: job.opponent.abbreviation,
            isHome: job.isHome,
            gameId: job.game.id,
            headshot: `https://img.mlbstatic.com/mlb-photos/image/upload/w_240,q_auto:best/v1/people/${id}/headshot/67/current`,
            jersey: entry?.jerseyNumber ? String(entry.jerseyNumber) : undefined,
            injuryStatus: /^(D10|D60|IL|DL)/i.test(String(entry?.status?.code ?? '')) ? 'IL' : undefined,
            seasonStats: applyDerivedStats('mlb', perGame(seasonTotals, gamesPlayed)),
            gamesPlayed,
            recentStats:
              recentTotals && recentGames > 0
                ? applyDerivedStats('mlb', perGame(recentTotals, recentGames))
                : undefined,
            recentGames: recentGames > 0 ? recentGames : undefined,
            contextMultiplier: 1,
          },
        });
      }
    });

    // Second pass: hitters face the opposing probable starter, so use that
    // pitcher's ERA as the game-context adjustment.
    const eraByTeam = new Map<string, number>();
    for (const draft of drafts) {
      if (draft.isPitcher && draft.era !== null && draft.era > 0) {
        eraByTeam.set(`${draft.player.gameId}:${draft.player.teamId}`, draft.era);
      }
    }
    for (const draft of drafts) {
      if (draft.isPitcher) continue;
      const era = eraByTeam.get(`${draft.player.gameId}:${draft.opponentTeamId}`);
      if (era === undefined) continue;
      const multiplier = 1 + (era - LEAGUE_AVERAGE_ERA) * 0.03;
      draft.player.contextMultiplier = Math.min(1.18, Math.max(0.85, multiplier));
    }

    return drafts.map((d) => d.player);
  }

  private async loadProbables(games: ProviderGame[]): Promise<Map<string, { home?: string; away?: string }>> {
    const byDate = new Map<string, ProviderGame[]>();
    for (const game of games) {
      const date = game.startTime.slice(0, 10);
      (byDate.get(date) ?? byDate.set(date, []).get(date)!).push(game);
    }
    const result = new Map<string, { home?: string; away?: string }>();
    for (const date of byDate.keys()) {
      const data = await this.fetchSchedule(date, 5 * 60_000).catch(() => null);
      for (const day of data?.dates ?? []) {
        for (const game of day?.games ?? []) {
          const id = String(game?.gamePk ?? '');
          const home = game?.teams?.home?.probablePitcher?.id;
          const away = game?.teams?.away?.probablePitcher?.id;
          result.set(id, { home: home ? String(home) : undefined, away: away ? String(away) : undefined });
        }
      }
    }
    return result;
  }

  async fetchLive(game: ProviderGame): Promise<LiveGameStats> {
    const date = game.startTime.slice(0, 10);
    const [box, schedule, playByPlay] = await Promise.all([
      getJson<any>(`${API}/game/${game.id}/boxscore`, { cacheMs: 0 }),
      this.fetchSchedule(date, 15_000).catch(() => null),
      // Only worth a request once there are plays to attribute anything to.
      game.state === 'pre'
        ? Promise.resolve(null)
        : getJson<any>(`${API}/game/${game.id}/playByPlay`, { cacheMs: 0 }).catch(() => null),
    ]);

    let state: GameState = game.state;
    let statusDetail = game.statusDetail ?? '';
    let homeScore = 0;
    let awayScore = 0;
    let winnerTeamId: string | null = null;
    let linescore: any = null;

    for (const day of schedule?.dates ?? []) {
      for (const scheduled of day?.games ?? []) {
        if (String(scheduled?.gamePk ?? '') !== game.id) continue;
        state = gameStateFrom(scheduled.status);
        statusDetail = String(scheduled?.status?.detailedState ?? statusDetail);
        homeScore = toNumber(scheduled?.teams?.home?.score);
        awayScore = toNumber(scheduled?.teams?.away?.score);
        linescore = scheduled?.linescore ?? null;
        if (scheduled?.teams?.home?.isWinner === true) winnerTeamId = game.home.id;
        else if (scheduled?.teams?.away?.isWinner === true) winnerTeamId = game.away.id;
      }
    }

    if (!homeScore && !awayScore) {
      homeScore = toNumber(box?.teams?.home?.teamStats?.batting?.runs);
      awayScore = toNumber(box?.teams?.away?.teamStats?.batting?.runs);
    }
    if (!winnerTeamId && state === 'post' && homeScore !== awayScore) {
      winnerTeamId = homeScore > awayScore ? game.home.id : game.away.id;
    }

    const players: Record<string, StatMap> = {};
    for (const side of ['home', 'away'] as const) {
      const entries = box?.teams?.[side]?.players ?? {};
      for (const entry of Object.values<any>(entries)) {
        const id = String(entry?.person?.id ?? '');
        if (!id) continue;
        const batting = entry?.stats?.batting;
        const pitching = entry?.stats?.pitching;
        let stats: StatMap = {};
        if (batting && Object.keys(batting).length > 0) stats = { ...stats, ...statMapFromHitting(batting) };
        if (pitching && Object.keys(pitching).length > 0) stats = { ...stats, ...statMapFromPitching(pitching) };
        if (Object.keys(stats).length === 0) continue;
        players[id] = applyDerivedStats('mlb', stats);
      }
    }

    // "Top 5th" with the count and outs beneath it, the way a ballpark board
    // reads: balls-strikes, then outs.
    const outs = toNumber(linescore?.outs);
    const balls = toNumber(linescore?.balls);
    const strikes = toNumber(linescore?.strikes);
    const inningOrdinal = String(linescore?.currentInningOrdinal ?? '').trim();
    const half = String(linescore?.inningState ?? '').trim();
    const live = state === 'in' && inningOrdinal !== '';
    const situation: GameSituation = {
      awayScore,
      homeScore,
      clock: inningOrdinal ? `${half || ''} ${inningOrdinal}`.trim() : undefined,
      detail: live ? `${balls}-${strikes}, ${outs} out${outs === 1 ? '' : 's'}` : undefined,
    };
    const plays = readPlays(playByPlay, { awayScore, homeScore });

    return { gameId: game.id, state, statusDetail, homeScore, awayScore, winnerTeamId, players, situation, plays };
  }
}

/**
 * The tail of the at-bat feed, oldest first.
 *
 * Baseball names both the batter and the pitcher on every play, so a score
 * change can be pinned to the at-bat that caused it rather than to wherever the
 * game currently stands.
 */
function readPlays(playByPlay: any, scores: { awayScore: number; homeScore: number }): GamePlay[] {
  const all: any[] = Array.isArray(playByPlay?.allPlays) ? playByPlay.allPlays : [];
  if (all.length === 0) return [];
  return all.map((play, index) => {
    const about = play?.about ?? {};
    const count = play?.count ?? {};
    const result = play?.result ?? {};
    const half = String(about.halfInning ?? '');
    const inning = toNumber(about.inning);
    const outs = toNumber(count.outs);
    const athleteIds = [play?.matchup?.batter?.id, play?.matchup?.pitcher?.id]
      .filter((id) => id !== undefined && id !== null)
      .map((id) => String(id));
    return {
      id: String(play?.atBatIndex ?? index),
      detail: `${toNumber(count.balls)}-${toNumber(count.strikes)}, ${outs} out${outs === 1 ? '' : 's'}`,
      clock: inning > 0 ? `${half ? half[0].toUpperCase() + half.slice(1) : ''} ${ordinalInning(inning)}`.trim() : undefined,
      awayScore: typeof result.awayScore === 'number' ? result.awayScore : scores.awayScore,
      homeScore: typeof result.homeScore === 'number' ? result.homeScore : scores.homeScore,
      text: typeof result.description === 'string' ? result.description : undefined,
      athleteIds: athleteIds.length > 0 ? athleteIds : undefined,
      scoring: toNumber(result.rbi) > 0,
      turnover: false,
      wallclock: typeof play?.playEndTime === 'string' ? play.playEndTime : undefined,
    } satisfies GamePlay;
  });
}

function ordinalInning(inning: number): string {
  const rest = inning % 100;
  if (rest >= 11 && rest <= 13) return `${inning}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][inning % 10] ?? 'th';
  return `${inning}${suffix}`;
}
