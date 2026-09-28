import type { GameState, Sport, StatMap } from '../../types';
import { applyDerivedStats } from '../stats';
import { getJson, mapLimit, mapLimitSettled, splitComposite, toNumber } from './http';
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
 * ESPN provider, used for NFL and NBA.
 *
 * Endpoints (all public, CORS-enabled, no key required):
 *   scoreboard   games for a date
 *   summary      live box score, odds, final status for one game
 *   roster       the players on a team, with headshots and positions
 *   byathlete    season totals for every athlete in the league (1-2 requests)
 *   gamelog      per-game logs for one athlete (recent form)
 */

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const WEB = 'https://site.web.api.espn.com/apis/common/v3/sports';

interface EspnSportConfig {
  path: string;
  /** Fantasy-relevant positions kept in the pool. */
  keepPositions: string[];
  /** Extra eligibility granted by a player's listed position. */
  eligibility: Record<string, string[]>;
  seasonMap: Record<string, string>;
  boxMap: Record<string, string>;
  /** Box score categories are namespaced by category name. */
  namespacedBox: boolean;
  /** League average implied team total, for the game-context multiplier. */
  leagueAverageTeamTotal: number;
}

const NFL_CONFIG: EspnSportConfig = {
  path: 'football/nfl',
  keepPositions: ['QB', 'RB', 'FB', 'WR', 'TE', 'PK', 'K'],
  eligibility: {
    QB: ['QB'],
    RB: ['RB'],
    FB: ['RB'],
    WR: ['WR'],
    TE: ['TE'],
    PK: ['K'],
    K: ['K'],
  },
  seasonMap: {
    'passing.completions': 'passCmp',
    'passing.passingAttempts': 'passAtt',
    'passing.passingYards': 'passYds',
    'passing.passingTouchdowns': 'passTD',
    'passing.interceptions': 'passInt',
    'rushing.rushingAttempts': 'rushAtt',
    'rushing.rushingYards': 'rushYds',
    'rushing.rushingTouchdowns': 'rushTD',
    'rushing.rushingFumblesLost': 'fumLost',
    'receiving.receptions': 'rec',
    'receiving.receivingTargets': 'targets',
    'receiving.receivingYards': 'recYds',
    'receiving.receivingTouchdowns': 'recTD',
    'receiving.receivingFumblesLost': 'fumLost',
    'scoring.totalTwoPointConvs': 'twoPt',
    'returning.kickReturnTouchdowns': 'krTD',
    'returning.puntReturnTouchdowns': 'prTD',
    'kicking.fieldGoalsMade': 'fgMade',
    'kicking.fieldGoalAttempts': 'fgAtt',
    'kicking.extraPointsMade': 'xpMade',
    'kicking.extraPointAttempts': 'xpAtt',
  },
  boxMap: {
    'passing.completions': 'passCmp',
    'passing.passingAttempts': 'passAtt',
    'passing.passingYards': 'passYds',
    'passing.passingTouchdowns': 'passTD',
    'passing.interceptions': 'passInt',
    'rushing.rushingAttempts': 'rushAtt',
    'rushing.rushingYards': 'rushYds',
    'rushing.rushingTouchdowns': 'rushTD',
    'receiving.receptions': 'rec',
    'receiving.receivingTargets': 'targets',
    'receiving.receivingYards': 'recYds',
    'receiving.receivingTouchdowns': 'recTD',
    'fumbles.fumblesLost': 'fumLost',
    'kicking.fieldGoalsMade': 'fgMade',
    'kicking.fieldGoalAttempts': 'fgAtt',
    'kicking.extraPointsMade': 'xpMade',
    'kicking.extraPointAttempts': 'xpAtt',
    'kickReturns.kickReturnTouchdowns': 'krTD',
    'puntReturns.puntReturnTouchdowns': 'prTD',
  },
  namespacedBox: true,
  leagueAverageTeamTotal: 22.5,
};

const NBA_CONFIG: EspnSportConfig = {
  path: 'basketball/nba',
  keepPositions: ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'GF', 'FC'],
  eligibility: {
    PG: ['PG', 'G'],
    SG: ['SG', 'G'],
    SF: ['SF', 'F'],
    PF: ['PF', 'F'],
    C: ['C'],
    G: ['G', 'PG', 'SG'],
    F: ['F', 'SF', 'PF'],
    GF: ['G', 'F', 'SG', 'SF'],
    FC: ['F', 'C', 'PF'],
  },
  seasonMap: {
    'general.minutes': 'min',
    'general.rebounds': 'reb',
    'general.fouls': 'pf',
    'general.doubleDouble': 'dd',
    'general.tripleDouble': 'td3',
    'offensive.points': 'pts',
    'offensive.fieldGoalsMade': 'fgm',
    'offensive.fieldGoalsAttempted': 'fga',
    'offensive.threePointFieldGoalsMade': 'fg3m',
    'offensive.threePointFieldGoalsAttempted': 'fg3a',
    'offensive.freeThrowsMade': 'ftm',
    'offensive.freeThrowsAttempted': 'fta',
    'offensive.assists': 'ast',
    'offensive.turnovers': 'tov',
    'defensive.steals': 'stl',
    'defensive.blocks': 'blk',
  },
  boxMap: {
    minutes: 'min',
    points: 'pts',
    fieldGoalsMade: 'fgm',
    fieldGoalsAttempted: 'fga',
    threePointFieldGoalsMade: 'fg3m',
    threePointFieldGoalsAttempted: 'fg3a',
    freeThrowsMade: 'ftm',
    freeThrowsAttempted: 'fta',
    rebounds: 'reb',
    offensiveRebounds: 'oreb',
    defensiveRebounds: 'dreb',
    assists: 'ast',
    turnovers: 'tov',
    steals: 'stl',
    blocks: 'blk',
    fouls: 'pf',
  },
  namespacedBox: false,
  leagueAverageTeamTotal: 113,
};

const CONFIGS: Partial<Record<Sport, EspnSportConfig>> = { nfl: NFL_CONFIG, nba: NBA_CONFIG };

/** League-average NFL team defense production per game, used for D/ST baselines. */
/** ESPN pays a field goal by how far it was. */
function fieldGoalBand(yards: number): string {
  if (yards >= 60) return 'fgMade60';
  if (yards >= 50) return 'fgMade50_59';
  if (yards >= 40) return 'fgMade40_49';
  return 'fgMade0_39';
}

const DST_BASELINE: StatMap = { dstSack: 2.4, dstInt: 0.75, dstFumRec: 0.55, dstTD: 0.15 };

interface EspnCategory {
  name?: string;
  keys?: string[];
  names?: string[];
  labels?: string[];
  athletes?: { athlete?: { id?: string }; stats?: string[]; didNotPlay?: boolean }[];
}

function statesFromEspn(state: string | undefined): GameState {
  if (state === 'in') return 'in';
  if (state === 'post') return 'post';
  return 'pre';
}

/**
 * Season used for season-long averages. NFL seasons are labelled with the
 * calendar year they start in, NBA seasons with the year they end in.
 */
export function seasonForDate(sport: Sport, date: Date): number {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  if (sport === 'nba') return month >= 9 ? year + 1 : year;
  if (sport === 'nfl') return month >= 3 ? year : year - 1;
  return year;
}

export class EspnProvider implements SportProvider {
  readonly sport: Sport;
  private readonly config: EspnSportConfig;

  constructor(sport: Sport) {
    const config = CONFIGS[sport];
    if (!config) throw new Error(`EspnProvider does not support ${sport}`);
    this.sport = sport;
    this.config = config;
  }

  async listGames(date: string): Promise<ProviderGame[]> {
    const compact = date.replace(/-/g, '');
    const data = await getJson<{ events?: unknown[] }>(
      `${SITE}/${this.config.path}/scoreboard?dates=${compact}&limit=100`,
      { cacheMs: 60_000 },
    );
    const events = Array.isArray(data.events) ? data.events : [];
    return events.map((event) => this.parseEvent(event)).filter((g): g is ProviderGame => g !== null);
  }

  private parseEvent(raw: unknown): ProviderGame | null {
    const event = raw as Record<string, any>;
    const competition = event?.competitions?.[0];
    if (!competition || !event?.id) return null;
    const competitors: any[] = competition.competitors ?? [];
    const home = competitors.find((c) => c.homeAway === 'home');
    const away = competitors.find((c) => c.homeAway === 'away');
    if (!home || !away) return null;
    const status = competition.status ?? event.status ?? {};
    const state = statesFromEspn(status?.type?.state);
    const winner = competitors.find((c) => c.winner === true);
    return {
      id: String(event.id),
      sport: this.sport,
      startTime: new Date(event.date).toISOString(),
      shortName: event.shortName ?? `${away.team?.abbreviation} @ ${home.team?.abbreviation}`,
      state,
      statusDetail: status?.type?.shortDetail ?? '',
      winnerTeamId: winner ? String(winner.id) : null,
      home: this.parseTeam(home),
      away: this.parseTeam(away),
    };
  }

  private parseTeam(competitor: any) {
    return {
      id: String(competitor.id ?? competitor.team?.id ?? ''),
      abbreviation: competitor.team?.abbreviation ?? '',
      displayName: competitor.team?.displayName ?? competitor.team?.name ?? '',
      logo: competitor.team?.logo ?? competitor.team?.logos?.[0]?.href,
      score: competitor.score !== undefined ? toNumber(competitor.score) : undefined,
    };
  }

  async buildPool(games: ProviderGame[], options: BuildPoolOptions = {}): Promise<PoolPlayer[]> {
    const relevant = games.filter((g) => g.sport === this.sport);
    if (relevant.length === 0) return [];
    const progress = options.onProgress ?? (() => {});

    const season = seasonForDate(this.sport, new Date(relevant[0].startTime));
    progress(`Loading ${this.sport.toUpperCase()} season statistics…`);
    const seasonStats = await this.loadSeasonStats(season);
    const priorStats = await this.loadSeasonStats(season - 1).catch(() => new Map<string, SeasonEntry>());

    progress(`Reading game context for ${relevant.length} ${this.sport.toUpperCase()} game(s)…`);
    const contexts = await this.loadGameContexts(relevant);

    progress('Loading rosters…');
    const teamJobs = relevant.flatMap((game) => [
      { game, team: game.home, opponent: game.away, isHome: true },
      { game, team: game.away, opponent: game.home, isHome: false },
    ]);

    const rosters = await mapLimitSettled(teamJobs, 4, (job) =>
      getJson<any>(`${SITE}/${this.config.path}/teams/${job.team.id}/roster`, { cacheMs: 10 * 60_000 }),
    );

    const players: PoolPlayer[] = [];
    teamJobs.forEach((job, index) => {
      const roster = rosters[index];
      if (!roster) return;
      const context = contexts.get(job.game.id);
      const impliedFor = job.isHome ? context?.homeImplied : context?.awayImplied;
      const impliedAgainst = job.isHome ? context?.awayImplied : context?.homeImplied;
      const multiplier = impliedFor ? clamp(impliedFor / this.config.leagueAverageTeamTotal, 0.78, 1.25) : 1;

      for (const athlete of extractAthletes(roster)) {
        const position: string = athlete?.position?.abbreviation ?? '';
        if (!this.config.keepPositions.includes(position)) continue;
        if (isUnavailable(athlete)) continue;
        const id = String(athlete.id ?? '');
        if (!id) continue;
        const entry = pickSeasonEntry(seasonStats.get(id), priorStats.get(id));
        players.push({
          id,
          sport: this.sport,
          name: athlete.fullName ?? athlete.displayName ?? 'Unknown',
          shortName: athlete.shortName,
          position,
          positions: this.config.eligibility[position] ?? [position],
          teamId: job.team.id,
          teamAbbr: job.team.abbreviation,
          opponentAbbr: job.opponent.abbreviation,
          isHome: job.isHome,
          gameId: job.game.id,
          headshot: athlete.headshot?.href,
          jersey: athlete.jersey ? String(athlete.jersey) : undefined,
          injuryStatus: injuryLabel(athlete),
          seasonStats: entry.perGame,
          gamesPlayed: entry.gamesPlayed,
          contextMultiplier: multiplier,
          impliedPointsAgainst: impliedAgainst,
        });
      }

      if (this.sport === 'nfl') {
        players.push(this.buildTeamDefense(job, impliedAgainst));
      }
    });

    await this.enrichRecentForm(players, season, options, progress);
    return players;
  }

  private buildTeamDefense(
    job: { game: ProviderGame; team: { id: string; abbreviation: string; displayName: string; logo?: string }; opponent: { abbreviation: string }; isHome: boolean },
    impliedAgainst: number | undefined,
  ): PoolPlayer {
    const pointsAllowed = impliedAgainst ?? NFL_CONFIG.leagueAverageTeamTotal;
    return {
      id: `dst-${job.team.id}`,
      sport: 'nfl',
      name: `${job.team.displayName} D/ST`,
      shortName: `${job.team.abbreviation} D/ST`,
      position: 'DST',
      positions: ['DST'],
      teamId: job.team.id,
      teamAbbr: job.team.abbreviation,
      opponentAbbr: job.opponent.abbreviation,
      isHome: job.isHome,
      gameId: job.game.id,
      headshot: job.team.logo,
      isTeamUnit: true,
      seasonStats: { ...DST_BASELINE, dstPtsAllowed: round1(pointsAllowed) },
      gamesPlayed: 1,
      contextMultiplier: 1,
      impliedPointsAgainst: impliedAgainst,
    };
  }

  /** Recent form for the strongest players in the pool (bounded requests). */
  private async enrichRecentForm(
    players: PoolPlayer[],
    season: number,
    options: BuildPoolOptions,
    progress: (m: string) => void,
  ): Promise<void> {
    const limit = options.recentFormLimit ?? 60;
    if (limit <= 0) return;
    const candidates = players
      .filter((p) => !p.isTeamUnit && p.gamesPlayed > 0)
      .sort((a, b) => activityScore(b) - activityScore(a))
      .slice(0, limit);
    if (candidates.length === 0) return;
    progress(`Loading recent form for ${candidates.length} players…`);

    const logs = await mapLimitSettled(candidates, 6, (player) =>
      getJson<any>(`${WEB}/${this.config.path}/athletes/${player.id}/gamelog?season=${season}`, {
        cacheMs: 10 * 60_000,
        retries: 1,
      }),
    );

    candidates.forEach((player, index) => {
      const log = logs[index];
      if (!log) return;
      const parsed = this.parseGamelog(log, 5);
      if (parsed) {
        player.recentStats = parsed.perGame;
        player.recentGames = parsed.games;
      }
    });
  }

  private parseGamelog(log: any, window: number): { perGame: StatMap; games: number } | null {
    const names: string[] = log?.names ?? [];
    if (names.length === 0) return null;
    const rows: string[][] = [];
    for (const seasonType of log?.seasonTypes ?? []) {
      for (const category of seasonType?.categories ?? []) {
        for (const event of category?.events ?? []) {
          if (Array.isArray(event?.stats)) rows.push(event.stats);
        }
      }
    }
    if (rows.length === 0) return null;
    const recent = rows.slice(0, window);
    const totals: StatMap = {};
    for (const row of recent) {
      const flat = this.flattenNamedStats(names, row);
      for (const [key, value] of Object.entries(flat)) {
        const canonical = this.config.seasonMap[`gamelog.${key}`] ?? this.config.boxMap[key] ?? GAMELOG_FALLBACK[this.sport]?.[key];
        if (!canonical) continue;
        totals[canonical] = (totals[canonical] ?? 0) + value;
      }
    }
    const games = recent.length;
    const perGame: StatMap = {};
    for (const [key, value] of Object.entries(totals)) perGame[key] = round2(value / games);
    return { perGame: applyDerivedStats(this.sport, perGame), games };
  }

  /** Expand composite feed keys ("completions/passingAttempts") into numbers. */
  private flattenNamedStats(keys: string[], values: (string | number)[]): Record<string, number> {
    const out: Record<string, number> = {};
    keys.forEach((key, index) => {
      const raw = values[index];
      if (raw === undefined || raw === null) return;
      const parts = key.split(/[/-]/);
      if (parts.length > 1 && typeof raw === 'string' && /[/-]/.test(raw)) {
        const numbers = splitComposite(raw);
        parts.forEach((part, i) => {
          if (numbers[i] !== undefined) out[part] = numbers[i];
        });
        return;
      }
      out[key] = toNumber(raw);
    });
    return out;
  }

  /** Season totals for every athlete in the league, converted to per-game. */
  private async loadSeasonStats(season: number): Promise<Map<string, SeasonEntry>> {
    const map = new Map<string, SeasonEntry>();
    let page = 1;
    let pages = 1;
    while (page <= pages && page <= 4) {
      const url =
        `${WEB}/${this.config.path}/statistics/byathlete` +
        `?region=us&lang=en&contentorigin=espn&isqualified=false&limit=1000&season=${season}&seasontype=2&page=${page}`;
      const data = await getJson<any>(url, { cacheMs: 30 * 60_000 });
      pages = data?.pagination?.pages ?? 1;
      const categoryNames: string[][] = (data?.categories ?? []).map((c: EspnCategory) => c.names ?? []);
      const categoryKeys: string[] = (data?.categories ?? []).map((c: EspnCategory) => c.name ?? '');
      for (const row of data?.athletes ?? []) {
        const id = String(row?.athlete?.id ?? '');
        if (!id) continue;
        const totals: StatMap = {};
        let gamesPlayed = 0;
        for (const category of row?.categories ?? []) {
          const catName: string = category?.name ?? '';
          const nameIndex = categoryKeys.indexOf(catName);
          const names: string[] = category?.names ?? (nameIndex >= 0 ? categoryNames[nameIndex] : []) ?? [];
          const values: (number | null)[] = category?.values ?? [];
          names.forEach((statName, i) => {
            const value = values[i];
            if (typeof value !== 'number' || !Number.isFinite(value)) return;
            if (statName === 'gamesPlayed') {
              gamesPlayed = Math.max(gamesPlayed, value);
              return;
            }
            const canonical = this.config.seasonMap[`${catName}.${statName}`];
            if (!canonical) return;
            totals[canonical] = (totals[canonical] ?? 0) + value;
          });
        }
        if (gamesPlayed <= 0) continue;
        const perGame: StatMap = {};
        for (const [key, value] of Object.entries(totals)) perGame[key] = round2(value / gamesPlayed);
        map.set(id, { perGame: applyDerivedStats(this.sport, perGame), gamesPlayed });
      }
      page += 1;
    }
    return map;
  }

  /** Implied team totals from the market, used for opponent/context adjustment. */
  private async loadGameContexts(games: ProviderGame[]): Promise<Map<string, GameContext>> {
    const map = new Map<string, GameContext>();
    const summaries = await mapLimitSettled(games, 4, (game) => this.fetchSummary(game.id));
    games.forEach((game, index) => {
      const summary = summaries[index];
      const odds = summary?.odds?.[0] ?? summary?.pickcenter?.[0];
      const overUnder = toNumber(odds?.overUnder);
      const spread = toNumber(odds?.spread);
      if (!overUnder) {
        map.set(game.id, {});
        return;
      }
      // ESPN spreads are quoted from the home team's perspective (negative =
      // home favored), so the home implied total is half the total plus half
      // the margin.
      const homeImplied = overUnder / 2 - spread / 2;
      const awayImplied = overUnder / 2 + spread / 2;
      map.set(game.id, { homeImplied, awayImplied, overUnder, spread });
    });
    return map;
  }

  private fetchSummary(gameId: string, cacheMs = 5 * 60_000): Promise<any> {
    return getJson<any>(`${SITE}/${this.config.path}/summary?event=${gameId}`, { cacheMs });
  }

  async fetchLive(game: ProviderGame): Promise<LiveGameStats> {
    const summary = await this.fetchSummary(game.id, 0);
    const competition = summary?.header?.competitions?.[0];
    const competitors: any[] = competition?.competitors ?? [];
    const status = competition?.status ?? {};
    const state = statesFromEspn(status?.type?.state);
    const homeCompetitor = competitors.find((c) => c.homeAway === 'home');
    const awayCompetitor = competitors.find((c) => c.homeAway === 'away');
    const homeScore = toNumber(homeCompetitor?.score);
    const awayScore = toNumber(awayCompetitor?.score);

    let winnerTeamId: string | null = null;
    const flagged = competitors.find((c) => c.winner === true);
    if (flagged) winnerTeamId = String(flagged.id);
    else if (state === 'post' && homeScore !== awayScore) {
      winnerTeamId = homeScore > awayScore ? game.home.id : game.away.id;
    }

    const players: Record<string, StatMap> = {};
    const teamEntries: any[] = summary?.boxscore?.players ?? [];
    for (const teamEntry of teamEntries) {
      for (const category of (teamEntry?.statistics ?? []) as EspnCategory[]) {
        const catName = category.name ?? '';
        const keys = category.keys ?? category.names ?? [];
        for (const athleteRow of category.athletes ?? []) {
          const id = String(athleteRow?.athlete?.id ?? '');
          if (!id) continue;
          const flat = this.flattenNamedStats(keys, athleteRow.stats ?? []);
          const target = (players[id] ??= {});
          for (const [statName, value] of Object.entries(flat)) {
            const canonical = this.config.namespacedBox
              ? this.config.boxMap[`${catName}.${statName}`]
              : this.config.boxMap[statName];
            if (!canonical) continue;
            target[canonical] = (target[canonical] ?? 0) + value;
          }
        }
      }
    }

    if (this.sport === 'nfl') {
      this.addTeamDefenseStats(summary, game, players, { homeScore, awayScore });
    }

    // The whole feed, not just the tail: a first-quarter field goal still has
    // to count in the fourth.
    const allPlays = this.readPlays(summary, { homeScore, awayScore });
    if (this.sport === 'nfl') {
      this.addPlayDerivedStats(summary, allPlays, players);
    }

    for (const [id, stats] of Object.entries(players)) {
      players[id] = applyDerivedStats(this.sport, stats);
    }

    return {
      gameId: game.id,
      state,
      statusDetail: status?.type?.shortDetail ?? game.statusDetail ?? '',
      homeScore,
      awayScore,
      winnerTeamId,
      players,
      situation: this.readSituation(summary, status, { homeScore, awayScore }),
      plays: allPlays,
    };
  }

  /** Down, distance and clock, taken from the most recent play. */
  private readSituation(
    summary: any,
    status: any,
    scores: { homeScore: number; awayScore: number },
  ): GameSituation {
    const period = Number(status?.period ?? 0);
    const displayClock = String(status?.displayClock ?? '').trim();
    const situation: GameSituation = {
      awayScore: scores.awayScore,
      homeScore: scores.homeScore,
      clock: period > 0 ? `${ordinalPeriod(this.sport, period)}${displayClock ? ` ${displayClock}` : ''}` : undefined,
    };

    // Basketball summaries carry no clock on the header, so the period and
    // clock come from the last play instead.
    if (this.sport !== 'nfl') {
      const plays: any[] = Array.isArray(summary?.plays) ? summary.plays : [];
      const last = plays[plays.length - 1];
      const lastPeriod = Number(last?.period?.number ?? period);
      const lastClock = String(last?.clock?.displayValue ?? displayClock).trim();
      if (lastPeriod > 0) {
        situation.clock = `${ordinalPeriod(this.sport, lastPeriod)}${lastClock ? ` ${lastClock}` : ''}`;
      }
      if (typeof last?.awayScore === 'number') situation.awayScore = last.awayScore;
      if (typeof last?.homeScore === 'number') situation.homeScore = last.homeScore;
      return situation;
    }

    const drives = summary?.drives ?? {};
    const candidates: any[] = [
      ...(drives?.current?.plays ?? []),
      ...((drives?.previous ?? []).flatMap((drive: any) => drive?.plays ?? []) as any[]),
    ];
    const lastPlay = candidates[candidates.length > 0 ? candidates.length - 1 : 0];
    const play = drives?.current?.plays?.length
      ? drives.current.plays[drives.current.plays.length - 1]
      : lastPlay;
    if (!play) return situation;

    const down = Number(play?.start?.down ?? 0);
    const distance = Number(play?.start?.distance ?? 0);
    if (down > 0) situation.detail = `${ordinal(down)} & ${distance}`;

    const playPeriod = Number(play?.period?.number ?? period);
    const playClock = String(play?.clock?.displayValue ?? displayClock).trim();
    if (playPeriod > 0) {
      situation.clock = `${ordinalPeriod(this.sport, playPeriod)}${playClock ? ` ${playClock}` : ''}`;
    }
    if (typeof play?.awayScore === 'number') situation.awayScore = play.awayScore;
    if (typeof play?.homeScore === 'number') situation.homeScore = play.homeScore;
    return situation;
  }

  /**
   * The tail of the game's play feed, oldest first.
   *
   * Football gives no athlete ids on a play, so the text is what a player is
   * matched against; basketball names the athletes outright.
   */
  private readPlays(summary: any, scores: { homeScore: number; awayScore: number }): GamePlay[] {
    const raw: any[] =
      this.sport === 'nfl'
        ? [
            ...((summary?.drives?.previous ?? []).flatMap((drive: any) => drive?.plays ?? []) as any[]),
            ...(summary?.drives?.current?.plays ?? []),
          ]
        : Array.isArray(summary?.plays)
          ? summary.plays
          : [];
    if (raw.length === 0) return [];

    // The current drive is also the last of the previous ones, so the same
    // plays arrive twice; the first occurrence keeps the order right.
    const seen = new Set<string>();
    const unique = raw.filter((play) => {
      const id = String(play?.id ?? '');
      if (!id) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    return unique.map((play, index) => {
      const period = Number(play?.period?.number ?? 0);
      const clock = String(play?.clock?.displayValue ?? '').trim();
      const down = Number(play?.start?.down ?? 0);
      const distance = Number(play?.start?.distance ?? 0);
      const athleteIds = (play?.participants ?? [])
        .map((participant: any) => String(participant?.athlete?.id ?? ''))
        .filter((id: string) => id !== '');
      const offense =
        (play?.teamParticipants ?? []).find((side: any) => side?.type === 'offense')?.id ??
        play?.start?.team?.id ??
        play?.team?.id;
      return {
        id: String(play?.id ?? `${index}`),
        detail: this.sport === 'nfl' && down > 0 ? `${ordinal(down)} & ${distance}` : undefined,
        clock: period > 0 ? `${ordinalPeriod(this.sport, period)}${clock ? ` ${clock}` : ''}` : undefined,
        awayScore: typeof play?.awayScore === 'number' ? play.awayScore : scores.awayScore,
        homeScore: typeof play?.homeScore === 'number' ? play.homeScore : scores.homeScore,
        text: typeof play?.text === 'string' ? play.text : undefined,
        athleteIds: athleteIds.length > 0 ? athleteIds : undefined,
        offenseTeamId: offense === undefined || offense === null ? undefined : String(offense),
        scoring: play?.scoringPlay === true,
        turnover: play?.isTurnover === true,
        wallclock: typeof play?.wallclock === 'string' ? play.wallclock : undefined,
      } satisfies GamePlay;
    });
  }

  /**
   * Field goal distances and two-point conversions, read off the play text.
   *
   * Neither appears in the box score: it gives a kicker "4/4" with no distances,
   * and no two-point column at all. ESPN pays field goals by distance and two
   * points for a conversion, so both are counted here from the words the feed
   * uses for them.
   */
  private addPlayDerivedStats(summary: any, plays: GamePlay[], players: Record<string, StatMap>): void {
    const byName = this.athleteIdsByShortName(summary);
    if (byName.size === 0) return;

    const add = (shortName: string | undefined, key: string, amount = 1): void => {
      const id = shortName ? byName.get(shortName.replace(/\s+/g, '').toLowerCase()) : undefined;
      if (!id) return;
      const stats = (players[id] ??= {});
      stats[key] = (stats[key] ?? 0) + amount;
    };

    for (const play of plays) {
      const text = play.text ?? '';
      if (text === '') continue;

      const goal = /([A-Z]\.[A-Za-z'\-.]+)\s+(\d+)\s+yard field goal is\s+GOOD/i.exec(text);
      if (goal) {
        add(goal[1], fieldGoalBand(Number(goal[2])));
      }

      // Only a conversion that actually worked is worth points.
      const conversion = text.indexOf('TWO-POINT CONVERSION ATTEMPT');
      if (conversion >= 0 && /ATTEMPT SUCCEEDS/i.test(text)) {
        const attempt = text.slice(conversion);
        const pass = /([A-Z]\.[A-Za-z'\-.]+)\s+pass to\s+([A-Z]\.[A-Za-z'\-.]+)/i.exec(attempt);
        if (pass) {
          add(pass[1], 'twoPt');
          add(pass[2], 'twoPt');
        } else {
          const run = /([A-Z]\.[A-Za-z'\-.]+)\s+(?:rushes|runs|up the middle|left|right)/i.exec(attempt);
          if (run) add(run[1], 'twoPt');
        }
      }
    }
  }

  /** "H.Mevis" -> athlete id, in the form the play text writes names. */
  private athleteIdsByShortName(summary: any): Map<string, string> {
    const map = new Map<string, string>();
    for (const team of (summary?.boxscore?.players ?? []) as any[]) {
      for (const category of (team?.statistics ?? []) as any[]) {
        for (const row of (category?.athletes ?? []) as any[]) {
          const athlete = row?.athlete;
          const id = String(athlete?.id ?? '');
          const full = String(athlete?.displayName ?? '').trim();
          if (!id || full === '') continue;
          const parts = full.split(/\s+/);
          if (parts.length < 2) continue;
          const key = `${parts[0][0]}.${parts.slice(1).join('')}`.replace(/\s+/g, '').toLowerCase();
          // First writer wins, so a duplicate abbreviation never reassigns.
          if (!map.has(key)) map.set(key, id);
        }
      }
    }
    return map;
  }

  /**
   * Team defense lines are assembled from the opposing offense (sacks taken,
   * interceptions thrown, fumbles lost, yards, points) plus this team's own
   * defensive and return touchdowns.
   */
  private addTeamDefenseStats(
    summary: any,
    game: ProviderGame,
    players: Record<string, StatMap>,
    scores: { homeScore: number; awayScore: number },
  ): void {
    const teamBlocks: any[] = summary?.boxscore?.teams ?? [];
    const byTeamId = new Map<string, Record<string, number[]>>();
    for (const block of teamBlocks) {
      const teamId = String(block?.team?.id ?? '');
      if (!teamId) continue;
      const stats: Record<string, number[]> = {};
      for (const stat of block?.statistics ?? []) {
        const name: string = stat?.name ?? '';
        if (!name) continue;
        const display: string = String(stat?.displayValue ?? '');
        const values = /[/-]/.test(display) ? splitComposite(display) : [toNumber(display)];
        (stats[name] ??= []).push(...values);
      }
      byTeamId.set(teamId, stats);
    }

    const safeties = new Map<string, number>();
    for (const play of summary?.scoringPlays ?? []) {
      const type: string = play?.type?.abbreviation ?? play?.type?.text ?? '';
      const text: string = play?.text ?? '';
      if (/^SF$/i.test(type) || /safety/i.test(text)) {
        const teamId = String(play?.team?.id ?? '');
        if (teamId) safeties.set(teamId, (safeties.get(teamId) ?? 0) + 1);
      }
    }

    const sides = [
      { team: game.home, opponent: game.away, pointsAllowed: scores.awayScore },
      { team: game.away, opponent: game.home, pointsAllowed: scores.homeScore },
    ];

    for (const side of sides) {
      const own = byTeamId.get(side.team.id) ?? {};
      const opposing = byTeamId.get(side.opponent.id) ?? {};
      const returnTds = this.sumReturnTouchdowns(summary, side.team.id);
      const stats: StatMap = {
        dstPtsAllowed: side.pointsAllowed,
        dstYdsAllowed: first(opposing.totalYards),
        dstSack: first(opposing.sacksYardsLost),
        dstInt: maxOf(opposing.interceptions),
        dstFumRec: first(opposing.fumblesLost),
        dstTD: first(own.defensiveTouchdowns) + returnTds,
        dstSafety: safeties.get(side.team.id) ?? 0,
        dstBlockedKick: 0,
      };
      players[`dst-${side.team.id}`] = stats;
    }
  }

  private sumReturnTouchdowns(summary: any, teamId: string): number {
    let total = 0;
    for (const teamEntry of summary?.boxscore?.players ?? []) {
      if (String(teamEntry?.team?.id ?? '') !== teamId) continue;
      for (const category of (teamEntry?.statistics ?? []) as EspnCategory[]) {
        const catName = category.name ?? '';
        if (catName !== 'kickReturns' && catName !== 'puntReturns') continue;
        const keys = category.keys ?? [];
        const tdIndex = keys.findIndex((k) => /TouchdownsS?$/i.test(k) || /Touchdowns$/.test(k));
        if (tdIndex < 0) continue;
        for (const athleteRow of category.athletes ?? []) {
          total += toNumber(athleteRow?.stats?.[tdIndex]);
        }
      }
    }
    return total;
  }
}

interface SeasonEntry {
  perGame: StatMap;
  gamesPlayed: number;
}

interface GameContext {
  homeImplied?: number;
  awayImplied?: number;
  overUnder?: number;
  spread?: number;
}

/** Fallback gamelog key mapping for names the box-score map does not cover. */
const GAMELOG_FALLBACK: Partial<Record<Sport, Record<string, string>>> = {
  nfl: {
    passingYards: 'passYds',
    passingTouchdowns: 'passTD',
    interceptions: 'passInt',
    completions: 'passCmp',
    passingAttempts: 'passAtt',
    rushingAttempts: 'rushAtt',
    rushingYards: 'rushYds',
    rushingTouchdowns: 'rushTD',
    receptions: 'rec',
    receivingYards: 'recYds',
    receivingTouchdowns: 'recTD',
    receivingTargets: 'targets',
    fumblesLost: 'fumLost',
    fieldGoalsMade: 'fgMade',
    fieldGoalAttempts: 'fgAtt',
    extraPointsMade: 'xpMade',
  },
  nba: {
    points: 'pts',
    rebounds: 'reb',
    assists: 'ast',
    steals: 'stl',
    blocks: 'blk',
    turnovers: 'tov',
    threePointFieldGoalsMade: 'fg3m',
    fieldGoalsMade: 'fgm',
    freeThrowsMade: 'ftm',
    minutes: 'min',
  },
};

function extractAthletes(roster: any): any[] {
  const athletes = roster?.athletes;
  if (!Array.isArray(athletes)) return [];
  if (athletes.length > 0 && Array.isArray(athletes[0]?.items)) {
    return athletes
      .filter((group: any) => !/injured|practice|suspend/i.test(String(group?.position ?? '')))
      .flatMap((group: any) => group.items ?? []);
  }
  return athletes;
}

function isUnavailable(athlete: any): boolean {
  const statusType = String(athlete?.status?.type ?? '').toLowerCase();
  if (statusType && statusType !== 'active') return true;
  const injuries: any[] = athlete?.injuries ?? [];
  return injuries.some((injury) => /out|injured-reserve|suspension/i.test(String(injury?.status ?? '')));
}

function injuryLabel(athlete: any): string | undefined {
  const injury = (athlete?.injuries ?? [])[0];
  if (!injury) return undefined;
  const status = String(injury.status ?? '').trim();
  return status ? status.toUpperCase() : undefined;
}

function pickSeasonEntry(current?: SeasonEntry, prior?: SeasonEntry): SeasonEntry {
  if (current && current.gamesPlayed >= 3) return current;
  if (current && prior && prior.gamesPlayed >= 5) {
    // Blend an early-season sample with last season so projections are stable.
    const weight = current.gamesPlayed / 3;
    const perGame: StatMap = {};
    const keys = new Set([...Object.keys(current.perGame), ...Object.keys(prior.perGame)]);
    for (const key of keys) {
      perGame[key] = round2((current.perGame[key] ?? 0) * weight + (prior.perGame[key] ?? 0) * (1 - weight));
    }
    return { perGame, gamesPlayed: current.gamesPlayed };
  }
  if (current) return current;
  if (prior) return { perGame: prior.perGame, gamesPlayed: prior.gamesPlayed };
  return { perGame: {}, gamesPlayed: 0 };
}

/** Rough "is this player a fantasy factor" heuristic for recent-form budgeting. */
function activityScore(player: PoolPlayer): number {
  const s = player.seasonStats;
  return (
    (s.passYds ?? 0) * 0.04 +
    (s.rushYds ?? 0) * 0.1 +
    (s.recYds ?? 0) * 0.1 +
    (s.rec ?? 0) +
    (s.pts ?? 0) +
    (s.reb ?? 0) * 1.25 +
    (s.ast ?? 0) * 1.5 +
    (s.fgMade ?? 0) * 3
  );
}

function ordinal(value: number): string {
  if (value === 1) return '1st';
  if (value === 2) return '2nd';
  if (value === 3) return '3rd';
  return `${value}th`;
}

/** NFL quarters read "3rd", NBA periods read "Q3"; overtime is OT either way. */
function ordinalPeriod(sport: Sport, period: number): string {
  const regulation = sport === 'nba' ? 4 : 4;
  if (period > regulation) return period === regulation + 1 ? 'OT' : `${period - regulation}OT`;
  return sport === 'nba' ? `Q${period}` : ordinal(period);
}

function first(values: number[] | undefined): number {
  return values && values.length > 0 ? values[0] : 0;
}

function maxOf(values: number[] | undefined): number {
  return values && values.length > 0 ? Math.max(...values) : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export { mapLimit };
