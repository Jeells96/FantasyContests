import { initializeApp, type FirebaseOptions } from 'firebase/app';
import {
  browserSessionPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

const env = import.meta.env;

const firebaseConfig: FirebaseOptions = {
  apiKey: env.VITE_FIREBASE_API_KEY ?? 'AIzaSyBQzn4hcka-PM4Ns7OO22p7OgvQ4iQ4do8',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? 'stocks-b13c5.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID ?? 'stocks-b13c5',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? 'stocks-b13c5.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '1011539617993',
  appId: env.VITE_FIREBASE_APP_ID ?? '1:1011539617993:web:b5e3dce1c1a43a7d634518',
};

/** The app every visitor uses, signed in anonymously. */
const app = initializeApp(firebaseConfig);
export const db: Firestore = getFirestore(app);
export const auth: Auth = getAuth(app);

/**
 * A second Firebase app just for the admin session.
 *
 * Keeping admin auth on its own app means unlocking the admin area never
 * replaces (and never destroys) the visitor's anonymous account, so an admin who
 * also entered a contest on this device keeps access to their own entry. The
 * admin session is scoped to the browser tab.
 */
const adminApp = initializeApp(firebaseConfig, 'admin');
export const adminDb: Firestore = getFirestore(adminApp);
export const adminAuth: Auth = getAuth(adminApp);

export const ADMIN_EMAIL = env.VITE_ADMIN_EMAIL ?? 'admin@fantasycontests.app';
const ADMIN_PW_SALT = env.VITE_ADMIN_PW_SALT ?? 'fc-admin-v1';

/**
 * The admin PIN is turned into the password of a single Firebase Auth account.
 * That account — not anything in the UI — is what the Firestore security rules
 * recognise, so admin writes are rejected by the server for everyone else.
 */
export function adminPasswordForPin(pin: string): string {
  return `${pin}::${ADMIN_PW_SALT}`;
}

let anonymousSignInStarted = false;

/** Resolve (and create, on first visit) this device's anonymous account. */
export function ensureAnonymousUser(): Promise<User> {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        if (user) {
          unsubscribe();
          resolve(user);
          return;
        }
        if (!anonymousSignInStarted) {
          anonymousSignInStarted = true;
          signInAnonymously(auth).catch((error) => {
            unsubscribe();
            reject(error);
          });
        }
      },
      (error) => {
        unsubscribe();
        reject(error);
      },
    );
  });
}

export async function signInAdmin(pin: string): Promise<User> {
  await setPersistence(adminAuth, browserSessionPersistence);
  const credential = await signInWithEmailAndPassword(adminAuth, ADMIN_EMAIL, adminPasswordForPin(pin));
  return credential.user;
}

export function signOutAdmin(): Promise<void> {
  return signOut(adminAuth);
}

export { onAuthStateChanged };
export type { User };
