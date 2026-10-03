import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ADMIN_PIN } from '../lib/firebase';
import {
  clearIdentity,
  deviceId,
  loadIdentity,
  markMerged,
  mergedInto,
  saveIdentity,
  type Identity,
} from '../lib/identity';
import { absorbDevice } from '../lib/db';
import { personKey, rememberPerson } from '../lib/people';

const ADMIN_SESSION_KEY = 'fantasycontests.admin.v1';

/**
 * How long to wait for the directory before playing on this device alone.
 *
 * Reaching Firestore is what ties a name across devices, but it is not what
 * makes the site usable — a phone on a bad connection should still get a
 * lineup in. It falls back to the device's own id and ties up on the next load.
 */
const RESOLVE_MS = 6_000;

interface SessionValue {
  /**
   * Who is playing. Shared by every device this person uses, so a name is one
   * entrant rather than one per device; their own device id until a name is
   * entered and the directory answers.
   */
  uid: string;
  identity: Identity | null;
  /** This person's name reduced to a match key; empty without a name. */
  personKey: string;
  ready: boolean;
  error: string | null;
  saveName: (firstName: string, lastName: string) => void;
  forgetName: () => void;
  isAdmin: boolean;
  unlockAdmin: (pin: string) => Promise<void>;
  lockAdmin: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

/** Was the admin area already unlocked in this browser tab? */
function readAdminSession(): boolean {
  try {
    return sessionStorage.getItem(ADMIN_SESSION_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Session state without Firebase Authentication.
 *
 * A player is identified by a random id stored on their device, and the admin
 * area is unlocked by comparing the PIN in the browser. There is nothing to
 * sign in to, so the app is usable the moment Firestore is reachable.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [device] = useState<string>(() => deviceId());
  const [personUid, setPersonUid] = useState<string | null>(null);
  const [ready, setReady] = useState<boolean>(() => loadIdentity() === null);
  const [identity, setIdentity] = useState<Identity | null>(() => loadIdentity());
  const [isAdmin, setIsAdmin] = useState<boolean>(() => readAdminSession());
  const uid = personUid ?? device;

  const saveName = useCallback((firstName: string, lastName: string) => {
    setIdentity(saveIdentity(firstName, lastName));
  }, []);

  /*
   * Settle who this is before anything reads or writes on their behalf.
   *
   * Being known by name is what lets someone be invited to a contest before
   * they have ever opened the site, and what fills the admin's pool lists. It
   * is also what makes a name one person: the directory answers with the id
   * their name already plays under, and this device takes it up, handing over
   * anything it had built up on its own first.
   *
   * Everything downstream keys off this id, so it is settled before the app is
   * shown — writing an entry under the device's id and moving it a moment later
   * is how a lineup goes missing.
   */
  useEffect(() => {
    if (!identity) {
      setPersonUid(null);
      setReady(true);
      return;
    }
    let cancelled = false;
    setReady(false);

    const resolve = async () => {
      const { uid: resolved, deviceIds } = await rememberPerson(
        identity.firstName,
        identity.lastName,
        device,
      );
      if (cancelled) return;
      // Who they are is settled first and on its own. Gathering their other
      // devices in is a separate, slower job, and making identity wait on it
      // meant a phone on a bad connection gave up and played as itself — a
      // stranger to its own contests.
      setPersonUid(resolved);

      // Every device this name has ever been typed on, not just this one: a
      // phone that is never opened again would otherwise keep its contests,
      // its lineups and its place on the leaderboard to itself forever.
      const others = deviceIds.filter((id) => id !== resolved);
      const done = `${resolved}|${others.join(',')}`;
      if (others.length > 0 && mergedInto() !== done) {
        for (const other of others) {
          await absorbDevice(resolved, other).catch(() => undefined);
          if (cancelled) return;
        }
        markMerged(done);
      }
    };

    const settled = resolve().catch(() => undefined);
    // A hung write must not hold the whole app closed.
    const timer = setTimeout(() => {
      if (!cancelled) setReady(true);
    }, RESOLVE_MS);
    void settled.finally(() => {
      clearTimeout(timer);
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [identity, device]);

  const forgetName = useCallback(() => {
    clearIdentity();
    setIdentity(null);
  }, []);

  const unlockAdmin = useCallback(async (pin: string) => {
    if (pin !== ADMIN_PIN) throw new Error('incorrect-pin');
    try {
      // Scoped to the tab, so closing it ends the admin session.
      sessionStorage.setItem(ADMIN_SESSION_KEY, 'true');
    } catch {
      // Storage blocked: the unlock simply does not survive a reload.
    }
    setIsAdmin(true);
  }, []);

  const lockAdmin = useCallback(async () => {
    try {
      sessionStorage.removeItem(ADMIN_SESSION_KEY);
    } catch {
      // ignore
    }
    setIsAdmin(false);
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      uid,
      identity,
      personKey: identity ? personKey(identity.firstName, identity.lastName) : '',
      ready,
      error: null,
      saveName,
      forgetName,
      isAdmin,
      unlockAdmin,
      lockAdmin,
    }),
    [uid, identity, ready, saveName, forgetName, isAdmin, unlockAdmin, lockAdmin],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
