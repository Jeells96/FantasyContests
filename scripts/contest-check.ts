/**
 * Does a contest know when it is over?
 *
 * The failures these cover all looked the same from outside — a contest that
 * said "live" days after its last out — but came from different places: a game
 * whose status never arrived, a game called off that never could go final, and
 * a start time that moved after the contest was built.
 */
import { applyLiveResults } from '../src/lib/engine/liveSync';
import { buildLeaderboard } from '../src/lib/engine/leaderboard';
import { deriveStatus, earliestStart, latestStart } from '../src/lib/engine/contestState';
import type { Contest, ContestGame } from '../src/types';
import type { LiveGameStats } from '../src/lib/providers/types';
import { gameStateFrom } from '../src/lib/providers/mlb';
import { phaseOfGame, phaseOfPlayer, phasesByGame } from '../src/lib/engine/phase';
import { ownershipOf } from '../src/lib/engine/ownership';
import { pickOpen } from '../src/lib/engine/spread';
import { formatWager, potFor } from '../src/lib/engine/wager';
import { computeRawFantasyPoints, DEFAULT_MLB_SCORING } from '../src/lib/scoring';
import { describeStatChange } from '../src/lib/stats';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`}`);
}

const game = (id: string, state: ContestGame['state'], startTime: string): ContestGame =>
  ({
    id, state, startTime, shortName: `G${id}`, statusDetail: '',
    home: { id: `h${id}`, abbreviation: 'HOM', name: 'Home', score: 0 },
    away: { id: `a${id}`, abbreviation: 'AWY', name: 'Away', score: 0 },
  }) as unknown as ContestGame;

const contestOf = (games: ContestGame[], lockTime: string): Contest =>
  ({
    id: 'c', games, lockTime, rosterSlots: [], scoring: {},
    normalization: {}, salaryCapInfo: { cap: 0 }, scoringLog: [],
    gameWinner: { enabled: false, bonusPercent: 0, bonusPoints: 0 },
    captain: { enabled: false, multiplier: 1.5 },
  }) as unknown as Contest;

const live = (gameId: string, state: LiveGameStats['state'], extra: Partial<LiveGameStats> = {}): LiveGameStats => ({
  gameId, state, statusDetail: '', homeScore: 0, awayScore: 0, winnerTeamId: null, players: {}, ...extra,
});

/* What baseball actually puts in the status field. */
check('final', gameStateFrom({ abstractGameState: 'Final', codedGameState: 'F', detailedState: 'Final' }), 'post');
check('in progress', gameStateFrom({ abstractGameState: 'Live', codedGameState: 'I', detailedState: 'In Progress' }), 'in');
check('scheduled', gameStateFrom({ abstractGameState: 'Preview', codedGameState: 'S', detailedState: 'Scheduled' }), 'pre');
check('pre-game', gameStateFrom({ abstractGameState: 'Preview', codedGameState: 'P', detailedState: 'Pre-Game' }), 'pre');
// These three read as upcoming forever, which is what hung a contest.
check('postponed is over for tonight', gameStateFrom({ abstractGameState: 'Preview', codedGameState: 'D', detailedState: 'Postponed' }), 'post');
check('cancelled is over for tonight', gameStateFrom({ abstractGameState: 'Preview', codedGameState: 'C', detailedState: 'Cancelled' }), 'post');
check('suspended is over for tonight', gameStateFrom({ abstractGameState: 'Live', codedGameState: 'U', detailedState: 'Suspended: Rain' }), 'post');

/* A game whose status finally arrives takes the contest with it. */
{
  const contest = contestOf([game('1', 'post', '2026-09-29T18:00:00Z'), game('2', 'pre', '2026-09-30T00:00:00Z')], '2026-09-29T18:00:00Z');
  check('still live while one game is unfinished', deriveStatus(contest), 'live');
  const r = applyLiveResults(contest, [], [live('1', 'post'), live('2', 'post')]);
  check('complete once the last game goes final', r.status, 'complete');
}

/* A game called off can never go final, so it must not hold the contest open. */
{
  const contest = contestOf([game('1', 'post', '2026-09-29T18:00:00Z'), game('2', 'pre', '2026-09-30T00:00:00Z')], '2026-09-29T18:00:00Z');
  const r = applyLiveResults(contest, [], [live('1', 'post'), live('2', 'post', { statusDetail: 'Postponed' })]);
  check('a called-off game does not hold a contest open', r.status, 'complete');
}

/* A start time that moves carries the lock with it, but only before first pitch.
 * Relative to now, not to a date in the calendar: whether a contest is open
 * turns on whether its lock has passed, so fixed dates make these pass in
 * October and fail in November. */
const iso = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * 3_600_000).toISOString();
{
  const was = iso(-1);
  const moved = iso(5);
  const contest = contestOf([game('1', 'pre', was)], was);
  const r = applyLiveResults(contest, [], [live('1', 'pre', { startTime: moved })]);
  check('an upcoming game adopts the feed time', r.games[0].startTime, moved);
  check('and the lock follows it', r.lockTime, moved);
  check('so the contest is open again', r.status, 'open');
}
{
  const was = iso(-1);
  const contest = contestOf([game('1', 'in', was)], was);
  const r = applyLiveResults(contest, [], [live('1', 'in', { startTime: iso(5) })]);
  check('a game under way keeps the time it started', r.games[0].startTime, was);
  check('and nothing moves the lock', r.lockTime, undefined);
}
{
  const was = iso(-1);
  const contest = contestOf([game('1', 'pre', was)], was);
  const r = applyLiveResults(contest, [], [live('1', 'pre', { startTime: new Date(Date.parse(was) + 30_000).toISOString() })]);
  check('the feed restating the same time moves nothing', r.lockTime, undefined);
}

/* A game the feed says nothing about keeps what it had. */
{
  const contest = contestOf([game('1', 'in', '2026-10-01T18:00:00Z')], '2026-10-01T18:00:00Z');
  const r = applyLiveResults(contest, [], []);
  check('a silent feed changes nothing', [r.games[0].state, r.status], ['in', 'live']);
}

/* What a number on screen means. */
check('a game not started is a projection', phaseOfGame({ state: 'pre' }), 'pre');
check('a game under way is live', phaseOfGame({ state: 'in' }), 'live');
check('a finished game is final', phaseOfGame({ state: 'post' }), 'final');
check('an unknown game reads as not started', phaseOfGame(undefined), 'pre');
{
  // The case that made a projection look like a score: one contest, games hours
  // apart, so a player yet to play sat beside one who had finished.
  const mixed = phasesByGame({
    games: [game('1', 'post', 'x'), game('2', 'in', 'x'), game('3', 'pre', 'x')],
  } as unknown as Contest);
  check('each player is judged by their own game', [
    phaseOfPlayer(mixed, { gameId: '1', started: true }),
    phaseOfPlayer(mixed, { gameId: '2', started: true }),
    phaseOfPlayer(mixed, { gameId: '3', started: false }),
  ], ['final', 'live', 'pre']);
  check('a player whose game is gone falls back to the flag', [
    phaseOfPlayer(mixed, { gameId: 'missing', started: true }),
    phaseOfPlayer(mixed, { gameId: 'missing', started: false }),
  ], ['final', 'pre']);
}

/* How many teams took each player. */
{
  const line = (id: string | null) => ({ player: id ? { id } : null }) as never;
  const own = ownershipOf([
    { lines: [line('a'), line('b'), line(null)] },
    { lines: [line('a'), line('c')] },
    { lines: null },
  ] as never);
  check('counted against the teams that can be seen', own.teams, 2);
  check('a player on every roster', own.byPlayer.get('a'), 2);
  check('a player only one team took', own.byPlayer.get('b'), 1);
  check('a player nobody took is absent', own.byPlayer.get('zz'), undefined);
  check('an empty slot counts for nobody', own.byPlayer.has('null'), false);
}
{
  // A roster can field the same player twice; he is still one team's pick.
  const line = (id: string) => ({ player: { id } }) as never;
  const own = ownershipOf([{ lines: [line('a'), line('a')] }] as never);
  check('a player used twice counts once', own.byPlayer.get('a'), 1);
}

/* Money on a contest. */
check('a round stake reads plainly', formatWager(5), '$5');
check('a thousand keeps its comma', formatWager(1000), '$1,000');
check('an odd amount keeps its cents', formatWager(2.5), '$2.50');
check('the winner collects from everyone else', potFor(5, 4), 15);
check('nobody else betting is nothing to collect', potFor(5, 1), 0);
check('a wager nobody took pays nothing', potFor(5, 0), 0);

/* The money mark follows the standing, not the entry. */
{
  const contest = contestOf([game('1', 'post', iso(-2))], iso(-2));
  const rows = buildLeaderboard({
    contest,
    standings: [
      { uid: 'a', displayName: 'A One', enteredAt: iso(-3), submitted: true, wagerIn: true },
      { uid: 'b', displayName: 'B Two', enteredAt: iso(-3), submitted: true, wagerIn: false },
      { uid: 'c', displayName: 'C Three', enteredAt: iso(-3), submitted: true },
    ] as never,
    entries: [],
    players: new Map(),
    selfUid: null,
    locked: true,
  });
  const by = new Map(rows.map((r) => [r.uid, r.wagerIn]));
  check('someone who took the bet is marked', by.get('a'), true);
  check('someone who declined is not', by.get('b'), false);
  check('someone never asked is not', by.get('c'), false);
}

/* A slate can span days, so the lock and the last game must come from the whole
 * set rather than from whichever game was picked first. */
{
  const span = [
    game('1', 'pre', '2026-10-05T23:00:00Z'),
    game('2', 'pre', '2026-10-04T17:00:00Z'),
    game('3', 'pre', '2026-10-06T02:00:00Z'),
  ];
  check('the lock is the earliest of them all', earliestStart(span), '2026-10-04T17:00:00Z');
  check('the last game is the latest', latestStart(span), '2026-10-06T02:00:00Z');
  // Picked in any order, since they are gathered over several searches.
  const shuffled = [span[2], span[0], span[1]];
  check('order picked does not matter', earliestStart(shuffled), '2026-10-04T17:00:00Z');
}

/* What a hitter does badly costs him. */
{
  const pts = (stats: Record<string, number>) => computeRawFantasyPoints(stats, DEFAULT_MLB_SCORING);
  check('striking out costs the batter', pts({ ab: 1, so: 1 }), -1);
  check('each strikeout costs again', pts({ ab: 4, so: 3 }), -3);
  check('an error costs more than a strikeout', pts({ e: 1 }), -2);
  check('they add up', pts({ so: 2, e: 1 }), -4);
  // A good night is still a good night.
  check('a home run outweighs a strikeout', pts({ h: 1, hr: 1, rbi: 1, r: 1, so: 1 }) > 0, true);
  check('an error does not touch a pitcher\'s own line', pts({ pitchOuts: 3, pitchSO: 1 }), 4.25);
}

/* The feed says what happened, not just what it was worth. */
{
  const scored = Object.keys(DEFAULT_MLB_SCORING.values);
  const say = (before: Record<string, number>, after: Record<string, number>) =>
    describeStatChange('mlb', before, after, scored);
  check('a strikeout is named', say({ so: 0 }, { so: 1 }), '+1 strikeout');
  check('two are counted', say({ so: 1 }, { so: 3 }), '+2 strikeouts');
  check('an error is named', say({ e: 0 }, { e: 1 }), '+1 error');
  check(
    'a home run names what came with it',
    say({ hr: 0, rbi: 0, r: 0 }, { hr: 1, rbi: 2, r: 1 }),
    '+2 RBI, +1 home run, +1 run',
  );
  check('an inning of pitching reads plainly', say({ pitchOuts: 0, pitchSO: 0 }, { pitchOuts: 3, pitchSO: 2 }), '+3 outs recorded, +2 strikeouts');
  check('nothing moving says nothing', say({ hr: 1 }, { hr: 1 }), '');
  // The box score carries plenty the contest does not pay for.
  check('unscored stats are not described', say({ ab: 0 }, { ab: 4 }), '');
  check('a stat going down is marked as such', say({ hr: 2 }, { hr: 1 }), '−1 home run');
}

/* A pick closes with its own game, not with the contest. */
{
  const at = (hours: number) => game('g', 'pre', iso(hours));
  check('a game still to come is open', pickOpen(at(5)), true);
  check('a game whose time has passed is not', pickOpen(at(-1)), false);
  check('a game under way is not', pickOpen(game('g', 'in', iso(5))), false);
  check('a finished game is not', pickOpen(game('g', 'post', iso(-5))), false);
  // The contest locking is beside the point: this one starts tomorrow.
  check('locking the contest does not close a later game', pickOpen(at(26)), true);
}

/* A pick stays covered until its own game starts. */
{
  const games = [game('early', 'in', iso(-1)), game('later', 'pre', iso(6))];
  const contest = contestOf(games, iso(-1));
  (contest as unknown as { gameWinner: unknown }).gameWinner = {
    enabled: true, bonusPercent: 0, bonusPoints: 5,
  };
  const entryFor = (uid: string) =>
    ({ uid, displayName: `${uid} Person`, lineup: [], picks: { early: 'a', later: 'b' },
       salaryUsed: 0, submittedAt: iso(-2), updatedAt: iso(-2) }) as never;
  const rows = buildLeaderboard({
    contest,
    standings: [
      { uid: 'me', displayName: 'Me Person', enteredAt: iso(-2), submitted: true },
      { uid: 'them', displayName: 'Them Person', enteredAt: iso(-2), submitted: true },
    ] as never,
    entries: [entryFor('me'), entryFor('them')],
    players: new Map(),
    selfUid: 'me',
    locked: true,
  });
  const mine = rows.find((r) => r.uid === 'me');
  const theirs = rows.find((r) => r.uid === 'them');
  check('you always see your own picks', Object.keys(mine?.picks ?? {}).sort(), ['early', 'later']);
  check('a rival\'s pick shows once the game is under way', theirs?.picks?.early, 'a');
  check('a rival\'s pick on a game still to come is withheld', theirs?.picks?.later, undefined);
  // Withholding the pick must not withhold the score it earns.
  check('their roster is still visible', theirs?.lines !== null, true);
}

/* The pot belongs to the best finish among those who put money in. */
{
  // Rows arrive in rank order; the component takes the first one still betting.
  const potWinner = (ranked: { uid: string }[], inById: Record<string, boolean>) =>
    ranked.filter((row) => inById[row.uid])[0]?.uid;
  const field = [{ uid: 'a' }, { uid: 'b' }, { uid: 'c' }];
  check('the leader takes it when they are in', potWinner(field, { a: true, b: true, c: true }), 'a');
  check('a leader playing for fun does not', potWinner(field, { a: false, b: true, c: true }), 'b');
  check('it falls to whoever is highest and in', potWinner(field, { a: false, b: false, c: true }), 'c');
  check('nobody in, nobody owed', potWinner(field, { a: false, b: false, c: false }), undefined);
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
