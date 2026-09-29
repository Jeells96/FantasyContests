/**
 * MLB pricing smoke check.
 *
 * Builds a real slate and prints who the pool thinks is playing, so the
 * starter emphasis can be seen against the actual feed:
 *
 *   npm run check:mlb -- --date=2026-09-27 --games=2
 */
import { buildPlayerPool, listGamesRange } from '../src/lib/providers/index';
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

  const games = await listGamesRange('mlb', new Date(`${date}T12:00:00Z`), 1);
  const picked = games.slice(0, count);
  console.log(`${picked.length} of ${games.length} games on ${date}`);
  if (picked.length === 0) return;

  const pool = await buildPlayerPool(picked, { onProgress: () => {} });
  const slots = buildDefaultRoster(['mlb']);
  const priced = priceContest(pool, slots, defaultScoringFor(['mlb']), picked, {
    enabled: true,
    multiplier: 1.5,
  });

  const byPosition = new Map<string, number>();
  for (const player of priced.players) {
    byPosition.set(player.position, (byPosition.get(player.position) ?? 0) + 1);
  }
  console.log(`pool ${priced.players.length} · cap $${priced.salaryCapInfo.cap}`);
  console.log('positions:', [...byPosition.entries()].map(([k, v]) => `${k}=${v}`).join(' '));

  const show = (title: string, list: typeof priced.players) => {
    console.log(`\n${title}`);
    for (const p of list.slice(0, 8)) {
      const note = p.availabilityNote ? ` — ${p.availabilityNote}` : '';
      console.log(
        `  $${String(p.salary).padStart(6)} ${p.name.padEnd(22)} ${p.position.padEnd(3)} ${p.teamAbbr} ` +
          `proj ${p.projection.normalized.toFixed(1)} · avail ${(p.availability ?? 1).toFixed(2)}${note}`,
      );
    }
  };

  const sorted = [...priced.players].sort((a, b) => b.salary - a.salary);
  show('most expensive:', sorted);
  show('cheapest:', [...sorted].reverse());
  show('pitchers:', sorted.filter((p) => p.position === 'SP' || p.position === 'RP'));
  show('starters not starting tonight:', sorted.filter((p) => p.availabilityNote === 'Not starting tonight'));
  const starters = priced.players.filter((p) => (p.availability ?? 1) === 1);
  const benched = priced.players.filter((p) => (p.availability ?? 1) < 1);
  const avg = (list: typeof priced.players) =>
    list.length === 0 ? 0 : Math.round(list.reduce((sum, p) => sum + p.salary, 0) / list.length);
  console.log(`\nexpected to play: ${starters.length}, average $${avg(starters)}`);
  console.log(`not expected to play: ${benched.length}, average $${avg(benched)}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
