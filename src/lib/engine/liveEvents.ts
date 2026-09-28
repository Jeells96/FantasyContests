import type { ContestPlayer, ContestScoring, Sport, StatMap } from '../../types';
import { computeRawFantasyPoints } from '../scoring';
import { normalizationFactor } from './normalization';
import type { NormalizationInfo } from '../../types';

/**
 * Turns stat changes into broadcast-style events for the scoring animation.
 * Only genuinely notable plays are surfaced, so the overlay feels like a live
 * whip-around rather than a stat ticker.
 */

export type EventTone = 'big' | 'good' | 'bad';

export interface ScoringEvent {
  id: string;
  playerId: string;
  playerName: string;
  headshot?: string;
  teamAbbr: string;
  sport: Sport;
  /** Headline, e.g. "TOUCHDOWN!" */
  title: string;
  /** Points added by this play, in contest (normalized) points. */
  points: number;
  tone: EventTone;
  at: number;
}

interface EventRule {
  stat: string;
  title: string | ((delta: number, next: StatMap, prev: StatMap) => string);
  tone?: EventTone;
  /** Minimum increase before the event fires. */
  threshold?: number;
}

const FOOTBALL_RULES: EventRule[] = [
    { stat: 'passTD', title: 'TOUCHDOWN!', tone: 'big' },
    { stat: 'rushTD', title: 'TOUCHDOWN!', tone: 'big' },
    { stat: 'recTD', title: 'TOUCHDOWN!', tone: 'big' },
    { stat: 'krTD', title: 'RETURN TOUCHDOWN!', tone: 'big' },
    { stat: 'prTD', title: 'RETURN TOUCHDOWN!', tone: 'big' },
    { stat: 'dstTD', title: 'DEFENSIVE TOUCHDOWN!', tone: 'big' },
    { stat: 'twoPt', title: '2-POINT CONVERSION', tone: 'good' },
    { stat: 'fgMade', title: 'FIELD GOAL', tone: 'good' },
    { stat: 'dstSafety', title: 'SAFETY!', tone: 'good' },
    { stat: 'dstInt', title: 'INTERCEPTION', tone: 'good' },
    { stat: 'dstFumRec', title: 'FUMBLE RECOVERY', tone: 'good' },
    { stat: 'passInt', title: 'INTERCEPTED', tone: 'bad' },
    { stat: 'fumLost', title: 'FUMBLE LOST', tone: 'bad' },
];

const RULES: Record<Sport, EventRule[]> = {
  nfl: FOOTBALL_RULES,
  ncaaf: FOOTBALL_RULES,
  mlb: [
    {
      stat: 'hr',
      title: (_delta, next, prev) => ((next.rbi ?? 0) - (prev.rbi ?? 0) >= 4 ? 'GRAND SLAM!' : 'HOME RUN!'),
      tone: 'big',
    },
    { stat: 'triples', title: 'TRIPLE!', tone: 'good' },
    { stat: 'doubles', title: 'DOUBLE', tone: 'good' },
    { stat: 'sb', title: 'STOLEN BASE', tone: 'good' },
    { stat: 'pitchSO', title: 'STRIKEOUT', tone: 'good', threshold: 3 },
    { stat: 'pitchSV', title: 'SAVE!', tone: 'big' },
  ],
  nba: [
    { stat: 'td3', title: 'TRIPLE-DOUBLE!', tone: 'big' },
    { stat: 'dd', title: 'DOUBLE-DOUBLE!', tone: 'big' },
    { stat: 'fg3m', title: 'THREE-POINTER', tone: 'good' },
    { stat: 'blk', title: 'BLOCK', tone: 'good', threshold: 2 },
  ],
};

export interface DetectOptions {
  player: ContestPlayer;
  previous: StatMap | undefined;
  next: StatMap | undefined;
  scoring: ContestScoring;
  normalization: NormalizationInfo;
}

export function detectScoringEvents(options: DetectOptions): ScoringEvent[] {
  const { player, previous, next, scoring, normalization } = options;
  if (!next) return [];
  // No baseline yet: adopt the current line silently rather than replaying the
  // whole game as a burst of animations.
  if (!previous) return [];

  const table = scoring[player.sport];
  if (!table) return [];
  const factor = normalizationFactor(normalization, player.sport);
  const rules = RULES[player.sport] ?? [];
  const events: ScoringEvent[] = [];
  const now = Date.now();

  for (const rule of rules) {
    const before = previous[rule.stat] ?? 0;
    const after = next[rule.stat] ?? 0;
    const delta = after - before;
    const threshold = rule.threshold ?? 1;
    if (delta < threshold) continue;

    const pointsBefore = computeRawFantasyPoints(previous, table);
    const pointsAfter = computeRawFantasyPoints(next, table);
    const gained = Math.round((pointsAfter - pointsBefore) * factor * 10) / 10;

    events.push({
      id: `${player.id}-${rule.stat}-${after}-${now}`,
      playerId: player.id,
      playerName: player.name,
      headshot: player.headshot,
      teamAbbr: player.teamAbbr,
      sport: player.sport,
      title: typeof rule.title === 'function' ? rule.title(delta, next, previous) : rule.title,
      points: gained,
      tone: rule.tone ?? 'good',
      at: now,
    });
  }

  // One animation per player per update: the biggest thing that happened.
  if (events.length <= 1) return events;
  const priority: Record<EventTone, number> = { big: 0, good: 1, bad: 2 };
  return [events.sort((a, b) => priority[a.tone] - priority[b.tone] || b.points - a.points)[0]];
}
