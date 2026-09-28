/**
 * Core contest domain model.
 *
 * Everything here is deliberately sport-neutral: a sport contributes a player
 * pool, a stat vocabulary and a scoring table, and the contest engine treats
 * all of them the same way. Adding a fourth sport should not require touching
 * the contest engine, only adding a provider + a default scoring table.
 */

export type Sport = 'nfl' | 'mlb' | 'nba';

export const SPORTS: Sport[] = ['nfl', 'mlb', 'nba'];

export const SPORT_LABELS: Record<Sport, string> = {
  nfl: 'NFL',
  mlb: 'MLB',
  nba: 'NBA',
};

/** A stat map is always `canonicalStatKey -> value`. See lib/stats keys. */
export type StatMap = Record<string, number>;

/** Scoring table: `canonicalStatKey -> points per unit`. */
export type ScoringTable = Record<string, number>;

/** Tiered bonus, used for things like NFL DST points allowed. */
export interface ScoringTier {
  /** Inclusive lower bound of the bucket. */
  min: number;
  /** Inclusive upper bound of the bucket (null = open ended). */
  max: number | null;
  points: number;
}

export interface SportScoring {
  /** Per-unit values for each stat. */
  values: ScoringTable;
  /** Optional tiered rules keyed by the stat they read. */
  tiers?: Record<string, ScoringTier[]>;
}

/** Scoring configuration for a whole contest, one table per sport involved. */
export type ContestScoring = Partial<Record<Sport, SportScoring>>;

/**
 * A roster slot. `positions` lists the fantasy positions that may fill it;
 * `['*']` means any position (a UTIL / FLEX-everything slot). `sport` pins a
 * slot to one sport, which is what makes multi-sport contests expressible
 * without special-casing anything.
 */
export interface RosterSlot {
  id: string;
  label: string;
  positions: string[];
  sport?: Sport;
}

export type GameState = 'pre' | 'in' | 'post';

export interface ContestTeam {
  id: string;
  abbreviation: string;
  displayName: string;
  logo?: string;
  score?: number;
}

/**
 * The betting line for a game, frozen when the contest is created so it cannot
 * move underneath entrants.
 */
export interface GameSpread {
  /** Points given to the home team, e.g. -3.5 when home is favored by 3.5. */
  homeSpread: number;
  /** Which side is giving points. */
  favorite: 'home' | 'away' | 'even';
  /** How many points the favorite is giving (0 for a pick'em). */
  line: number;
  /** Where the line came from, shown to entrants. */
  source: string;
  capturedAt: string;
}

export interface ContestGame {
  /** Provider game id, unique within its sport. */
  id: string;
  sport: Sport;
  /** ISO start time. */
  startTime: string;
  shortName: string;
  home: ContestTeam;
  away: ContestTeam;
  state: GameState;
  statusDetail?: string;
  /** Team id of the winner, set once the game is final. */
  winnerTeamId?: string | null;
  /** Frozen at contest creation; absent means picks are straight up. */
  spread?: GameSpread | null;
}

export interface PlayerProjection {
  /** Expected fantasy points in the player's own sport scale. */
  raw: number;
  /** Expected fantasy points converted to the contest (NFL-equivalent) scale. */
  normalized: number;
}

export interface ContestPlayer {
  id: string;
  sport: Sport;
  name: string;
  shortName?: string;
  /** Fantasy-eligible positions, most specific first. */
  positions: string[];
  /** Primary position label for display. */
  position: string;
  teamId: string;
  teamAbbr: string;
  opponentAbbr: string;
  isHome: boolean;
  gameId: string;
  headshot?: string;
  jersey?: string;
  injuryStatus?: string;
  /** Auto-generated salary. */
  salary: number;
  projection: PlayerProjection;
  /** Season per-game averages used for projections, for display + debugging. */
  seasonStats?: StatMap;
  gamesPlayed?: number;
  /** Recent-form per-game averages when the provider could supply them. */
  recentStats?: StatMap;
  /** Live stats for this contest's game. */
  liveStats?: StatMap;
  /** Fantasy points from liveStats in the player's own sport scale. */
  rawPoints?: number;
  /** rawPoints * normalization factor for the sport. */
  normalizedPoints?: number;
  /** Short human readable stat line, e.g. "246 YDS, 2 TD". */
  statLine?: string;
  /** True once the player's game has started. */
  started?: boolean;
  /** Synthetic entries (NFL team defenses) are flagged so UI can adapt. */
  isTeamUnit?: boolean;
  /**
   * Game-context multiplier used when the salary was calculated (market implied
   * total, opposing starter). Stored so a contest can be re-priced later without
   * refetching the provider feeds.
   */
  contextMultiplier?: number;
}

export interface NormalizationInfo {
  /** Multiplier applied to raw fantasy points, per sport. NFL is always 1. */
  factors: Partial<Record<Sport, number>>;
  /** The anchor value each factor was derived from, for transparency. */
  anchors: Partial<Record<Sport, number>>;
  /** Anchor the other sports were scaled to. */
  baselineAnchor: number;
  /** 'pool' = measured from this contest's pool, 'reference' = league default. */
  method: Partial<Record<Sport, 'pool' | 'reference'>>;
  computedAt: string;
}

/**
 * Team captain. One rostered player can be designated captain: they cost more
 * and score more, by the same multiplier, so the choice is a real trade-off
 * rather than free upside.
 */
export interface CaptainConfig {
  enabled: boolean;
  /** Applied to both the captain's salary and their fantasy points. */
  multiplier: number;
}

export interface GameWinnerConfig {
  enabled: boolean;
  /** Percentage of the contest scoring baseline awarded per correct pick. */
  bonusPercent: number;
  /**
   * Points awarded per correct pick. Frozen with the contest so every entrant
   * receives exactly the same bonus and the calculation never depends on a
   * user's own score.
   */
  bonusPoints: number;
}

export interface SalaryCapInfo {
  cap: number;
  /** Cheapest legal lineup. */
  minLineupCost: number;
  /** Most expensive legal lineup. */
  maxLineupCost: number;
  /** Cost of a median-salary legal lineup. */
  medianLineupCost: number;
  /** How far between median and max the cap was placed (0..1). */
  aggressiveness: number;
}

export type ContestStatus = 'open' | 'live' | 'complete';

export interface ContestResultsEntry {
  uid: string;
  displayName: string;
  teamName?: string;
  rank: number;
  fantasyPoints: number;
  bonusPoints: number;
  correctPicks: number;
  totalPicks: number;
  total: number;
}

export interface Contest {
  id: string;
  name: string;
  sports: Sport[];
  games: ContestGame[];
  rosterSlots: RosterSlot[];
  scoring: ContestScoring;
  normalization: NormalizationInfo;
  salaryCapInfo: SalaryCapInfo;
  /** Expected normalized score of a median lineup; the bonus baseline. */
  scoringBaseline: number;
  gameWinner: GameWinnerConfig;
  /** Absent on contests created before captains existed, which means disabled. */
  captain?: CaptainConfig;
  /** Earliest game start; the moment the whole contest locks. */
  lockTime: string;
  /** Latest game start (+ slack) used to help decide completion. */
  lastGameStart: string;
  status: ContestStatus;
  /** Set once an admin/worker has verified every game is final. */
  finalizedAt?: string | null;
  /** When live scoring last ran, used to stop every open tab syncing at once. */
  lastSyncAt?: string | null;
  results?: ContestResultsEntry[];
  playerCount: number;
  entrantCount: number;
  createdAt: string;
  updatedAt: string;
  /** Free-form notes shown on the contest card. */
  notes?: string;
}

/** What a user actually submits. */
export interface LineupSelection {
  slotId: string;
  playerId: string;
  /** Exactly one selection may carry this when the contest has captains. */
  captain?: boolean;
}

export interface Entry {
  uid: string;
  displayName: string;
  /** Auto-generated alliterative team name. */
  teamName?: string;
  lineup: LineupSelection[];
  /** gameId -> picked team id. */
  picks: Record<string, string>;
  salaryUsed: number;
  submittedAt: string;
  updatedAt: string;
  /** Snapshot of salaries/positions at submit time, for post-lock auditing. */
  lockedSnapshot?: Record<string, { salary: number; slotId: string }>;
}

/** Public per-entrant document. Never contains roster or pick information. */
export interface Standing {
  uid: string;
  displayName: string;
  teamName?: string;
  enteredAt: string;
  submitted: boolean;
}

export interface LeaderboardPlayerLine {
  slot: RosterSlot;
  player: ContestPlayer | null;
  rawPoints: number;
  /** Already multiplied when this line is the captain. */
  normalizedPoints: number;
  isCaptain: boolean;
  /** Salary actually charged, including the captain premium. */
  salary: number;
}

export interface LeaderboardRow {
  uid: string;
  displayName: string;
  teamName?: string;
  rank: number;
  fantasyPoints: number;
  bonusPoints: number;
  total: number;
  correctPicks: number;
  decidedPicks: number;
  totalPicks: number;
  salaryUsed: number;
  /** Null until the contest locks and rosters become public. */
  lines: LeaderboardPlayerLine[] | null;
  picks: Record<string, string> | null;
  /** Populated when the submitted lineup breaks the contest's own rules. */
  violations: string[];
  isSelf: boolean;
}
