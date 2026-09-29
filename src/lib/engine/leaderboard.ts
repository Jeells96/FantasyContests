import type {
  Contest,
  ContestPlayer,
  Entry,
  LeaderboardPlayerLine,
  LeaderboardRow,
  Standing,
} from '../../types';
import { validateLineup } from './lineup';
import { captainEnabled, captainFirst, captainMultiplier, effectivePoints, effectiveSalary } from './captain';
import { displayKey } from '../personKey';
import { round2 } from './projections';
import { gradePick } from './spread';

export interface LeaderboardInput {
  contest: Contest;
  /** Public per-entrant records: always available, never contain rosters. */
  standings: Standing[];
  /** Full entries. Pre-lock this only contains the viewer's own entry. */
  entries: Entry[];
  players: Map<string, ContestPlayer>;
  selfUid: string | null;
  locked: boolean;
}

/**
 * Build the leaderboard.
 *
 * Scores are always recomputed from the stored player scores and the submitted
 * lineup — they are never read from a user-writable field — so an entry cannot
 * carry a score of its own. The same pass re-validates each lineup against the
 * contest's salary cap and position rules; an entry that breaks them is flagged
 * and ranked behind every legal entry.
 */
export function buildLeaderboard(input: LeaderboardInput): LeaderboardRow[] {
  const { contest, standings, entries, players, selfUid, locked } = input;
  const entriesByUid = new Map(entries.map((entry) => [entry.uid, entry]));
  const hasCaptain = captainEnabled(contest);
  const multiplier = captainMultiplier(contest);
  const slotById = new Map(contest.rosterSlots.map((slot) => [slot.id, slot]));

  const nameByUid = new Map(standings.map((s) => [s.uid, s.displayName]));
  const nameOf = (uid: string): string => entriesByUid.get(uid)?.displayName ?? nameByUid.get(uid) ?? '';
  const uids = collapseByPerson(
    [...new Set<string>([...standings.map((s) => s.uid), ...entriesByUid.keys()])],
    nameOf,
    entriesByUid,
    selfUid,
  );

  const rows: LeaderboardRow[] = [];
  for (const uid of uids) {
    const entry = entriesByUid.get(uid);
    const isSelf = uid === selfUid;
    const displayName = entry?.displayName ?? nameByUid.get(uid) ?? 'Entrant';
    const canSeeRoster = Boolean(entry) && (locked || isSelf);

    let fantasyPoints = 0;
    let lines: LeaderboardPlayerLine[] | null = null;
    let violations: string[] = [];
    let salaryUsed = entry?.salaryUsed ?? 0;

    if (entry) {
      const validation = validateLineup(entry.lineup, players, contest.rosterSlots, contest.salaryCapInfo.cap, {
        enabled: hasCaptain,
        multiplier,
      });
      violations = validation.errors;
      salaryUsed = validation.salaryUsed;

      const built: LeaderboardPlayerLine[] = [];
      for (const slot of contest.rosterSlots) {
        const selection = entry.lineup.find((line) => line.slotId === slot.id);
        const player = selection ? players.get(selection.playerId) ?? null : null;
        const isCaptain = hasCaptain && Boolean(selection?.captain);
        const raw = player?.rawPoints ?? 0;
        // The captain's multiplier applies to the contest score, the same
        // number the leaderboard ranks on.
        const normalized = effectivePoints(player?.normalizedPoints ?? 0, isCaptain, multiplier);
        fantasyPoints += normalized;
        built.push({
          slot: slotById.get(slot.id) ?? slot,
          player,
          rawPoints: raw,
          normalizedPoints: normalized,
          isCaptain,
          salary: player ? effectiveSalary(player.salary, isCaptain, multiplier) : 0,
        });
      }
      // The captain leads the roster wherever it is shown.
      if (canSeeRoster) lines = captainFirst(built);
    }

    const { correct, decided, total } = scorePicks(contest, entry);
    const bonusPoints = round2(correct * (contest.gameWinner.enabled ? contest.gameWinner.bonusPoints : 0));

    rows.push({
      uid,
      displayName,
      teamName: entry?.teamName ?? standings.find((s) => s.uid === uid)?.teamName,
      rank: 0,
      fantasyPoints: round2(fantasyPoints),
      bonusPoints,
      total: round2(fantasyPoints + bonusPoints),
      correctPicks: correct,
      decidedPicks: decided,
      totalPicks: total,
      salaryUsed,
      lines,
      picks: canSeeRoster ? entry?.picks ?? null : null,
      violations,
      isSelf,
    });
  }

  rows.sort((a, b) => {
    const aInvalid = a.violations.length > 0 ? 1 : 0;
    const bInvalid = b.violations.length > 0 ? 1 : 0;
    if (aInvalid !== bInvalid) return aInvalid - bInvalid;
    if (b.total !== a.total) return b.total - a.total;
    if (b.fantasyPoints !== a.fantasyPoints) return b.fantasyPoints - a.fantasyPoints;
    return a.displayName.localeCompare(b.displayName);
  });

  // Shared ranks for identical totals; tie-breakers can be layered in later.
  let lastTotal: number | null = null;
  let lastRank = 0;
  rows.forEach((row, index) => {
    if (lastTotal !== null && Math.abs(row.total - lastTotal) < 0.0001 && row.violations.length === 0) {
      row.rank = lastRank;
    } else {
      row.rank = index + 1;
      lastRank = row.rank;
      lastTotal = row.total;
    }
  });

  return rows;
}

function scorePicks(contest: Contest, entry: Entry | undefined): { correct: number; decided: number; total: number } {
  const total = contest.gameWinner.enabled ? contest.games.length : 0;
  if (!entry || !contest.gameWinner.enabled) return { correct: 0, decided: 0, total };
  let correct = 0;
  let decided = 0;
  for (const game of contest.games) {
    if (game.state !== 'post') continue;
    const result = gradePick(game, entry.picks?.[game.id]);
    if (result === 'pending') continue;
    decided += 1;
    // A push pays nobody, so it counts as decided but not correct.
    if (result === 'covered') correct += 1;
  }
  return { correct, decided, total };
}

/** Freeze the final standings onto the contest document. */
export function toResults(rows: LeaderboardRow[]): Contest['results'] {
  return rows.map((row) => ({
    uid: row.uid,
    displayName: row.displayName,
    teamName: row.teamName,
    rank: row.rank,
    fantasyPoints: row.fantasyPoints,
    bonusPoints: row.bonusPoints,
    correctPicks: row.correctPicks,
    totalPicks: row.totalPicks,
    total: row.total,
  }));
}

/**
 * One line per person, not per device.
 *
 * Devices are tied together the moment their owner opens the site again, but a
 * phone left in a drawer never comes back, and the record it left behind would
 * keep standing next to its owner on the leaderboard. A name is a person here,
 * so where two records carry the same name only one of them is shown.
 *
 * The one kept is the one with something to show: their own row over a
 * stranger's, then a submitted lineup over an empty place, then whichever was
 * edited last — the same lineup a merge would have settled on.
 */
function collapseByPerson(
  uids: string[],
  nameOf: (uid: string) => string,
  entries: Map<string, Entry>,
  selfUid: string | null,
): string[] {
  const best = new Map<string, string>();
  const order: string[] = [];
  const rank = (uid: string): string => {
    if (uid === selfUid) return '3';
    const entry = entries.get(uid);
    return entry ? `2${entry.updatedAt ?? ''}` : '1';
  };

  for (const uid of uids) {
    // An entrant with no usable name cannot be matched to anyone, so they
    // stand alone rather than being folded in with every other blank.
    const key = displayKey(nameOf(uid)) || `uid:${uid}`;
    const held = best.get(key);
    if (held === undefined) {
      best.set(key, uid);
      order.push(key);
    } else if (rank(uid) > rank(held)) {
      best.set(key, uid);
    }
  }
  return order.map((key) => best.get(key) as string);
}
