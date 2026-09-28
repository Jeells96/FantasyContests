/**
 * College football smoke check.
 *
 * Pulls a real slate, builds the pool, prices it and reads live statistics, so
 * the new sport can be verified against the actual feed:
 *
 *   npm run check:cfb -- --date=2026-09-26 --games=2
 */
import { buildPlayerPool, fetchLiveForGames, listGamesRange } from '../src/lib/providers/index';
import { priceContest } from '../src/lib/engine/pricing';
import { buildDefaultRoster } from '../src/lib/engine/roster';
import { defaultScoringFor } from '../src/lib/scoring';

function arg(name: string, fallback: string): string {
  const match = process.argv.find((value) => value.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : fallback;
}

async function main(): Promise<void> {
  const date = arg('date', new Date().toISOString().slice(0, 10));
  const count = Number(arg('games', '2'));

  const games = await listGamesRange('ncaaf', new Date(`${date}T12:00:00Z`), 2);
  console.log(`games on ${date}: ${games.length}`);
  const picked = games.slice(0, count);
  for (const game of picked) console.log(`  ${game.shortName} · ${game.state} · ${game.statusDetail}`);
  if (picked.length === 0) return;

  const pool = await buildPlayerPool(picked, { onProgress: () => {}, recentFormLimit: 20 });
  console.log(`pool: ${pool.length} players`);

  const slots = buildDefaultRoster(['ncaaf']);
  const priced = priceContest(pool, slots, defaultScoringFor(['ncaaf']), picked, {
    enabled: true,
    multiplier: 1.5,
  });
  console.log(`cap $${priced.salaryCapInfo.cap} · ${slots.length} spots`);
  for (const player of [...priced.players].sort((a, b) => b.salary - a.salary).slice(0, 6)) {
    console.log(
      `  $${String(player.salary).padStart(6)} ${player.name.padEnd(22)} ${player.position.padEnd(4)} ` +
        `${player.teamAbbr} proj ${player.projection.normalized.toFixed(1)}`,
    );
  }

  const live = await fetchLiveForGames(picked);
  const withStats = live.flatMap((game) => Object.entries(game.players)).filter(([, stats]) => Object.keys(stats).length > 0);
  console.log(`live: ${withStats.length} players with statistics, ${live[0]?.plays?.length ?? 0} plays`);
  for (const [id, stats] of live
    .flatMap((game) => Object.entries(game.players))
    .filter(([id]) => id.startsWith('dst'))
    .slice(0, 2)) {
    console.log(`  ${id}: ${JSON.stringify(stats)}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
