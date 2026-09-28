import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  Timestamp,
  updateDoc,
  writeBatch,
  type DocumentData,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import { poolChunkSignature } from './engine/liveSync';
import type { Contest, ContestPlayer, Entry, LineupSelection, Standing } from '../types';

/**
 * Firestore access layer.
 *
 * Layout:
 *   contests/{contestId}                    contest configuration and state
 *   contests/{contestId}/pool/{chunkId}     player pool in chunks of 80
 *   contests/{contestId}/entries/{uid}      one private entry per user
 *   contests/{contestId}/standings/{uid}    public entrant record, never a roster
 *
 * The pool is chunked rather than one document per player so that a contest page
 * costs a handful of reads instead of several hundred, and so live scoring
 * updates arrive as a few realtime snapshots.
 */

const CONTESTS = 'contests';
const POOL = 'pool';
const ENTRIES = 'entries';
const STANDINGS = 'standings';
const CHUNK_SIZE = 80;

function chunkId(index: number): string {
  return `chunk-${String(index).padStart(3, '0')}`;
}

function contestFromDoc(id: string, data: DocumentData): Contest {
  return {
    id,
    name: data.name ?? 'Contest',
    joinCode: data.joinCode ?? '',
    ownerId: data.ownerId ?? '',
    ownerName: data.ownerName ?? undefined,
    members: Array.isArray(data.members) ? data.members : [],
    sports: data.sports ?? [],
    games: data.games ?? [],
    rosterSlots: data.rosterSlots ?? [],
    scoring: data.scoring ?? {},
    normalization: data.normalization ?? { factors: {}, anchors: {}, baselineAnchor: 0, method: {}, computedAt: '' },
    salaryCapInfo: data.salaryCapInfo ?? {
      cap: 0,
      minLineupCost: 0,
      maxLineupCost: 0,
      medianLineupCost: 0,
      aggressiveness: 0,
    },
    scoringBaseline: data.scoringBaseline ?? 0,
    gameWinner: data.gameWinner ?? { enabled: false, bonusPercent: 0, bonusPoints: 0 },
    // Absent on contests created before captains existed, which means disabled.
    captain: data.captain ?? undefined,
    lockTime: data.lockTime ?? '',
    lastGameStart: data.lastGameStart ?? '',
    status: data.status ?? 'open',
    finalizedAt: data.finalizedAt ?? null,
    lastSyncAt: data.lastSyncAt ?? null,
    lastSpreadCheckAt: data.lastSpreadCheckAt ?? null,
    scoringLog: data.scoringLog ?? [],
    results: data.results ?? undefined,
    playerCount: data.playerCount ?? 0,
    entrantCount: data.entrantCount ?? 0,
    createdAt: data.createdAt ?? '',
    updatedAt: data.updatedAt ?? '',
    notes: data.notes ?? '',
  };
}

/** Everything written to the contest document, including the rules-facing lock. */
function contestToDoc(contest: Contest): DocumentData {
  const { id: _id, ...rest } = contest;
  return {
    ...rest,
    // `lockAt` is the timestamp the security rules compare against request.time.
    lockAt: Timestamp.fromDate(new Date(contest.lockTime)),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * The contests this device can see: the ones it created and the ones it joined
 * with a code. Nothing lists every contest, so a code is the only way in.
 *
 * The sort happens here rather than in the query because ordering an
 * `array-contains` query by another field would need a composite index, and a
 * player's list of contests is small.
 */
export function listenMyContests(
  uid: string,
  onChange: (contests: Contest[]) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  const q = query(collection(db, CONTESTS), where('members', 'array-contains', uid));
  return onSnapshot(
    q,
    (snapshot) =>
      onChange(
        snapshot.docs
          .map((d) => contestFromDoc(d.id, d.data()))
          .sort((a, b) => b.lockTime.localeCompare(a.lockTime)),
      ),
    (error) => onError?.(error),
  );
}

/** Six digits, never starting a run of zeros that reads like a typo. */
function newJoinCode(): string {
  const bytes = new Uint32Array(1);
  globalThis.crypto?.getRandomValues?.(bytes);
  const value = bytes[0] || Math.floor(Math.random() * 0xffffffff);
  return String(100_000 + (value % 900_000));
}

/** A code no live contest is already using. */
async function uniqueJoinCode(database: Firestore = db): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = newJoinCode();
    const taken = await getDocs(
      query(collection(database, CONTESTS), where('joinCode', '==', code), limit(1)),
    );
    if (taken.empty) return code;
  }
  throw new Error('Could not allocate a join code. Try again.');
}

export async function findContestByJoinCode(code: string): Promise<Contest | null> {
  const snapshot = await getDocs(
    query(collection(db, CONTESTS), where('joinCode', '==', code.trim()), limit(1)),
  );
  const found = snapshot.docs[0];
  return found ? contestFromDoc(found.id, found.data()) : null;
}

/** Add this device to a contest's members, so it appears on their contests page. */
export async function joinContest(contestId: string, uid: string): Promise<void> {
  await updateDoc(doc(db, CONTESTS, contestId), {
    members: arrayUnion(uid),
    updatedAt: new Date().toISOString(),
  });
}

export function listenContest(
  contestId: string,
  onChange: (contest: Contest | null) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, CONTESTS, contestId),
    (snapshot) => onChange(snapshot.exists() ? contestFromDoc(snapshot.id, snapshot.data()) : null),
    (error) => onError?.(error),
  );
}

export async function getContest(contestId: string, database: Firestore = db): Promise<Contest | null> {
  const snapshot = await getDoc(doc(database, CONTESTS, contestId));
  return snapshot.exists() ? contestFromDoc(snapshot.id, snapshot.data()) : null;
}

export async function listContestsOnce(database: Firestore = db): Promise<Contest[]> {
  const snapshot = await getDocs(collection(database, CONTESTS));
  return snapshot.docs.map((d) => contestFromDoc(d.id, d.data()));
}

/* ------------------------------------------------- creating and editing ---- */

export interface CreateContestInput
  extends Omit<Contest, 'id' | 'createdAt' | 'updatedAt' | 'entrantCount' | 'joinCode' | 'members'> {
  players: ContestPlayer[];
}

/**
 * Create a contest and its player pool. Anyone can do this; whoever does
 * becomes its owner and gets the join code to hand out.
 */
export async function createContest(input: CreateContestInput): Promise<string> {
  const { players, ...contest } = input;
  const reference = doc(collection(db, CONTESTS));
  const now = new Date().toISOString();
  const full: Contest = {
    ...contest,
    id: reference.id,
    joinCode: await uniqueJoinCode(),
    members: [contest.ownerId],
    entrantCount: 0,
    playerCount: players.length,
    createdAt: now,
    updatedAt: now,
  };

  const batch = writeBatch(db);
  batch.set(reference, contestToDoc(full));
  writePoolChunks(batch, reference.id, players);
  await batch.commit();
  return reference.id;
}

/** Replace a contest's configuration and, optionally, its whole player pool. */
export async function updateContest(
  contestId: string,
  contest: Contest,
  players?: ContestPlayer[],
): Promise<void> {
  const batch = writeBatch(db);
  batch.set(
    doc(db, CONTESTS, contestId),
    { ...contestToDoc(contest), playerCount: players?.length ?? contest.playerCount },
    { merge: true },
  );
  if (players) {
    const existing = await getDocs(collection(db, CONTESTS, contestId, POOL));
    for (const stale of existing.docs) batch.delete(stale.ref);
    writePoolChunks(batch, contestId, players);
  }
  await batch.commit();
}

export async function patchContest(contestId: string, patch: Partial<Contest>): Promise<void> {
  const data: DocumentData = { ...patch, updatedAt: new Date().toISOString() };
  if (patch.lockTime) data.lockAt = Timestamp.fromDate(new Date(patch.lockTime));
  await updateDoc(doc(db, CONTESTS, contestId), data);
}

export async function deleteContest(contestId: string): Promise<void> {
  const collections = [POOL, ENTRIES, STANDINGS];
  for (const name of collections) {
    // Entries cannot be listed before a contest locks, so a pre-lock delete may
    // leave entry documents behind. They are unreachable once the contest is
    // gone, so the delete continues rather than failing.
    const snapshot = await getDocs(collection(db, CONTESTS, contestId, name)).catch(() => null);
    if (!snapshot) continue;
    // Batches cap at 500 writes.
    for (let i = 0; i < snapshot.docs.length; i += 400) {
      const batch = writeBatch(db);
      for (const document of snapshot.docs.slice(i, i + 400)) batch.delete(document.ref);
      await batch.commit();
    }
  }
  await deleteDoc(doc(db, CONTESTS, contestId));
}

function writePoolChunks(
  batch: ReturnType<typeof writeBatch>,
  contestId: string,
  players: ContestPlayer[],
): void {
  for (let index = 0; index * CHUNK_SIZE < players.length; index += 1) {
    const slice = players.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE);
    batch.set(doc(db, CONTESTS, contestId, POOL, chunkId(index)), {
      index,
      players: slice,
      updatedAt: new Date().toISOString(),
    });
  }
}

/**
 * Push live scoring into the pool. Only chunks whose contents changed are
 * written, which keeps a 30-second polling loop inexpensive.
 */
export async function writeLivePool(contestId: string, players: ContestPlayer[]): Promise<number> {
  const existing = await getDocs(collection(db, CONTESTS, contestId, POOL));
  const previous = new Map<string, string>();
  for (const document of existing.docs) {
    previous.set(document.id, poolChunkSignature((document.data().players as ContestPlayer[]) ?? []));
  }

  let written = 0;
  const batch = writeBatch(db);
  for (let index = 0; index * CHUNK_SIZE < players.length; index += 1) {
    const slice = players.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE);
    const id = chunkId(index);
    if (previous.get(id) === poolChunkSignature(slice)) continue;
    batch.set(doc(db, CONTESTS, contestId, POOL, id), {
      index,
      players: slice,
      updatedAt: new Date().toISOString(),
    });
    written += 1;
  }
  if (written > 0) await batch.commit();
  return written;
}

/* ------------------------------------------------------------------- pool ---- */

export function listenPool(
  contestId: string,
  onChange: (players: ContestPlayer[]) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db, CONTESTS, contestId, POOL),
    (snapshot) => {
      const chunks = snapshot.docs
        .map((d) => ({ index: (d.data().index as number) ?? 0, players: (d.data().players as ContestPlayer[]) ?? [] }))
        .sort((a, b) => a.index - b.index);
      onChange(chunks.flatMap((chunk) => chunk.players));
    },
    (error) => onError?.(error),
  );
}

export async function getPool(contestId: string, database: Firestore = db): Promise<ContestPlayer[]> {
  const snapshot = await getDocs(collection(database, CONTESTS, contestId, POOL));
  return snapshot.docs
    .map((d) => ({ index: (d.data().index as number) ?? 0, players: (d.data().players as ContestPlayer[]) ?? [] }))
    .sort((a, b) => a.index - b.index)
    .flatMap((chunk) => chunk.players);
}

/* ---------------------------------------------------------------- entries ---- */

export interface SaveEntryInput {
  contestId: string;
  uid: string;
  displayName: string;
  teamName?: string;
  lineup: LineupSelection[];
  picks: Record<string, string>;
  salaryUsed: number;
  lockedSnapshot?: Entry['lockedSnapshot'];
}

/** Write (or rewrite) the signed-in user's own entry plus its public record. */
export async function saveEntry(input: SaveEntryInput): Promise<void> {
  const now = new Date().toISOString();
  const entryRef = doc(db, CONTESTS, input.contestId, ENTRIES, input.uid);
  const existing = await getDoc(entryRef);

  const entry: Entry = {
    uid: input.uid,
    displayName: input.displayName,
    teamName: input.teamName,
    lineup: input.lineup,
    picks: input.picks,
    salaryUsed: input.salaryUsed,
    submittedAt: existing.exists() ? (existing.data().submittedAt as string) ?? now : now,
    updatedAt: now,
    ...(input.lockedSnapshot ? { lockedSnapshot: input.lockedSnapshot } : {}),
  };

  const standing: Standing = {
    uid: input.uid,
    displayName: input.displayName,
    teamName: input.teamName,
    enteredAt: entry.submittedAt,
    submitted: true,
  };

  // One batch, so a user is never entered without appearing in the standings.
  // Entering also counts as joining, which keeps the contest on their list even
  // if they arrived by a shared link rather than by typing the code.
  const batch = writeBatch(db);
  batch.set(entryRef, entry);
  batch.set(doc(db, CONTESTS, input.contestId, STANDINGS, input.uid), standing);
  batch.update(doc(db, CONTESTS, input.contestId), { members: arrayUnion(input.uid) });
  await batch.commit();
}

export async function getMyEntry(contestId: string, uid: string): Promise<Entry | null> {
  const snapshot = await getDoc(doc(db, CONTESTS, contestId, ENTRIES, uid));
  return snapshot.exists() ? (snapshot.data() as Entry) : null;
}

export function listenMyEntry(
  contestId: string,
  uid: string,
  onChange: (entry: Entry | null) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, CONTESTS, contestId, ENTRIES, uid),
    (snapshot) => onChange(snapshot.exists() ? (snapshot.data() as Entry) : null),
    (error) => onError?.(error),
  );
}

/**
 * All submitted entries. Security rules only permit listing this collection
 * once the contest has locked, so pre-lock this listener fails closed and the
 * leaderboard falls back to the public standings.
 */
export function listenEntries(
  contestId: string,
  onChange: (entries: Entry[]) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db, CONTESTS, contestId, ENTRIES),
    (snapshot) => onChange(snapshot.docs.map((d) => d.data() as Entry)),
    (error) => onError?.(error),
  );
}

export async function getEntries(contestId: string, database: Firestore = db): Promise<Entry[]> {
  const snapshot = await getDocs(collection(database, CONTESTS, contestId, ENTRIES));
  return snapshot.docs.map((d) => d.data() as Entry);
}

/* -------------------------------------------------------------- standings ---- */

export function listenStandings(
  contestId: string,
  onChange: (standings: Standing[]) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db, CONTESTS, contestId, STANDINGS),
    (snapshot) => onChange(snapshot.docs.map((d) => d.data() as Standing)),
    (error) => onError?.(error),
  );
}

export async function getStandings(contestId: string, database: Firestore = db): Promise<Standing[]> {
  const snapshot = await getDocs(collection(database, CONTESTS, contestId, STANDINGS));
  return snapshot.docs.map((d) => d.data() as Standing);
}

export async function countEntrants(contestId: string): Promise<number> {
  const snapshot = await getCountFromServer(collection(db, CONTESTS, contestId, STANDINGS));
  return snapshot.data().count;
}

export { serverTimestamp };
