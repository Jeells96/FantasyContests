/**
 * Local player identity.
 *
 * First visit asks for a first and last name; it is stored on the device and
 * reused automatically afterwards. Names are an honour system, exactly as
 * specified — the anonymous Firebase account behind it is what actually owns an
 * entry.
 */

const STORAGE_KEY = 'fantasycontests.identity.v1';

export interface Identity {
  firstName: string;
  lastName: string;
  displayName: string;
  savedAt: string;
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
