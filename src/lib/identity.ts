/**
 * Local player identity.
 *
 * First visit asks for a first and last name; it is stored on the device and
 * reused automatically afterwards. Names are an honour system, exactly as
 * specified — the anonymous Firebase account behind it is what actually owns an
 * entry.
 */

const STORAGE_KEY = 'fantasycontests.identity.v1';
const DEVICE_KEY = 'fantasycontests.device.v1';

export interface Identity {
  firstName: string;
  lastName: string;
  displayName: string;
  savedAt: string;
}

/**
 * A stable random id for this device, used to own an entry.
 *
 * This replaces a signed-in user id: it is generated locally, stored with the
 * name, and reused on later visits. It is unguessable, which is what keeps one
 * player's entry from being found by another.
 */
export function deviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const created = newId();
    localStorage.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    // Storage blocked: fall back to a per-session id so play still works.
    return sessionId();
  }
}

let memoryId: string | null = null;

function sessionId(): string {
  if (!memoryId) memoryId = newId();
  return memoryId;
}

function newId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID().replace(/-/g, '');
  const bytes = new Uint8Array(16);
  cryptoApi?.getRandomValues?.(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function loadIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Identity>;
    if (!parsed.firstName || !parsed.lastName) return null;
    return {
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      displayName: parsed.displayName || `${parsed.firstName} ${parsed.lastName}`,
      savedAt: parsed.savedAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function saveIdentity(firstName: string, lastName: string): Identity {
  const identity: Identity = {
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    displayName: `${firstName.trim()} ${lastName.trim()}`.replace(/\s+/g, ' ').slice(0, 60),
    savedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // Private browsing or blocked storage: the name simply is not remembered.
  }
  return identity;
}

export function clearIdentity(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** "JAREN'S TEAM" for the scoring overlay. */
export function teamNameFor(identity: Identity | null): string {
  if (!identity) return 'YOUR TEAM';
  const first = identity.firstName.toUpperCase();
  return first.endsWith('S') ? `${first}' TEAM` : `${first}'S TEAM`;
}

const MERGED_KEY = 'fantasycontests.merged.v1';

/**
 * The merge this device has already carried out, as the person it gathered
 * everything under and the devices it gathered in.
 *
 * Gathering a person's devices together only has to happen once, but it has to
 * happen again when there is something new to gather: a name changed, or a
 * device that did not exist last time. Recording both halves is what tells
 * those apart from a merge already done.
 */
export function mergedInto(): string | null {
  try {
    return localStorage.getItem(MERGED_KEY);
  } catch {
    return null;
  }
}

export function markMerged(personUid: string): void {
  try {
    localStorage.setItem(MERGED_KEY, personUid);
  } catch {
    // Storage blocked: the merge is idempotent, so it simply runs again.
  }
}

const ENTERED_KEY = 'fantasycontests.entered.v1';

/** Remember which contests this device entered, for the main page badge. */
export function enteredContests(): Set<string> {
  try {
    const raw = localStorage.getItem(ENTERED_KEY);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set<string>();
  }
}

export function markEntered(contestId: string): void {
  try {
    const current = enteredContests();
    current.add(contestId);
    localStorage.setItem(ENTERED_KEY, JSON.stringify([...current]));
  } catch {
    // ignore
  }
}
