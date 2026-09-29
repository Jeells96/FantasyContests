/**
 * Who has used the site, and which pools they belong to.
 *
 * A pool is a circle of people who can invite each other — family, or work.
 * Belonging to one is what unlocks inviting at all, and you only ever see the
 * people who share a pool with you. Nothing in the player-facing app mentions
 * pools or hints that anyone is missing from one; only the admin screen knows.
 *
 * Both live under `config/` as single documents, so the open security rules
 * already cover them and nothing has to be redeployed.
 */
import {
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import { personKey } from './personKey';

export { personKey };

const CONFIG = 'config';
const PEOPLE_DOC = 'people';
const POOLS_DOC = 'pools';

export interface Pool {
  id: string;
  name: string;
}

export interface Person {
  key: string;
  firstName: string;
  lastName: string;
  displayName: string;
  /**
   * The id this person's contests and entries are stored under, shared by every
   * device they play on. It is deliberately not derived from their name: an
   * entry is readable by anyone who knows its id, so the id has to stay
   * unguessable. The first device to carry the name lends its own random id,
   * which is why merging costs that device nothing.
   */
  uid: string;
  /** Pool ids. Empty means they cannot invite and are not an invite option. */
  pools: string[];
  /** Devices that have carried this name. */
  deviceIds: string[];
  seenAt?: string;
}


function peopleFromDoc(data: Record<string, unknown> | undefined): Record<string, Person> {
  const raw = (data?.people ?? {}) as Record<string, Partial<Person>>;
  const out: Record<string, Person> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!value) continue;
    out[key] = {
      key,
      firstName: String(value.firstName ?? ''),
      lastName: String(value.lastName ?? ''),
      displayName: String(value.displayName ?? `${value.firstName ?? ''} ${value.lastName ?? ''}`).trim(),
      uid: String(value.uid ?? (Array.isArray(value.deviceIds) ? value.deviceIds[0] ?? '' : '')),
      pools: Array.isArray(value.pools) ? value.pools.map(String) : [],
      deviceIds: Array.isArray(value.deviceIds) ? value.deviceIds.map(String) : [],
      seenAt: typeof value.seenAt === 'string' ? value.seenAt : undefined,
    };
  }
  return out;
}

export function listenPeople(
  onChange: (people: Record<string, Person>) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, CONFIG, PEOPLE_DOC),
    (snapshot) => onChange(peopleFromDoc(snapshot.data() as Record<string, unknown> | undefined)),
    (error) => onError?.(error),
  );
}

export async function loadPeople(): Promise<Record<string, Person>> {
  try {
    const snapshot = await getDoc(doc(db, CONFIG, PEOPLE_DOC));
    return peopleFromDoc(snapshot.data() as Record<string, unknown> | undefined);
  } catch {
    return {};
  }
}

/**
 * Record that this device is using this name, and answer with the id that name
 * plays under.
 *
 * A name is a person, and a person is one entrant however many devices they
 * open the site on — a phone and a laptop should not be two names on a
 * leaderboard. The directory is what makes that true: the first device to
 * claim a name lends the person its own random id, and every later device is
 * told the same one. Nothing here is derived from the name itself, so an entry
 * stays as hard to find as it was.
 *
 * It runs as a transaction because the id must be minted exactly once: two
 * devices opened together would otherwise each mint their own and split the
 * person in half. Pools are still never touched — those are the admin's.
 *
 * It answers with every device on record as well, so whichever one is in hand
 * can gather up what the others left behind — a phone that is never opened
 * again would otherwise keep its half forever.
 */
export async function rememberPerson(
  firstName: string,
  lastName: string,
  deviceId: string,
): Promise<{ uid: string; deviceIds: string[] }> {
  const key = personKey(firstName, lastName);
  if (!key) return { uid: deviceId, deviceIds: [deviceId] };
  try {
    return await runTransaction(db, async (tx) => {
      const ref = doc(db, CONFIG, PEOPLE_DOC);
      const snapshot = await tx.get(ref);
      const people = ((snapshot.data()?.people ?? {}) as Record<string, Partial<Person>>) ?? {};
      const existing = people[key];
      const knownDevices = (Array.isArray(existing?.deviceIds) ? existing.deviceIds : []).map(String);
      // Adopt whatever this name already plays under. Falling back to the
      // earliest device on record is what carries contests created before
      // people had ids at all: that device keeps everything it owns.
      const uid = String(existing?.uid || knownDevices[0] || deviceId);
      const deviceIds = knownDevices.includes(deviceId) ? knownDevices : [...knownDevices, deviceId];
      tx.set(
        ref,
        {
          people: {
            [key]: {
              firstName: firstName.trim(),
              lastName: lastName.trim(),
              displayName: `${firstName.trim()} ${lastName.trim()}`,
              uid,
              deviceIds,
              seenAt: new Date().toISOString(),
            },
          },
        },
        { merge: true },
      );
      return { uid, deviceIds };
    });
  } catch {
    // Directory unreachable: play on this device's own id rather than not at
    // all. The merge happens the next time it can be reached.
    return { uid: deviceId, deviceIds: [deviceId] };
  }
}

/** Forget someone entirely, for a name that should never have been recorded. */
export async function forgetPerson(key: string): Promise<void> {
  await setDoc(doc(db, CONFIG, PEOPLE_DOC), { people: { [key]: deleteField() } }, { merge: true });
}

export async function setPersonPools(key: string, pools: string[]): Promise<void> {
  await setDoc(doc(db, CONFIG, PEOPLE_DOC), { people: { [key]: { pools } } }, { merge: true });
}

/* ------------------------------------------------------------------ pools ---- */

function poolsFromDoc(data: Record<string, unknown> | undefined): Pool[] {
  const raw = Array.isArray(data?.pools) ? (data?.pools as Partial<Pool>[]) : [];
  return raw
    .filter((pool) => pool && typeof pool.id === 'string' && pool.id !== '')
    .map((pool) => ({ id: String(pool.id), name: String(pool.name ?? pool.id) }));
}

export function listenPools(onChange: (pools: Pool[]) => void, onError?: (e: Error) => void): Unsubscribe {
  return onSnapshot(
    doc(db, CONFIG, POOLS_DOC),
    (snapshot) => onChange(poolsFromDoc(snapshot.data() as Record<string, unknown> | undefined)),
    (error) => onError?.(error),
  );
}

export async function loadPools(): Promise<Pool[]> {
  try {
    const snapshot = await getDoc(doc(db, CONFIG, POOLS_DOC));
    return poolsFromDoc(snapshot.data() as Record<string, unknown> | undefined);
  } catch {
    return [];
  }
}

export async function savePools(pools: Pool[]): Promise<void> {
  await setDoc(doc(db, CONFIG, POOLS_DOC), { pools, updatedAt: new Date().toISOString() });
}

/** Everyone who shares at least one pool with this person, themselves aside. */
export function invitablePeople(people: Record<string, Person>, myKey: string): Person[] {
  const mine = people[myKey]?.pools ?? [];
  if (mine.length === 0) return [];
  return Object.values(people)
    .filter((person) => person.key !== myKey && person.pools.some((pool) => mine.includes(pool)))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Inviting is for people in a pool; everyone else never sees it exists. */
export function canInvite(people: Record<string, Person>, myKey: string): boolean {
  return (people[myKey]?.pools ?? []).length > 0;
}
