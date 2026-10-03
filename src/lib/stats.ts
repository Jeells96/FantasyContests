import type { Sport, StatMap } from '../types';

/**
 * Canonical stat vocabulary.
 *
 * Providers translate their own feed keys into these keys, so scoring tables,
 * the salary engine and the UI all speak one language. Keys are namespaced by
 * sport concept rather than by feed category, which avoids collisions such as
 * "interceptions thrown" vs "interceptions caught".
 */

export interface StatMeta {
  key: string;
  label: string;
  /** Short label for dense stat lines. */
  short: string;
  /** Lower is better (used for display colouring). */
  negative?: boolean;
  /** Round to this many decimals when displaying. */
  decimals?: number;
  /** Wording for the scoring feed, when the label does not pluralise cleanly. */
  phrase?: string;
}

const meta = (
  key: string,
  label: string,
  short: string,
  opts: { negative?: boolean; decimals?: number; phrase?: string } = {},
): StatMeta => ({ key, label, short, ...opts });

export const NFL_STATS: StatMeta[] = [
  meta('passCmp', 'Completions', 'CMP'),
  meta('passAtt', 'Pass attempts', 'ATT'),
  meta('passYds', 'Passing yards', 'PYD'),
  meta('passTD', 'Passing TD', 'PTD'),
  meta('passInt', 'Interceptions thrown', 'INT', { negative: true }),
  meta('rushAtt', 'Carries', 'CAR'),
  meta('rushYds', 'Rushing yards', 'RYD'),
  meta('rushTD', 'Rushing TD', 'RTD'),
  meta('rec', 'Receptions', 'REC'),
  meta('targets', 'Targets', 'TGT'),
  meta('recYds', 'Receiving yards', 'RECYD'),
  meta('recTD', 'Receiving TD', 'RECTD'),
  meta('fumLost', 'Fumbles lost', 'FUML', { negative: true }),
  meta('twoPt', '2-point conversions', '2PT'),
  meta('fgMade', 'Field goals made', 'FGM'),
  meta('fgMade0_39', 'Field goals 0-39', 'FG39'),
  meta('fgMade40_49', 'Field goals 40-49', 'FG49'),
  meta('fgMade50_59', 'Field goals 50-59', 'FG59'),
  meta('fgMade60', 'Field goals 60+', 'FG60'),
  meta('fgMissed', 'Field goals missed', 'FGX', { negative: true }),
  meta('xpMade', 'Extra points made', 'XPM'),
  meta('xpMissed', 'Extra points missed', 'XPX', { negative: true }),
  meta('krTD', 'Kick return TD', 'KRTD'),
  meta('prTD', 'Punt return TD', 'PRTD'),
  // Team defense / special teams
  meta('dstSack', 'Sacks', 'SACK'),
  meta('dstInt', 'Interceptions', 'INT'),
  meta('dstFumRec', 'Fumble recoveries', 'FR'),
  meta('dstTD', 'Defensive/ST TD', 'DTD'),
  meta('dstSafety', 'Safeties', 'SFT'),
  meta('dstBlockedKick', 'Blocked kicks', 'BLK'),
  meta('dstPtsAllowed', 'Points allowed', 'PA'),
  meta('dstYdsAllowed', 'Yards allowed', 'YA'),
  meta('dstTackles', 'Tackles', 'TKL'),
];

export const MLB_STATS: StatMeta[] = [
  meta('ab', 'At bats', 'AB'),
  meta('h', 'Hits', 'H'),
  meta('singles', 'Singles', '1B'),
  meta('doubles', 'Doubles', '2B'),
  meta('triples', 'Triples', '3B'),
  meta('hr', 'Home runs', 'HR'),
  meta('r', 'Runs', 'R'),
  meta('rbi', 'Runs batted in', 'RBI', { phrase: 'RBI' }),
  meta('bb', 'Walks', 'BB'),
  meta('hbp', 'Hit by pitch', 'HBP'),
  meta('sb', 'Stolen bases', 'SB'),
  meta('cs', 'Caught stealing', 'CS', { negative: true }),
  meta('so', 'Strikeouts (batting)', 'K', { negative: true }),
  meta('e', 'Errors', 'E', { negative: true }),
  // Pitching
  meta('pitchOuts', 'Outs recorded', 'OUT'),
  meta('pitchIP', 'Innings pitched', 'IP', { decimals: 1 }),
  meta('pitchSO', 'Strikeouts', 'K'),
  meta('pitchW', 'Wins', 'W'),
  meta('pitchER', 'Earned runs', 'ER', { negative: true }),
  meta('pitchH', 'Hits allowed', 'HA', { negative: true }),
  meta('pitchBB', 'Walks allowed', 'BBA', { negative: true }),
  meta('pitchHBP', 'Hit batters', 'HB', { negative: true }),
  meta('pitchHR', 'Home runs allowed', 'HRA', { negative: true }),
  meta('pitchSV', 'Saves', 'SV'),
  meta('pitchHLD', 'Holds', 'HLD'),
  meta('pitchCG', 'Complete games', 'CG'),
  meta('pitchSHO', 'Shutouts', 'SHO'),
];

export const NBA_STATS: StatMeta[] = [
  meta('min', 'Minutes', 'MIN'),
  meta('pts', 'Points', 'PTS'),
  meta('fgm', 'Field goals made', 'FGM'),
  meta('fga', 'Field goals attempted', 'FGA'),
  meta('fg3m', '3-pointers made', '3PM'),
  meta('fg3a', '3-pointers attempted', '3PA'),
  meta('ftm', 'Free throws made', 'FTM'),
  meta('fta', 'Free throws attempted', 'FTA'),
  meta('reb', 'Rebounds', 'REB'),
  meta('oreb', 'Offensive rebounds', 'OREB'),
  meta('dreb', 'Defensive rebounds', 'DREB'),
  meta('ast', 'Assists', 'AST'),
  meta('stl', 'Steals', 'STL'),
  meta('blk', 'Blocks', 'BLK'),
  meta('tov', 'Turnovers', 'TO', { negative: true }),
  meta('pf', 'Personal fouls', 'PF', { negative: true }),
  meta('dd', 'Double-double', 'DD'),
  meta('td3', 'Triple-double', 'TD3'),
];

export const STATS_BY_SPORT: Record<Sport, StatMeta[]> = {
  nfl: NFL_STATS,
  // College football is the same game, so it shares the football vocabulary.
  ncaaf: NFL_STATS,
  mlb: MLB_STATS,
  nba: NBA_STATS,
};

const INDEX: Record<Sport, Record<string, StatMeta>> = {
  nfl: Object.fromEntries(NFL_STATS.map((s) => [s.key, s])),
  ncaaf: Object.fromEntries(NFL_STATS.map((s) => [s.key, s])),
  mlb: Object.fromEntries(MLB_STATS.map((s) => [s.key, s])),
  nba: Object.fromEntries(NBA_STATS.map((s) => [s.key, s])),
};

export function statMeta(sport: Sport, key: string): StatMeta {
  return INDEX[sport][key] ?? { key, label: key, short: key.toUpperCase() };
}

/**
 * Derived stats that are computed from the raw feed values rather than read
 * directly. Applied after every provider translation so scoring tables can use
 * them uniformly (live and season alike).
 */
export function applyDerivedStats(sport: Sport, stats: StatMap): StatMap {
  const out: StatMap = { ...stats };
  const n = (k: string) => (typeof out[k] === 'number' && Number.isFinite(out[k]) ? out[k] : 0);

  if (sport === 'mlb') {
    if (out.h !== undefined) {
      out.singles = Math.max(0, n('h') - n('doubles') - n('triples') - n('hr'));
    }
    if (out.pitchOuts !== undefined) {
      out.pitchIP = Math.round((n('pitchOuts') / 3) * 10) / 10;
    }
  }

  if (sport === 'nba') {
    const categories = [n('pts'), n('reb'), n('ast'), n('stl'), n('blk')];
    const doubles = categories.filter((v) => v >= 10).length;
    out.dd = doubles >= 2 ? 1 : 0;
    out.td3 = doubles >= 3 ? 1 : 0;
  }

  if (sport === 'nfl') {
    if (out.fgAtt !== undefined && out.fgMade !== undefined) {
      out.fgMissed = Math.max(0, n('fgAtt') - n('fgMade'));
    }
    if (out.xpAtt !== undefined && out.xpMade !== undefined) {
      out.xpMissed = Math.max(0, n('xpAtt') - n('xpMade'));
    }
  }

  return out;
}

/** Stat-line priority per sport/role for the compact player-card summary. */
const FOOTBALL_LINE_KEYS: Record<string, string[]> = {
    QB: ['passYds', 'passTD', 'passInt', 'rushYds', 'rushTD'],
    RB: ['rushAtt', 'rushYds', 'rushTD', 'rec', 'recYds', 'recTD'],
    WR: ['rec', 'recYds', 'recTD', 'rushYds'],
    TE: ['rec', 'recYds', 'recTD'],
    K: ['fgMade', 'fgMissed', 'xpMade'],
    DST: ['dstPtsAllowed', 'dstSack', 'dstInt', 'dstFumRec', 'dstTD'],
  default: ['rushYds', 'rec', 'recYds', 'passYds'],
};

const LINE_KEYS: Record<Sport, Record<string, string[]>> = {
  nfl: FOOTBALL_LINE_KEYS,
  ncaaf: FOOTBALL_LINE_KEYS,
  mlb: {
    P: ['pitchIP', 'pitchSO', 'pitchER', 'pitchH', 'pitchBB'],
    SP: ['pitchIP', 'pitchSO', 'pitchER', 'pitchH', 'pitchBB'],
    RP: ['pitchIP', 'pitchSO', 'pitchER', 'pitchH'],
  default: ['h', 'ab', 'r', 'hr', 'rbi', 'bb', 'sb', 'so', 'e'],
  },
  nba: {
    default: ['pts', 'reb', 'ast', 'fg3m', 'stl', 'blk'],
  },
};

export function formatStatLine(sport: Sport, position: string, stats: StatMap | undefined): string {
  if (!stats) return '';
  const table = LINE_KEYS[sport];
  const keys = table[position] ?? table.default;
  const parts: string[] = [];
  for (const key of keys) {
    const value = stats[key];
    if (value === undefined || value === null) continue;
    if (value === 0 && !['dstPtsAllowed', 'pitchIP', 'ab'].includes(key)) continue;
    const m = statMeta(sport, key);
    const shown = m.decimals ? value.toFixed(m.decimals) : Math.round(value * 10) / 10;
    parts.push(`${shown} ${m.short}`);
  }
  return parts.join(' · ');
}

/** Sum of absolute statistical activity; used to tell "played" from "did not". */
export function hasActivity(stats: StatMap | undefined): boolean {
  if (!stats) return false;
  return Object.values(stats).some((v) => typeof v === 'number' && v !== 0);
}

/**
 * What changed, in words.
 *
 * A feed that says only "+8.5" leaves everyone guessing which of a dozen things
 * a player just did. This names the stats that moved since the last round —
 * "2 outs recorded, 1 strikeout" — so the number has a reason attached.
 *
 * Only stats the contest actually scores are described: a box score carries
 * plenty that earns nothing, and listing it would bury what mattered.
 */
export function describeStatChange(
  sport: Sport,
  before: StatMap | undefined,
  after: StatMap | undefined,
  scored: Iterable<string>,
): string {
  if (!after) return '';
  const parts: { text: string; size: number }[] = [];
  for (const key of new Set(scored)) {
    const from = numberAt(before, key);
    const to = numberAt(after, key);
    const change = Math.round((to - from) * 100) / 100;
    if (change === 0) continue;
    const m = statMeta(sport, key);
    const magnitude = Math.abs(change);
    const shown = Number.isInteger(magnitude) ? String(magnitude) : magnitude.toFixed(1);
    parts.push({
      text: `${change > 0 ? '+' : '−'}${shown} ${phraseFor(m, magnitude)}`,
      size: magnitude,
    });
  }
  if (parts.length === 0) return '';
  // Biggest first: the home run is the news, the at-bat that came with it is not.
  return parts
    .sort((a, b) => b.size - a.size)
    .slice(0, 4)
    .map((part) => part.text)
    .join(', ');
}

function numberAt(stats: StatMap | undefined, key: string): number {
  const value = stats?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** "receptions" for several, "reception" for one; set `phrase` to opt out. */
function phraseFor(m: StatMeta, magnitude: number): string {
  if (m.phrase) return m.phrase;
  const label = m.label.replace(/\s*\(.*\)\s*$/, '').toLowerCase();
  if (magnitude === 1 && label.endsWith('s') && !label.endsWith('ss')) return label.slice(0, -1);
  return label;
}
