import type { ContestGame, GameSpread, Sport } from '../../types';
import { getJson } from './http';

/**
 * Betting lines from SportsGameOdds.
 *
 * The line is read once, when a contest is created, and stored on the contest's
 * games. Nothing reads it again, so a line that moves afterwards cannot change
 * what entrants were picking against.
 */

const API = 'https://api.sportsgameodds.com/v2/events';
const API_KEY = import.meta.env?.VITE_SPORTSGAMEODDS_KEY ?? 'bf25a8f2a4d5e93017d51a9deebc647c';

/** Preferred books in order; the consensus line is the fallback. */
const BOOK_PRIORITY = ['draftkings', 'fanduel', 'betmgm', 'caesars', 'espnbet'];

const LEAGUE_BY_SPORT: Record<Sport, string> = { nfl: 'NFL', mlb: 'MLB', nba: 'NBA' };

const HOME_SPREAD_ODD_ID = 'points-home-game-sp-home';

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseSpread(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const parsed = Number.parseFloat(value.replace('+', ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function dateKey(iso: string): string {
  return iso.slice(0, 10);
}

function shiftDate(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString().slice(0, 10);
}

interface SgoEvent {
  status?: { startsAt?: string };
  teams?: {
    home?: { names?: { long?: string; short?: string } };
    away?: { names?: { long?: string; short?: string } };
  };
  odds?: Record<string, { bookSpread?: string; fairSpread?: string; byBookmaker?: Record<string, { spread?: string; available?: boolean }> }>;
}

/** Pick the line to freeze: a familiar book first, then the consensus. */
function spreadFromEvent(event: SgoEvent): { homeSpread: number; source: string } | null {
  const market = event.odds?.[HOME_SPREAD_ODD_ID];
  if (!market) return null;

  for (const book of BOOK_PRIORITY) {
    const entry = market.byBookmaker?.[book];
    const value = parseSpread(entry?.spread);
    if (entry?.available !== false && value !== null) return { homeSpread: value, source: book };
  }
  const consensus = parseSpread(market.bookSpread) ?? parseSpread(market.fairSpread);
  return consensus === null ? null : { homeSpread: consensus, source: 'consensus' };
}

/**
 * Look up the current spread for each game. Games with no line available are
 * simply absent from the result, and fall back to straight-up picks.
 */
export async function fetchSpreads(games: ContestGame[]): Promise<Map<string, GameSpread>> {
  const found = new Map<string, GameSpread>();
  if (games.length === 0) return found;

  // One request per league per day covered by the slate.
  const buckets = new Map<string, ContestGame[]>();
  for (const game of games) {
    const key = `${game.sport}|${dateKey(game.startTime)}`;
    buckets.set(key, [...(buckets.get(key) ?? []), game]);
  }

  for (const [key, bucketGames] of buckets.entries()) {
    const [sport, day] = key.split('|') as [Sport, string];
    const url =
      `${API}?leagueID=${LEAGUE_BY_SPORT[sport]}` +
      `&startsAfter=${shiftDate(`${day}T00:00:00.000Z`, -1)}` +
      `&startsBefore=${shiftDate(`${day}T00:00:00.000Z`, 2)}` +
      `&oddID=${HOME_SPREAD_ODD_ID}&limit=100&apiKey=${API_KEY}`;

    let events: SgoEvent[] = [];
    try {
      const response = await getJson<{ data?: SgoEvent[] }>(url, { cacheMs: 5 * 60_000, retries: 1 });
      events = response.data ?? [];
    } catch {
      continue; // No line for this bucket; those games stay straight-up.
    }

    for (const game of bucketGames) {
      const match = events.find((event) => {
        const home = event.teams?.home?.names;
        const away = event.teams?.away?.names;
        if (!home || !away) return false;
        const homeMatches =
          normalizeName(home.long ?? '') === normalizeName(game.home.displayName) ||
          normalizeName(home.short ?? '') === normalizeName(game.home.abbreviation);
        const awayMatches =
          normalizeName(away.long ?? '') === normalizeName(game.away.displayName) ||
          normalizeName(away.short ?? '') === normalizeName(game.away.abbreviation);
        if (!homeMatches || !awayMatches) return false;
        const startsAt = Date.parse(event.status?.startsAt ?? '');
        if (!Number.isFinite(startsAt)) return true;
        return Math.abs(startsAt - Date.parse(game.startTime)) < 36 * 3600_000;
      });
      if (!match) continue;

      const spread = spreadFromEvent(match);
      if (spread === null) continue;

      found.set(game.id, {
        homeSpread: spread.homeSpread,
        favorite: spread.homeSpread < 0 ? 'home' : spread.homeSpread > 0 ? 'away' : 'even',
        line: Math.abs(spread.homeSpread),
        source: spread.source,
        capturedAt: new Date().toISOString(),
      });
    }
  }

  return found;
}

/** Attach freshly fetched lines to a set of games. */
export async function withSpreads(games: ContestGame[]): Promise<ContestGame[]> {
  const spreads = await fetchSpreads(games);
  return games.map((game) => ({ ...game, spread: spreads.get(game.id) ?? null }));
}
