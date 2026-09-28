/**
 * One-off migration for contests created before join codes existed.
 *
 * Gives every contest without one a unique six-digit code, an owner and a
 * member list, so it keeps showing up for the people already in it:
 *
 *   npm run backfill:codes -- --dry
 *   npm run backfill:codes
 *   npm run backfill:codes -- --contest=<id> --owner=<deviceId>
 *
 * Without --owner the owner is the earliest entrant, who in practice is
 * whoever set the contest up. Members are everyone in the standings.
 */
import { initializeApp } from 'firebase/app';
import { collection, doc, getDocs, initializeFirestore, updateDoc, type Firestore } from 'firebase/firestore';

function arg(name: string): string | undefined {
  const match = process.argv.find((value) => value.startsWith(`--${name}=`));
  return match?.slice(name.length + 3);
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const config = {
  apiKey: process.env.FIREBASE_API_KEY ?? 'AIzaSyBQzn4hcka-PM4Ns7OO22p7OgvQ4iQ4do8',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN ?? 'stocks-b13c5.firebaseapp.com',
  projectId: process.env.FIREBASE_PROJECT_ID ?? 'stocks-b13c5',
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET ?? 'stocks-b13c5.firebasestorage.app',
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID ?? '1011539617993',
  appId: process.env.FIREBASE_APP_ID ?? '1:1011539617993:web:b5e3dce1c1a43a7d634518',
};

const onlyContest = arg('contest');
const forcedOwner = arg('owner');
const dry = flag('dry');

function newCode(): string {
  return String(100_000 + Math.floor(Math.random() * 900_000));
}

async function main(): Promise<void> {
  const db: Firestore = initializeFirestore(initializeApp(config), { ignoreUndefinedProperties: true });
  const snapshot = await getDocs(collection(db, 'contests'));
  const used = new Set<string>();
  for (const document of snapshot.docs) {
    const code = document.data().joinCode;
    if (typeof code === 'string' && code) used.add(code);
  }

  for (const document of snapshot.docs) {
    const data = document.data();
    if (onlyContest && document.id !== onlyContest) continue;
    const hasCode = typeof data.joinCode === 'string' && data.joinCode.length === 6;
    const hasOwner = typeof data.ownerId === 'string' && data.ownerId.length > 0;
    const hasMembers = Array.isArray(data.members) && data.members.length > 0;
    if (hasCode && hasOwner && hasMembers && !forcedOwner) {
      console.log(`${document.id} · ${data.name}: already migrated (code ${data.joinCode})`);
      continue;
    }

    const entries = await getDocs(collection(db, 'contests', document.id, 'entries'));
    const standings = await getDocs(collection(db, 'contests', document.id, 'standings'));
    const byTime = entries.docs
      .map((entry) => ({ uid: String(entry.data().uid ?? entry.id), at: String(entry.data().submittedAt ?? '') }))
      .sort((a, b) => a.at.localeCompare(b.at));
    const owner = forcedOwner || (hasOwner ? String(data.ownerId) : byTime[0]?.uid);
    if (!owner) {
      console.log(`${document.id} · ${data.name}: no entries, so no owner to infer. Pass --owner=<deviceId>.`);
      continue;
    }
    const ownerName = entries.docs.find((entry) => String(entry.data().uid) === owner)?.data().displayName;

    const members = new Set<string>(Array.isArray(data.members) ? (data.members as string[]) : []);
    members.add(owner);
    for (const standing of standings.docs) members.add(String(standing.data().uid ?? standing.id));

    let code = hasCode ? String(data.joinCode) : newCode();
    while (!hasCode && used.has(code)) code = newCode();
    used.add(code);

    const patch = {
      joinCode: code,
      ownerId: owner,
      ...(ownerName ? { ownerName: String(ownerName) } : {}),
      members: [...members],
      updatedAt: new Date().toISOString(),
    };
    console.log(
      `${document.id} · ${data.name}: code ${code}, owner ${ownerName ?? owner}, ${patch.members.length} member(s)${dry ? ' (dry run)' : ''}`,
    );
    if (!dry) await updateDoc(doc(db, 'contests', document.id), patch);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
