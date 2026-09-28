import { useEffect, useMemo, useRef, useState } from 'react';
import type { ContestPlayer } from '../types';

/** Ignore rounding noise. */
const MIN_DELTA = 0.05;

/**
 * Tracks the points each player just gained or lost, so every view can show a
 * green "+4.6" — or a red "-2.0" — on whoever it belongs to.
 *
 * The badges belong to the latest play: when the next one lands they are
 * replaced wholesale, so several players can be lit at once if they scored on
 * the same play, and nobody keeps a badge from two plays ago. The first
 * snapshot after a page load is adopted silently, since opening mid-game should
 * not light up everyone who has scored all afternoon.
 */
export function usePointDeltas(players: ContestPlayer[], enabled: boolean): Map<string, number> {
  const previous = useRef<Map<string, number> | null>(null);
  const [recorded, setRecorded] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    // The pool arrives after the first render. Treating that empty first
    // snapshot as a baseline would score everyone's whole total as a gain.
    if (players.length === 0) return;

    const next = new Map(players.map((player) => [player.id, player.normalizedPoints ?? 0]));
    const before = previous.current;
    previous.current = next;
    if (!before || before.size === 0 || !enabled) return;

    const changes = new Map<string, number>();
    for (const [id, points] of next.entries()) {
      // A player seen for the first time has no baseline to compare against.
      if (!before.has(id)) continue;
      const delta = Math.round((points - (before.get(id) ?? 0)) * 100) / 100;
      if (Math.abs(delta) >= MIN_DELTA) changes.set(id, delta);
    }
    // Nothing moved: the last play's badges stay up until something does.
    if (changes.size === 0) return;
    setRecorded(changes);
  }, [players, enabled]);

  return useMemo(() => recorded, [recorded]);
}
