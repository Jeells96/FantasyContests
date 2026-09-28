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
import { arrayUnion, deleteField, doc, getDoc, onSnapshot, setDoc, type Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';

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
  /** Pool ids. Empty means they cannot invite and are not an invite option. */
  pools: string[];
  /** Devices that have carried this name. */
  deviceIds: string[];
  seenAt?: string;
}

/**
 * A name reduced to something that matches across devices: case, spacing and
 * punctuation are ignored, so "J.T. O'Neill" and "jt oneill" are one person.
 * Firestore field paths use dots, so the key never contains one.
 */
export function personKey(firstName: string, lastName: string): string {
  const clean = (value: string) =>
    value
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  const first = clean(firstName);
  const last = clean(lastName);
  return first && last ? `${first}-${last}` : '';
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
 * Record that this device is using this name. Never touches their pools, which
 * are the admin's to set, and merges per field so two devices signing in at
 * once cannot overwrite each other.
 */
export async function rememberPerson(
  firstName: string,
  lastName: string,
  deviceId: string,
): Promise<void> {
  const key = personKey(firstName, lastName);
  if (!key) return;
  try {
    await setDoc(
      doc(db, CONFIG, PEOPLE_DOC),
      {
        people: {
          [key]: {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            displayName: `${firstName.trim()} ${lastName.trim()}`,
            deviceIds: arrayUnion(deviceId),
            seenAt: new Date().toISOString(),
          },
        },
      },
      { merge: true },
    );
  } catch {
    // Knowing who has used the site is a convenience, never a blocker.
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
