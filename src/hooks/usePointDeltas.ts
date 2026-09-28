import { useEffect, useMemo, useRef, useState } from 'react';
import type { ContestPlayer } from '../types';

/** How long a player keeps their "just scored" badge. */
const HOLD_MS = 45_000;
/** Ignore rounding noise. */
const MIN_DELTA = 0.05;

interface Recorded {
  delta: number;
  at: number;
}

/**
 * Tracks which players just scored, so every view can show a green "+4.6" on
 * the player who earned it. The first snapshot is adopted silently — opening
 * the page mid-game should not light up everyone who has scored all afternoon.
 */
export function usePointDeltas(players: ContestPlayer[], enabled: boolean): Map<string, number> {
  const previous = useRef<Map<string, number> | null>(null);
  const [recorded, setRecorded] = useState<Map<string, Recorded>>(new Map());
  const [, setTick] = useState(0);

  useEffect(() => {
    // The pool arrives after the first render. Treating that empty first
    // snapshot as a baseline would score everyone's whole total as a gain.
    if (players.length === 0) return;

    const next = new Map(players.map((player) => [player.id, player.normalizedPoints ?? 0]));
    const before = previous.current;
    previous.current = next;
    if (!before || before.size === 0 || !enabled) return;

    const gains: [string, Recorded][] = [];
    for (const [id, points] of next.entries()) {
      // A player seen for the first time has no baseline to compare against.
      if (!before.has(id)) continue;
      const delta = Math.round((points - (before.get(id) ?? 0)) * 100) / 100;
      if (delta >= MIN_DELTA) gains.push([id, { delta, at: Date.now() }]);
    }
    if (gains.length === 0) return;
    setRecorded((current) => {
      const merged = new Map(current);
      for (const [id, entry] of gains) merged.set(id, entry);
      return merged;
    });
  }, [players, enabled]);

  // Re-render while badges are showing so they expire on their own.
  useEffect(() => {
    if (recorded.size === 0) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 5000);
    return () => window.clearInterval(timer);
  }, [recorded]);

  return useMemo(() => {
    const now = Date.now();
    const live = new Map<string, number>();
    for (const [id, entry] of recorded.entries()) {
      if (now - entry.at < HOLD_MS) live.set(id, entry.delta);
    }
    return live;
    // `recorded` changing and the tick both refresh this.
  }, [recorded, /* eslint-disable-line */ setTick]);
}
