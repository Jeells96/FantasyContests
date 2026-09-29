/**
 * Re-trace scoring feed entries that were recorded without a play.
 *
 * Entries written before changes were matched to plays — or during a round
 * that spanned more of the game than its search window — carry no down,
 * distance or clock. Each one still knows when it happened, so the play behind
 * it can be found after the fact: the newest play at or before that moment
 * that names the player and belongs to their team.
 *
 *   npm run repair:feed -- --dry
 *   npm run repair:feed
 */
import { initializeApp } from 'firebase/app';
import { collection, doc, getDocs, initializeFirestore, updateDoc, type Firestore } from 'firebase/firestore';
import { providerFor } from '../src/lib/providers/index';
import { findPlay } from '../src/lib/engine/liveSync';
import type { Contest, ContestPlayer, ScoringLogEntry } from '../src/types';

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const config = {
  apiKey: process.env.FIREBASE_API_KEY ?? 'AIzaSyBQzn4hcka-PM4Ns7OO22p7OgvQ4iQ4do8',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN ?? 'stocks-b13c5.firebaseapp.com',
  projectId: process.env.FIREBASE_PROJECT_ID ?? 'stocks-b13c5',
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET ?? 'stocks-b13c5.firebasestorage.app',
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID ?? '1011539617993',
  appId: process.env.FIREBASE_APP_ID ?? '1:1011539617993:web:b5e3dce1c1a43a7d634518',
};

async function main(): Promise<void> {
  const dry = flag('dry');
  const db: Firestore = initializeFirestore(initializeApp(config), { ignoreUndefinedProperties: true });
  const contests = await getDocs(collection(db, 'contests'));

  for (const document of contests.docs) {
    const contest = { id: document.id, ...(document.data() as Omit<Contest, 'id'>) };
    const log = contest.scoringLog ?? [];
    const bare = log.filter((entry) => !entry.playId);
    if (bare.length === 0) continue;

    const pool = await loadPool(db, contest.id);
    const byId = new Map(pool.map((player) => [player.id, player]));
    const plays = new Map<string, Awaited<ReturnType<typeof playsFor>>>();
    for (const game of contest.games) plays.set(game.id, await playsFor(game));

    let repaired = 0;
    const next: ScoringLogEntry[] = log.map((entry) => {
      if (entry.playId) return entry;
      const player = byId.get(entry.playerId);
      const game = contest.games.find((candidate) => candidate.id === player?.gameId);
      const all = player ? plays.get(player.gameId) ?? [] : [];
      if (!player || all.length === 0) return entry;

      // Only plays that had already happened when this was recorded.
      const recorded = Date.parse(entry.at);
      const before = all.filter((play) => {
        const at = Date.parse(play.wallclock ?? '');
        return Number.isFinite(at) && Number.isFinite(recorded) ? at <= recorded + 60_000 : true;
      });
      const play = findPlay(player, before, game, entry.delta);
      if (!play) return entry;
      repaired += 1;
      return {
        ...entry,
        playId: `${player.gameId}-${play.id}`,
        situation: play.detail,
        clock: play.clock,
        scoreLine: game
          ? `${game.away.abbreviation} ${play.awayScore} - ${play.homeScore} ${game.home.abbreviation}`
          : entry.scoreLine,
        at: play.wallclock ?? entry.at,
      };
    });

    console.log(`${contest.name}: ${repaired} of ${bare.length} untraced entries re-traced${dry ? ' (dry run)' : ''}`);
    if (!dry && repaired > 0) {
      await updateDoc(doc(db, 'contests', contest.id), {
        scoringLog: next.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
        updatedAt: new Date().toISOString(),
      });
    }
  }
}

async function loadPool(db: Firestore, contestId: string): Promise<ContestPlayer[]> {
  const snapshot = await getDocs(collection(db, 'contests', contestId, 'pool'));
  return snapshot.docs
    .map((document) => ({
      index: (document.data().index as number) ?? 0,
      players: (document.data().players as ContestPlayer[]) ?? [],
    }))
    .sort((a, b) => a.index - b.index)
    .flatMap((chunk) => chunk.players);
}

async function playsFor(game: Contest['games'][number]) {
  const live = await providerFor(game.sport).fetchLive(game).catch(() => null);
  return live?.plays ?? [];
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
