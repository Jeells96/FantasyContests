/**
 * Does one person stay one person?
 *
 * Covers the two halves of tying devices together: matching a name to the same
 * key whatever it is typed like, and collapsing the leaderboard when a device
 * that never came back left a record of its own behind.
 */
import { buildLeaderboard } from '../src/lib/engine/leaderboard';
import { displayKey, personKey } from '../src/lib/personKey';
import type { Contest, Entry, Standing } from '../src/types';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`}`);
}

/* ------------------------------------------------------------ name keys ---- */

check('case and spacing ignored', personKey(' JAREN ', 'Ells'), personKey('jaren', 'ells'));
check("punctuation ignored", personKey('J.T.', "O'Neill"), 'jt-oneill');
check('a display name matches the same key', displayKey('Jaren Ells'), personKey('Jaren', 'Ells'));
check('middle names stay with the surname', displayKey('Mary Anne Kelly'), personKey('Mary', 'Anne Kelly'));
check('one word is not a person', displayKey('Jaren'), '');
check('different people stay different', personKey('Jaren', 'Ells') === personKey('Jared', 'Ells'), false);

/* ---------------------------------------------------------- leaderboard ---- */

const contest = {
  id: 'c1',
  rosterSlots: [],
  salaryCapInfo: { cap: 50000 },
  captain: { enabled: false, multiplier: 1.5 },
  gameWinner: { enabled: false, bonusPoints: 0 },
  games: [],
  lockAt: '2020-01-01T00:00:00.000Z',
} as unknown as Contest;

const entry = (uid: string, name: string, updatedAt: string): Entry => ({
  uid,
  displayName: name,
  lineup: [],
  picks: {},
  salaryUsed: 0,
  submittedAt: updatedAt,
  updatedAt,
});

const standing = (uid: string, name: string): Standing => ({
  uid,
  displayName: name,
  enteredAt: '2020-01-01T00:00:00.000Z',
  submitted: true,
});

const rows = (standings: Standing[], entries: Entry[], selfUid: string | null = null) =>
  buildLeaderboard({
    contest,
    standings,
    entries,
    players: new Map(),
    selfUid,
    locked: true,
  });

// A phone left behind: two records, one name, and only one of them played.
check(
  'a stale device record folds into the person',
  rows([standing('phone', 'Jaren Ells'), standing('laptop', 'Jaren Ells')], [entry('laptop', 'Jaren Ells', '2026-01-02T00:00:00.000Z')]).map((r) => r.uid),
  ['laptop'],
);

// Both devices entered before the merge: the lineup they touched last is theirs.
check(
  'the lineup edited last is the one kept',
  rows(
    [standing('phone', 'Jaren Ells'), standing('laptop', 'Jaren Ells')],
    [entry('phone', 'Jaren Ells', '2026-01-01T00:00:00.000Z'), entry('laptop', 'Jaren Ells', '2026-01-03T00:00:00.000Z')],
  ).map((r) => r.uid),
  ['laptop'],
);

// However the name was typed on each device, it is the same person.
check(
  'a name typed differently is still one row',
  rows([standing('phone', 'jaren ells'), standing('laptop', 'Jaren  Ells')], []).length,
  1,
);

check(
  'two people are still two rows',
  rows([standing('a', 'Jaren Ells'), standing('b', 'Casey Ells')], []).length,
  2,
);

// Whoever is looking should see their own row, not their old device's.
check(
  'your own record wins the collapse',
  rows([standing('phone', 'Jaren Ells'), standing('laptop', 'Jaren Ells')], [], 'phone').map((r) => r.uid),
  ['phone'],
);

check(
  'entrants without a usable name are not merged together',
  rows([standing('a', 'Entrant'), standing('b', 'Entrant2')], []).length,
  2,
);

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
