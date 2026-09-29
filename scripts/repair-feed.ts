/**
 * Put a scoring feed straight.
 *
 * Two things go wrong in a recorded feed. A round that ran after a long gap
 * folds in everything that happened while nothing was watching, so one entry
 * covers many plays — naming a play for that is false precision, and it is how
 * a receiver came to be credited nineteen points for a thirteen-yard catch.
 * Separately, entries recorded before changes were matched to plays carry no
 * down or clock at all, and those can be traced after the fact.
 *
 * A round is recognised by the timestamp its entries share. One that produced a
 * crowd of entries at once was catching up, so its entries lose any play they
 * claim; a round that produced a handful was watching the game, so its untraced
 * entries get the play they belong to.
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

/** A round that recorded this many changes at once was catching up, not watching. */
const CATCH_UP_ENTRIES = 8;

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
    if (log.length === 0) continue;

    // Entries written by the same round share the timestamp in their id.
    const roundOf = (entry: ScoringLogEntry): string => entry.id.split('-').slice(1).join('-');
    const roundSize = new Map<string, number>();
    for (const entry of log) roundSize.set(roundOf(entry), (roundSize.get(roundOf(entry)) ?? 0) + 1);
    const wasCatchUp = (entry: ScoringLogEntry): boolean =>
      (roundSize.get(roundOf(entry)) ?? 0) >= CATCH_UP_ENTRIES;

    const bare = log.filter((entry) => !entry.playId && !wasCatchUp(entry));
    const overclaimed = log.filter((entry) => entry.playId && wasCatchUp(entry));
    if (bare.length === 0 && overclaimed.length === 0) continue;

    const pool = await loadPool(db, contest.id);
    const byId = new Map(pool.map((player) => [player.id, player]));
    const plays = new Map<string, Awaited<ReturnType<typeof playsFor>>>();
    for (const game of contest.games) plays.set(game.id, await playsFor(game));

    let repaired = 0;
    let stripped = 0;
    const next: ScoringLogEntry[] = log.map((entry) => {
      if (wasCatchUp(entry)) {
        if (!entry.playId) return entry;
        // It covered many plays; it does not get to name one.
        stripped += 1;
        const { playId: _playId, situation: _situation, clock: _clock, ...rest } = entry;
        return rest;
      }
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

    console.log(
      `${contest.name}: ${repaired} of ${bare.length} traced, ${stripped} catch-up entries unclaimed` +
        `${dry ? ' (dry run)' : ''}`,
    );
    if (!dry && repaired + stripped > 0) {
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
