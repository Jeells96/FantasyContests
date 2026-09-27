import type { Contest, ContestGame, ContestPlayer, LineupSelection, RosterSlot } from '../../types';
import { isEligible } from './roster';

export interface LineupValidation {
  valid: boolean;
  errors: string[];
  salaryUsed: number;
  filledSlots: number;
  totalSlots: number;
}

/**
 * Validate a lineup against the contest's own rules.
 *
 * A lineup does not have to be full: an entrant who spends their cap before
 * filling every spot can submit as they are, and the empty spots simply score
 * nothing. What is enforced is that every player is real, used once, eligible
 * for the spot they occupy, and that the roster is inside the salary cap.
 *
 * Used by the builder to gate submission and again when scoring, so an entry
 * crafted outside the UI cannot buy an illegal roster: the leaderboard
 * re-validates every submitted lineup against the stored salaries and cap.
 */
export function validateLineup(
  selections: LineupSelection[],
  playersById: Map<string, ContestPlayer>,
  slots: RosterSlot[],
  salaryCap: number,
): LineupValidation {
  const errors: string[] = [];
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const seenSlots = new Set<string>();
  const seenPlayers = new Set<string>();
  let salaryUsed = 0;
  let filledSlots = 0;

  for (const selection of selections) {
    const slot = slotById.get(selection.slotId);
    if (!slot) {
      errors.push(`Unknown roster slot "${selection.slotId}"`);
      continue;
    }
    if (seenSlots.has(selection.slotId)) {
      errors.push(`Slot ${slot.label} was filled more than once`);
      continue;
    }
    seenSlots.add(selection.slotId);

    const player = playersById.get(selection.playerId);
    if (!player) {
      errors.push(`Unknown player in ${slot.label}`);
      continue;
    }
    if (seenPlayers.has(player.id)) {
      errors.push(`${player.name} appears more than once`);
      continue;
    }
    seenPlayers.add(player.id);

    if (!isEligible(player, slot)) {
      errors.push(`${player.name} (${player.position}) is not eligible for ${slot.label}`);
      continue;
    }
    salaryUsed += player.salary;
    filledSlots += 1;
  }

  if (filledSlots === 0) {
    errors.push('Pick at least one player');
  }

  if (salaryCap > 0 && salaryUsed > salaryCap) {
    errors.push(`Over the salary cap by ${formatMoney(salaryUsed - salaryCap)}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    salaryUsed,
    filledSlots,
    totalSlots: slots.length,
  };
}

/** Game-winner picks must cover every game once they are enabled. */
export function validatePicks(picks: Record<string, string>, games: ContestGame[]): string[] {
  const errors: string[] = [];
  for (const game of games) {
    const pick = picks[game.id];
    if (!pick) {
      errors.push(`Pick a winner for ${game.shortName}`);
      continue;
    }
    if (pick !== game.home.id && pick !== game.away.id) {
      errors.push(`Invalid winner selection for ${game.shortName}`);
    }
  }
  return errors;
}

export function validateEntry(
  contest: Contest,
  selections: LineupSelection[],
  picks: Record<string, string>,
  playersById: Map<string, ContestPlayer>,
): LineupValidation {
  const lineup = validateLineup(selections, playersById, contest.rosterSlots, contest.salaryCapInfo.cap);
  const pickErrors = contest.gameWinner.enabled ? validatePicks(picks, contest.games) : [];
  return {
    ...lineup,
    errors: [...lineup.errors, ...pickErrors],
    valid: lineup.valid && pickErrors.length === 0,
  };
}

export function formatMoney(value: number): string {
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(value)).toLocaleString('en-US')}`;
}
