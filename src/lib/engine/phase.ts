import type { Contest, ContestGame, ContestPlayer } from '../../types';

/**
 * What a number on screen actually means.
 *
 * A contest shows points for players whose games are hours apart, and until
 * now they all looked the same: a projection, a score halfway through a game
 * and a final score were the same plain number, so a player yet to take the
 * field was indistinguishable from one who played and did nothing. Every view
 * reads this, so a figure is marked the same way wherever it appears.
 */
export type ScorePhase = 'pre' | 'live' | 'final';

export function phaseOfGame(game: Pick<ContestGame, 'state'> | undefined): ScorePhase {
  if (!game) return 'pre';
  if (game.state === 'post') return 'final';
  return game.state === 'pre' ? 'pre' : 'live';
}

/**
 * A lookup from game to phase, built once per render rather than per player.
 */
export function phasesByGame(contest: Pick<Contest, 'games'>): Map<string, ScorePhase> {
  return new Map(contest.games.map((game) => [game.id, phaseOfGame(game)]));
}

/**
 * The phase a player's score is in. The game is the authority; the flag stored
 * on the player is what is left when a player's game is no longer in the
 * contest to ask.
 */
export function phaseOfPlayer(
  phases: Map<string, ScorePhase>,
  player: Pick<ContestPlayer, 'gameId' | 'started'> | null | undefined,
): ScorePhase {
  if (!player) return 'pre';
  return phases.get(player.gameId) ?? (player.started ? 'final' : 'pre');
}

/** Everything in the contest is over. */
export function allFinal(phases: Map<string, ScorePhase>): boolean {
  return phases.size > 0 && [...phases.values()].every((phase) => phase === 'final');
}
