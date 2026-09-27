import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { adminAuth, ensureAnonymousUser, onAuthStateChanged, signInAdmin, signOutAdmin } from '../lib/firebase';
import { clearIdentity, loadIdentity, saveIdentity, type Identity } from '../lib/identity';

interface SessionValue {
  /** Anonymous Firebase uid; owns this device's entries. */
  uid: string | null;
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

export function SessionProvider({ children }: { children: ReactNode }) {
  const [uid, setUid] = useState<string | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(() => loadIdentity());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ensureAnonymousUser()
      .then((user) => {
        if (cancelled) return;
        setUid(user.uid);
        setReady(true);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : '';
        setError(
          /configuration-not-found|operation-not-allowed/i.test(message)
            ? 'Anonymous sign-in is not enabled for this Firebase project, so lineups cannot be submitted yet. Enable Authentication → Anonymous in the Firebase console (see README step 3).'
            : /network|unavailable|timeout/i.test(message)
              ? 'Cannot reach Firebase right now. Contests may be out of date.'
              : 'Could not start a player session, so lineups cannot be submitted yet.',
        );
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => onAuthStateChanged(adminAuth, (user) => setIsAdmin(Boolean(user))), []);

  const saveName = useCallback((firstName: string, lastName: string) => {
    setIdentity(saveIdentity(firstName, lastName));
  }, []);

  const forgetName = useCallback(() => {
    clearIdentity();
    setIdentity(null);
  }, []);

  const unlockAdmin = useCallback(async (pin: string) => {
    await signInAdmin(pin);
  }, []);

  const lockAdmin = useCallback(async () => {
    await signOutAdmin();
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ uid, identity, ready, error, saveName, forgetName, isAdmin, unlockAdmin, lockAdmin }),
    [uid, identity, ready, error, saveName, forgetName, isAdmin, unlockAdmin, lockAdmin],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
