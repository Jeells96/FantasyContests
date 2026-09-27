import type { Contest, ContestGame, ContestStatus } from '../../types';

/**
 * Contest state is derived, never trusted from a stored flag alone: the whole
 * contest locks the moment its first game starts, and completes when every game
 * is final. The stored `status` field is a cache for querying and display.
 */

export function earliestStart(games: ContestGame[]): string {
  return games.reduce((earliest, game) => (game.startTime < earliest ? game.startTime : earliest), games[0]?.startTime ?? '');
}

export function latestStart(games: ContestGame[]): string {
  return games.reduce((latest, game) => (game.startTime > latest ? game.startTime : latest), games[0]?.startTime ?? '');
}

/** The lock moment: kickoff/first pitch/tip-off of the earliest game. */
export function lockTimeOf(contest: Pick<Contest, 'lockTime' | 'games'>): number {
  const stored = Date.parse(contest.lockTime);
  if (Number.isFinite(stored)) return stored;
  const derived = Date.parse(earliestStart(contest.games));
  return Number.isFinite(derived) ? derived : Number.POSITIVE_INFINITY;
}

export function isContestLocked(contest: Pick<Contest, 'lockTime' | 'games'>, now: Date = new Date()): boolean {
  if (contest.games.some((game) => game.state !== 'pre')) return true;
  return now.getTime() >= lockTimeOf(contest);
}

export function allGamesFinal(contest: Pick<Contest, 'games'>): boolean {
  return contest.games.length > 0 && contest.games.every((game) => game.state === 'post');
}

export function deriveStatus(
  contest: Pick<Contest, 'lockTime' | 'games' | 'finalizedAt'>,
  now: Date = new Date(),
): ContestStatus {
  if (contest.finalizedAt) return 'complete';
  if (allGamesFinal(contest)) return 'complete';
  return isContestLocked(contest, now) ? 'live' : 'open';
}

export function statusLabel(status: ContestStatus): string {
  if (status === 'open') return 'Open';
  if (status === 'live') return 'Live';
  return 'Final';
}

/** "2d 4h", "3h 12m", "48s" */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'Locked';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

export function formatGameTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
