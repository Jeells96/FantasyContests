/**
 * Headless live scoring worker.
 *
 * Polls the sports feeds and writes raw + normalized fantasy points into each
 * running contest's player pool, so every connected browser updates through
 * Firestore without refreshing.
 *
 *   npm run live-sync
 *   npm run live-sync -- --contest=<id> --interval=30 --once
 *
 * Behind an HTTP proxy, prefix with NODE_USE_ENV_PROXY=1 (Node >= 22.21) so
 * Node's fetch honours HTTPS_PROXY.
 */
import { initializeApp } from 'firebase/app';
import {
  collection,
  doc,
  getDocs,
  initializeFirestore,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { fetchLiveForGames } from '../src/lib/providers/index';
import { applyLiveResults, mergeScoringLog, poolChunkSignature } from '../src/lib/engine/liveSync';
import { allGamesFinal, deriveStatus, isContestLocked } from '../src/lib/engine/contestState';
import { buildLeaderboard, toResults } from '../src/lib/engine/leaderboard';
import type { Contest, ContestPlayer, Entry, Standing } from '../src/types';

const CHUNK_SIZE = 80;

function arg(name: string): string | undefined {
  const match = process.argv.find((value) => value.startsWith(`--${name}=`));
  return match?.slice(name.length + 3);
}

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

const onlyContest = arg('contest');
const intervalSeconds = Number(arg('interval') ?? '30');
const once = flag('once');
const autoFinalize = !flag('no-finalize');

function log(message: string): void {
  console.log(`${new Date().toISOString()} ${message}`);
}

async function loadContests(db: Firestore): Promise<Contest[]> {
  const snapshot = await getDocs(collection(db, 'contests'));
  return snapshot.docs.map((document) => ({ id: document.id, ...(document.data() as Omit<Contest, 'id'>) }));
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

/** Write only the chunks whose contents actually changed. */
async function writePool(db: Firestore, contestId: string, players: ContestPlayer[]): Promise<number> {
  const existing = await getDocs(collection(db, 'contests', contestId, 'pool'));
  const previous = new Map<string, string>();
  for (const document of existing.docs) {
    previous.set(document.id, poolChunkSignature((document.data().players as ContestPlayer[]) ?? []));
  }

  let written = 0;
  const batch = writeBatch(db);
  for (let index = 0; index * CHUNK_SIZE < players.length; index += 1) {
    const slice = players.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE);
    const id = `chunk-${String(index).padStart(3, '0')}`;
    if (previous.get(id) === poolChunkSignature(slice)) continue;
    batch.set(doc(db, 'contests', contestId, 'pool', id), {
      index,
      players: slice,
      updatedAt: new Date().toISOString(),
    });
    written += 1;
  }
  if (written > 0) await batch.commit();
  return written;
}

async function syncContest(db: Firestore, contest: Contest): Promise<void> {
  const pool = await loadPool(db, contest.id);
  if (pool.length === 0) {
    log(`  ${contest.name}: no player pool, skipping`);
    return;
  }

  const live = await fetchLiveForGames(contest.games);
  const { games, players, status, scoringPlayers, events } = applyLiveResults(contest, pool, live);
  const chunks = await writePool(db, contest.id, players);

  const standingsSnapshot = await getDocs(collection(db, 'contests', contest.id, 'standings'));
  const entrantCount = standingsSnapshot.size;

  const patch: Record<string, unknown> = {
    games,
    status,
    entrantCount,
    scoringLog: mergeScoringLog(contest.scoringLog, events),
    // Every writer has to move this on. It is what open pages check before
    // running a round of their own, and it is the window each change is traced
    // to a play within — left behind, every round starts looking like a
    // catch-up and the feed stops naming plays at all.
    lastSyncAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (autoFinalize && allGamesFinal({ games }) && !contest.finalizedAt) {
    const entriesSnapshot = await getDocs(collection(db, 'contests', contest.id, 'entries'));
    const entries = entriesSnapshot.docs.map((document) => document.data() as Entry);
    const standings = standingsSnapshot.docs.map((document) => document.data() as Standing);
    const rows = buildLeaderboard({
      contest: { ...contest, games },
      standings,
      entries,
      players: new Map(players.map((player) => [player.id, player])),
      selfUid: null,
      locked: true,
    });
    patch.results = toResults(rows);
    patch.finalizedAt = new Date().toISOString();
    patch.status = 'complete';
    log(`  ${contest.name}: finalized · winner ${rows[0]?.displayName ?? 'n/a'} (${rows[0]?.total ?? 0})`);
  }

  await updateDoc(doc(db, 'contests', contest.id), patch);
  log(
    `  ${contest.name}: ${live.length}/${contest.games.length} games · ${scoringPlayers} scoring · ` +
      `${chunks} chunk(s) · ${entrantCount} entries · ${patch.status}`,
  );
}

/** A contest needs syncing once it has locked and until every game is final. */
function needsSync(contest: Contest): boolean {
  if (onlyContest) return contest.id === onlyContest;
  if (contest.finalizedAt) return false;
  if (!isContestLocked(contest)) return false;
  return deriveStatus(contest) !== 'complete' || !contest.results;
}

async function runOnce(db: Firestore): Promise<number> {
  const contests = (await loadContests(db)).filter(needsSync);
  if (contests.length === 0) {
    log('No live contests.');
    return 0;
  }
  log(`Syncing ${contests.length} contest(s)…`);
  for (const contest of contests) {
    try {
      await syncContest(db, contest);
    } catch (error) {
      log(`  ${contest.name}: ERROR ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return contests.length;
}

async function main(): Promise<void> {
  const app = initializeApp(config);
  // Player pools contain optional fields; Firestore rejects explicit undefined.
  const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
  log(`Connected to project ${config.projectId}`);

  await runOnce(db);
  if (once) {
    process.exit(0);
  }

  log(`Polling every ${intervalSeconds}s. Ctrl-C to stop.`);
  setInterval(() => {
    void runOnce(db);
  }, Math.max(10, intervalSeconds) * 1000);
}

main().catch((error) => {
  console.error('live-sync failed:', error);
  process.exit(1);
});
