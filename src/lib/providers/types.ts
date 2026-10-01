import type { ContestGame, GameState, Sport, StatMap } from '../../types';

/** A game as returned by a provider, before it is attached to a contest. */
export type ProviderGame = ContestGame;

export interface PoolPlayer {
  id: string;
  sport: Sport;
  name: string;
  shortName?: string;
  positions: string[];
  position: string;
  teamId: string;
  teamAbbr: string;
  opponentAbbr: string;
  isHome: boolean;
  gameId: string;
  headshot?: string;
  jersey?: string;
  injuryStatus?: string;
  isTeamUnit?: boolean;
  /** Per-game season averages in canonical stat keys. */
  seasonStats: StatMap;
  gamesPlayed: number;
  /** Per-game averages over the most recent games, when available. */
  recentStats?: StatMap;
  recentGames?: number;
  /**
   * Game context multiplier derived from betting markets (implied team total vs
   * the league average). 1 = neutral. Used by the salary engine.
   */
  contextMultiplier?: number;
  /** Implied points the opposing offense is expected to score. */
  impliedPointsAgainst?: number;
  /**
   * How likely this player is to actually play tonight, 0 to 1. A posted
   * lineup makes this certain; otherwise it is how often they play. Projections
   * and therefore salaries are scaled by it, so somebody who is not starting is
   * priced as what they are: a long shot.
   */
  availability?: number;
  /** Why, in the words shown on their card: "Not in tonight's lineup". */
  availabilityNote?: string;
}

/** Where the game stood when these stats were read. */
export interface GameSituation {
  /** "2nd & 10" for football, "Top 5, 1 out" for baseball. */
  detail?: string;
  /** "3rd 10:15" / "Q3 5:22". */
  clock?: string;
  awayScore: number;
  homeScore: number;
}

/**
 * One play from the game's own feed, used to say which play moved a player's
 * score rather than stamping everything with wherever the game happens to be.
 */
export interface GamePlay {
  id: string;
  /** Down and distance, or the count and outs: the same phrasing as a situation. */
  detail?: string;
  /** "3rd 10:15", "Q3 5:22", "Top 9th". */
  clock?: string;
  awayScore: number;
  homeScore: number;
  /** The feed's own description, matched against a player's name where no ids exist. */
  text?: string;
  /** Athlete ids the feed credits on this play, when it gives any. */
  athleteIds?: string[];
  /** Team with the ball, so a defense can be matched to its opponent's plays. */
  offenseTeamId?: string;
  scoring: boolean;
  turnover: boolean;
  /** When the play actually happened, when the feed says. */
  wallclock?: string;
}

export interface LiveGameStats {
  gameId: string;
  state: GameState;
  statusDetail: string;
  homeScore: number;
  awayScore: number;
  winnerTeamId: string | null;
  /**
   * First pitch as the feed gives it now. Schedules move after a contest is
   * built, and a start time nobody refreshes is what locks a contest hours
   * before anyone takes the field.
   */
  startTime?: string;
  /** playerId -> canonical live stats. Includes synthetic team units. */
  players: Record<string, StatMap>;
  situation?: GameSituation;
  /** Recent plays, oldest first. */
  plays?: GamePlay[];
}

export interface BuildPoolOptions {
  /** Fetch recent-form game logs for this many of the strongest players. */
  recentFormLimit?: number;
  onProgress?: (message: string) => void;
}

export interface SportProvider {
  sport: Sport;
  /** Games for a calendar date (YYYY-MM-DD, local to the league). */
  listGames(date: string): Promise<ProviderGame[]>;
  /** Everything needed to build a player pool for the given games. */
  buildPool(games: ProviderGame[], options?: BuildPoolOptions): Promise<PoolPlayer[]>;
  /** Current stats + game state for one game. */
  fetchLive(game: ProviderGame): Promise<LiveGameStats>;
}
