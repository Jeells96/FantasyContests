/**
 * Engine smoke check.
 *
 * Pulls real games from the live feeds, builds a player pool, prices it and
 * prints the salary hierarchy, automatic cap, normalization factors and the
 * scoring baseline, so the automatic pricing can be sanity-checked against
 * actual data without touching Firebase.
 *
 *   npm run check:engine -- --sports=nfl,mlb --date=2026-09-27 --games=4
 */
import { buildPlayerPool, fetchLiveForGames, listGamesRange } from '../src/lib/providers/index';
import { priceContest, gameWinnerBonusPoints } from '../src/lib/engine/pricing';
import { buildDefaultRoster } from '../src/lib/engine/roster';
import { defaultScoringFor } from '../src/lib/scoring';
import { validateLineup } from '../src/lib/engine/lineup';
import { applyLiveResults } from '../src/lib/engine/liveSync';
import type { Contest, Sport } from '../src/types';

function arg(name: string, fallback: string): string {
  const match = process.argv.find((value) => value.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : fallback;
}

const sports = arg('sports', 'nfl').split(',').filter(Boolean) as Sport[];
const date = arg('date', new Date().toISOString().slice(0, 10));
const maxGames = Number(arg('games', '3'));

function money(value: number): string {
  return `$${value.toLocaleString('en-US')}`;
}

async function main(): Promise<void> {
  console.log(`\n=== Engine check · ${sports.join('+').toUpperCase()} · from ${date} ===\n`);

  const schedules = await Promise.all(
    sports.map((sport) => listGamesRange(sport, new Date(`${date}T00:00:00Z`), 2)),
  );
  const games = sports
    .flatMap((sport, index) => schedules[index].slice(0, maxGames).map((game) => ({ ...game, sport })))
    .slice(0, maxGames * sports.length);

  if (games.length === 0) {
    console.log('No games found for that date.');
    return;
  }
  for (const game of games) {
    console.log(`  game ${game.sport.toUpperCase()} ${game.shortName}  ${game.startTime}  [${game.state}]`);
  }

  console.log('\nBuilding player pool…');
  const started = Date.now();
  const pool = await buildPlayerPool(games, {
    recentFormLimit: 40,
    onProgress: (message) => console.log(`  · ${message}`),
  });
  console.log(`  pool: ${pool.length} players in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  for (const sport of sports) {
    const forSport = pool.filter((player) => player.sport === sport);
    const withStats = forSport.filter((player) => player.gamesPlayed > 0).length;
    const withRecent = forSport.filter((player) => player.recentStats).length;
    console.log(`  ${sport}: ${forSport.length} players · ${withStats} with season stats · ${withRecent} with recent form`);
  }

  const rosterSlots = buildDefaultRoster(sports);
  const scoring = defaultScoringFor(sports);
  const pricing = priceContest(pool, rosterSlots, scoring, games);

  console.log(`\nRoster (${rosterSlots.length}): ${rosterSlots.map((slot) => slot.label).join(' ')}`);
  console.log('\nNormalization');
  for (const sport of sports) {
    console.log(
      `  ${sport}: ×${(pricing.normalization.factors[sport] ?? 1).toFixed(3)}` +
        ` (anchor ${(pricing.normalization.anchors[sport] ?? 0).toFixed(2)}, ${pricing.normalization.method[sport]})`,
    );
  }
  console.log(`  baseline anchor: ${pricing.normalization.baselineAnchor.toFixed(2)}`);

  console.log('\nSalary cap');
  const capInfo = pricing.salaryCapInfo;
  console.log(`  cheapest lineup : ${money(capInfo.minLineupCost)}`);
  console.log(`  median lineup   : ${money(capInfo.medianLineupCost)}`);
  console.log(`  all-stars lineup: ${money(capInfo.maxLineupCost)}`);
  console.log(`  >>> cap         : ${money(capInfo.cap)}  (aggressiveness ${capInfo.aggressiveness})`);
  console.log(`  cap / all-stars : ${((capInfo.cap / capInfo.maxLineupCost) * 100).toFixed(1)}%`);

  console.log(`\nScoring baseline: ${pricing.scoringBaseline.toFixed(1)} contest points`);
  console.log(`Game-winner bonus at 5%: +${gameWinnerBonusPoints(pricing.scoringBaseline, 5).toFixed(2)} per pick`);

  const byPosition = new Map<string, typeof pricing.players>();
  for (const player of pricing.players) {
    const key = `${player.sport}:${player.position}`;
    byPosition.set(key, [...(byPosition.get(key) ?? []), player]);
  }
  console.log('\nSalary range by position');
  for (const [key, players] of [...byPosition.entries()].sort()) {
    const salaries = players.map((player) => player.salary).sort((a, b) => b - a);
    console.log(
      `  ${key.padEnd(10)} n=${String(players.length).padStart(3)}  ${money(salaries[0]).padStart(8)} → ${money(
        salaries[salaries.length - 1],
      ).padStart(8)}  median ${money(salaries[Math.floor(salaries.length / 2)])}`,
    );
  }

  console.log('\nTop 15 salaries');
  for (const player of [...pricing.players].sort((a, b) => b.salary - a.salary).slice(0, 15)) {
    console.log(
      `  ${money(player.salary).padStart(8)}  ${player.position.padEnd(4)} ${player.name.padEnd(24)}` +
        ` ${player.teamAbbr}${player.isHome ? ' vs ' : ' @ '}${player.opponentAbbr}` +
        `  proj ${player.projection.normalized.toFixed(1)} (raw ${player.projection.raw.toFixed(1)})`,
    );
  }

  console.log('\nCheapest 5 salaries');
  for (const player of [...pricing.players].sort((a, b) => a.salary - b.salary).slice(0, 5)) {
    console.log(`  ${money(player.salary).padStart(8)}  ${player.position.padEnd(4)} ${player.name}`);
  }

  // A greedy "best projection under the cap" lineup proves the cap is workable.
  const playersById = new Map(pricing.players.map((player) => [player.id, player]));
  const used = new Set<string>();
  const lineup: { slotId: string; playerId: string }[] = [];
  let spend = 0;
  const ordered = [...rosterSlots].sort(
    (a, b) =>
      pricing.players.filter((p) => !a.positions.includes('*') && a.positions.some((pos) => p.positions.includes(pos))).length -
      pricing.players.filter((p) => !b.positions.includes('*') && b.positions.some((pos) => p.positions.includes(pos))).length,
  );
  for (const slot of ordered) {
    const candidates = pricing.players
      .filter(
        (player) =>
          !used.has(player.id) &&
          (!slot.sport || player.sport === slot.sport) &&
          (slot.positions.includes('*') || slot.positions.some((pos) => player.positions.includes(pos))),
      )
      .sort((a, b) => b.projection.normalized / b.salary - a.projection.normalized / a.salary);
    const affordable = candidates.filter((player) => spend + player.salary <= capInfo.cap);
    const pick =
      affordable[0] ?? [...candidates].sort((a, b) => a.salary - b.salary)[0];
    if (!pick) continue;
    used.add(pick.id);
    spend += pick.salary;
    lineup.push({ slotId: slot.id, playerId: pick.id });
  }
  const validation = validateLineup(lineup, playersById, rosterSlots, capInfo.cap);
  console.log(`\nValue lineup built greedily: ${money(validation.salaryUsed)} / ${money(capInfo.cap)} · valid=${validation.valid}`);
  if (!validation.valid) console.log(`  errors: ${validation.errors.join('; ')}`);

  console.log('\nLive stats check…');
  const live = await fetchLiveForGames(games);
  const contest = {
    games,
    scoring,
    normalization: pricing.normalization,
    finalizedAt: null,
    lockTime: games[0].startTime,
  } as unknown as Contest;
  const applied = applyLiveResults(contest, pricing.players, live);
  console.log(`  feeds returned ${live.length}/${games.length} games · status ${applied.status}`);
  for (const game of applied.games) {
    console.log(`  ${game.shortName}: ${game.away.score ?? 0}-${game.home.score ?? 0} [${game.state}] winner=${game.winnerTeamId ?? '—'}`);
  }
  console.log(`  players with points: ${applied.scoringPlayers}`);
  for (const player of [...applied.players].sort((a, b) => (b.normalizedPoints ?? 0) - (a.normalizedPoints ?? 0)).slice(0, 10)) {
    console.log(
      `  ${(player.normalizedPoints ?? 0).toFixed(1).padStart(6)} pts (raw ${(player.rawPoints ?? 0).toFixed(1).padStart(6)})  ` +
        `${player.position.padEnd(4)} ${player.name.padEnd(22)} ${player.statLine ?? ''}`,
    );
  }
  console.log('\nDone.\n');
}

main().catch((error) => {
  console.error('engine-check failed:', error);
  process.exit(1);
});
