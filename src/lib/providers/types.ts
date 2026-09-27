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
}

export interface LiveGameStats {
  gameId: string;
  state: GameState;
  statusDetail: string;
  homeScore: number;
  awayScore: number;
  winnerTeamId: string | null;
  /** playerId -> canonical live stats. Includes synthetic team units. */
  players: Record<string, StatMap>;
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
