import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ADMIN_PIN } from '../lib/firebase';
import { clearIdentity, deviceId, loadIdentity, saveIdentity, type Identity } from '../lib/identity';

const ADMIN_SESSION_KEY = 'fantasycontests.admin.v1';

interface SessionValue {
  /** Random per-device id; owns this device's entries. */
  uid: string;
  identity: Identity | null;
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
  const [uid] = useState<string>(() => deviceId());
  const [identity, setIdentity] = useState<Identity | null>(() => loadIdentity());
  const [isAdmin, setIsAdmin] = useState<boolean>(() => readAdminSession());

  const saveName = useCallback((firstName: string, lastName: string) => {
    setIdentity(saveIdentity(firstName, lastName));
  }, []);

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
      ready: true,
      error: null,
      saveName,
      forgetName,
      isAdmin,
      unlockAdmin,
      lockAdmin,
    }),
    [uid, identity, saveName, forgetName, isAdmin, unlockAdmin, lockAdmin],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
