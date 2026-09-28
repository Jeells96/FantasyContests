import type { Sport } from '../../types';
import { EspnProvider } from './espn';
import { MlbProvider } from './mlb';
import { mapLimit } from './http';
import type { BuildPoolOptions, LiveGameStats, PoolPlayer, ProviderGame, SportProvider } from './types';

const providers: Record<Sport, SportProvider> = {
  nfl: new EspnProvider('nfl'),
  ncaaf: new EspnProvider('ncaaf'),
  mlb: new MlbProvider(),
  nba: new EspnProvider('nba'),
};

export function providerFor(sport: Sport): SportProvider {
  return providers[sport];
}

/** Games for one sport across a range of days, sorted by start time. */
export async function listGamesRange(sport: Sport, startDate: Date, days: number): Promise<ProviderGame[]> {
  const dates: string[] = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(startDate.getTime() + i * 86_400_000);
    dates.push(d.toISOString().slice(0, 10));
  }
  const provider = providerFor(sport);
  const batches = await mapLimit(dates, 3, async (date) => {
    try {
      return await provider.listGames(date);
    } catch {
      return [] as ProviderGame[];
    }
  });
  const seen = new Set<string>();
  return batches
    .flat()
    .filter((game) => (seen.has(game.id) ? false : (seen.add(game.id), true)))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

/** Build the combined player pool for a multi-sport set of games. */
export async function buildPlayerPool(games: ProviderGame[], options: BuildPoolOptions = {}): Promise<PoolPlayer[]> {
  const sports = Array.from(new Set(games.map((g) => g.sport)));
  const pools = await mapLimit(sports, 2, (sport) =>
    providerFor(sport).buildPool(
      games.filter((g) => g.sport === sport),
      options,
    ),
  );
  return pools.flat();
}

/** Poll live stats for every game in a contest. */
export async function fetchLiveForGames(games: ProviderGame[]): Promise<LiveGameStats[]> {
  const results = await mapLimit(games, 4, async (game) => {
    try {
      return await providerFor(game.sport).fetchLive(game);
    } catch {
      return null;
    }
  });
  return results.filter((r): r is LiveGameStats => r !== null);
}

export type { BuildPoolOptions, LiveGameStats, PoolPlayer, ProviderGame, SportProvider };
