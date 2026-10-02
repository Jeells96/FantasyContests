import type { Contest, ContestGame, ContestPlayer, LineupSelection, RosterSlot } from '../../types';
import { isEligible } from './roster';
import { captainEnabled, captainMultiplier, effectiveSalary } from './captain';

export interface LineupValidation {
  valid: boolean;
  errors: string[];
  /** Includes the captain premium. */
  salaryUsed: number;
  filledSlots: number;
  totalSlots: number;
  captainPlayerId: string | null;
}

export interface CaptainRules {
  enabled: boolean;
  multiplier: number;
}

/**
 * Validate a lineup against the contest's own rules.
 *
 * Every roster spot must be filled, each player is real and used once, each is
 * eligible for the spot they occupy, and the roster fits inside the salary cap.
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
  captain: CaptainRules = { enabled: false, multiplier: 1 },
): LineupValidation {
  const errors: string[] = [];
  let captainPlayerId: string | null = null;
  let captainCount = 0;
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
    const isCaptain = Boolean(selection.captain) && captain.enabled;
    if (isCaptain) {
      captainCount += 1;
      captainPlayerId = player.id;
    }
    salaryUsed += effectiveSalary(player.salary, isCaptain, captain.multiplier);
    filledSlots += 1;
  }

  for (const slot of slots) {
    if (!seenSlots.has(slot.id)) errors.push(`${slot.label} is empty`);
  }

  if (captain.enabled) {
    if (captainCount > 1) errors.push('Only one player can be captain');
    else if (captainCount === 0 && filledSlots > 0) errors.push('Pick a team captain');
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
    captainPlayerId,
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
  const lineup = validateLineup(selections, playersById, contest.rosterSlots, contest.salaryCapInfo.cap, {
    enabled: captainEnabled(contest),
    multiplier: captainMultiplier(contest),
  });
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

/**
 * The same figure in four characters, for places where a full "$12,400" would
 * crowd out the name it sits beside. No dollar sign: next to a player in a
 * lineup there is nothing else it could be.
 */
export function formatMoneyShort(value: number): string {
  const rounded = Math.abs(Math.round(value));
  const sign = value < 0 ? '-' : '';
  if (rounded < 1000) return `${sign}${rounded}`;
  const thousands = rounded / 1000;
  return `${sign}${thousands < 10 ? thousands.toFixed(1) : Math.round(thousands)}k`;
}
