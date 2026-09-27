import type {
  Contest,
  ContestPlayer,
  Entry,
  LeaderboardPlayerLine,
  LeaderboardRow,
  Standing,
} from '../../types';
import { validateLineup } from './lineup';
import { round2 } from './projections';

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
  const slotById = new Map(contest.rosterSlots.map((slot) => [slot.id, slot]));

  const uids = new Set<string>([...standings.map((s) => s.uid), ...entriesByUid.keys()]);
  const nameByUid = new Map(standings.map((s) => [s.uid, s.displayName]));

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
      const validation = validateLineup(entry.lineup, players, contest.rosterSlots, contest.salaryCapInfo.cap);
      violations = validation.errors;
      salaryUsed = validation.salaryUsed;

      const built: LeaderboardPlayerLine[] = [];
      for (const slot of contest.rosterSlots) {
        const selection = entry.lineup.find((line) => line.slotId === slot.id);
        const player = selection ? players.get(selection.playerId) ?? null : null;
        const raw = player?.rawPoints ?? 0;
        const normalized = player?.normalizedPoints ?? 0;
        fantasyPoints += normalized;
        built.push({ slot: slotById.get(slot.id) ?? slot, player, rawPoints: raw, normalizedPoints: normalized });
      }
      if (canSeeRoster) lines = built;
    }

    const { correct, decided, total } = scorePicks(contest, entry);
    const bonusPoints = round2(correct * (contest.gameWinner.enabled ? contest.gameWinner.bonusPoints : 0));

    rows.push({
      uid,
      displayName,
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
    if (!game.winnerTeamId) continue;
    decided += 1;
    if (entry.picks?.[game.id] === game.winnerTeamId) correct += 1;
  }
  return { correct, decided, total };
}

/** Freeze the final standings onto the contest document. */
export function toResults(rows: LeaderboardRow[]): Contest['results'] {
  return rows.map((row) => ({
    uid: row.uid,
    displayName: row.displayName,
    rank: row.rank,
    fantasyPoints: row.fantasyPoints,
    bonusPoints: row.bonusPoints,
    correctPicks: row.correctPicks,
    totalPicks: row.totalPicks,
    total: row.total,
  }));
}
