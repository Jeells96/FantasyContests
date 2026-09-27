import { useEffect, useRef, useState } from 'react';
import { detectScoringEvents, type ScoringEvent } from '../lib/engine/liveEvents';
import type { Contest, ContestPlayer, StatMap } from '../types';

/**
 * Watches the live player pool and produces broadcast-style events for the
 * players the viewer actually rosters, so the overlay celebrates *their* team.
 */
export function useScoringEvents(
  contest: Contest | null,
  players: ContestPlayer[],
  watchedPlayerIds: Set<string>,
  enabled: boolean,
): { events: ScoringEvent[]; dismiss: (id: string) => void } {
  const previous = useRef<Map<string, StatMap>>(new Map());
  const [events, setEvents] = useState<ScoringEvent[]>([]);

  useEffect(() => {
    if (!contest) return;
    const next = new Map<string, StatMap>();
    const produced: ScoringEvent[] = [];

    for (const player of players) {
      const stats = player.liveStats;
      if (!stats) continue;
      next.set(player.id, stats);
      if (!enabled || !watchedPlayerIds.has(player.id)) continue;
      produced.push(
        ...detectScoringEvents({
          player,
          previous: previous.current.get(player.id),
          next: stats,
          scoring: contest.scoring,
          normalization: contest.normalization,
        }),
      );
    }

    // Keep the baseline for every player, including ones not being watched, so
    // adding a player mid-game does not replay their whole afternoon.
    previous.current = next;
    if (produced.length > 0) setEvents((current) => [...current, ...produced].slice(-4));
  }, [contest, players, watchedPlayerIds, enabled]);

  useEffect(() => {
    if (events.length === 0) return;
    const timer = window.setTimeout(() => setEvents((current) => current.slice(1)), 3900);
    return () => window.clearTimeout(timer);
  }, [events]);

  return { events, dismiss: (id) => setEvents((current) => current.filter((event) => event.id !== id)) };
}
