import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { initializeFirestore, type Firestore } from 'firebase/firestore';

// Read through a fallback so this module can also be bundled for Node (the
// live-sync worker and the verification scripts), where import.meta.env is absent.
const env: Record<string, string | undefined> =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

const firebaseConfig: FirebaseOptions = {
  apiKey: env.VITE_FIREBASE_API_KEY ?? 'AIzaSyBQzn4hcka-PM4Ns7OO22p7OgvQ4iQ4do8',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? 'stocks-b13c5.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID ?? 'stocks-b13c5',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? 'stocks-b13c5.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '1011539617993',
  appId: env.VITE_FIREBASE_APP_ID ?? '1:1011539617993:web:b5e3dce1c1a43a7d634518',
};

/**
 * Firestore only — this app uses no Firebase Authentication.
 *
 * Players are identified by a random id generated on their own device (see
 * lib/identity.ts) and the admin area is unlocked by a PIN held in the client.
 * Nothing needs to be enabled in the Firebase console beyond Firestore itself,
 * and the security rules do not depend on a signed-in user.
 */
const app = initializeApp(firebaseConfig);

/**
 * `ignoreUndefinedProperties` matters here: a pool player legitimately has
 * optional fields (no headshot, no jersey number, no injury status), and
 * Firestore rejects an explicit `undefined` rather than skipping it.
 */
export const db: Firestore = initializeFirestore(app, { ignoreUndefinedProperties: true });

/** The admin PIN. Checked in the browser; see README on what that does and does not protect. */
export const ADMIN_PIN = env.VITE_ADMIN_PIN ?? '2325';
