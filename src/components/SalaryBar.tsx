import { useEffect, useState, type ReactNode } from 'react';
import { formatMoney } from '../lib/engine/lineup';
import { Metric } from './ui';

/**
 * Sticky footer: salary used, salary remaining, roster progress and submit.
 *
 * When the lineup cannot be submitted yet, `blocker` says why here rather than
 * only further up the page — a disabled button with no reason next to it is the
 * thing people get stuck on.
 */
export function SalaryBar({
  cap,
  used,
  filled,
  total,
  action,
  blocker,
}: {
  cap: number;
  used: number;
  filled: number;
  total: number;
  action: ReactNode;
  blocker?: string | null;
}) {
  const remaining = cap - used;
  const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
  const over = remaining < 0;
  // What every still-empty spot can average if the rest of the cap is split
  // evenly between them — the number that tells you whether the lineup you are
  // part-way through can actually be finished.
  const openSpots = Math.max(0, total - filled);
  const averagePerSpot = openSpots > 0 ? Math.floor(remaining / openSpots) : null;

  /*
   * Make sure the numbers reach the screen.
   *
   * These figures change on every tap while the bar stays put, which is exactly
   * the case iOS Safari can serve from a stale texture: right in the DOM, wrong
   * on the glass, until the app is closed and reopened. The bar is no longer
   * promoted to its own layer, which should be enough; this nudges a repaint on
   * every change in case it is promoted anyway.
   */
  const [repaint, setRepaint] = useState(false);
  useEffect(() => {
    setRepaint(true);
    const frame = requestAnimationFrame(() => setRepaint(false));
    return () => cancelAnimationFrame(frame);
  }, [used, filled, total, cap, blocker]);

  return (
    <div className={`salarybar${repaint ? ' salarybar--repaint' : ''}`}>
      <div className="salarybar__grid">
        <Metric label="Salary" value={formatMoney(used)} tone={over ? 'bad' : undefined} />
        <Metric label="Remaining" value={formatMoney(remaining)} tone={over ? 'bad' : undefined} />
        <Metric
          label="Avg/spot"
          value={averagePerSpot === null ? '—' : formatMoney(averagePerSpot)}
          tone={averagePerSpot !== null && averagePerSpot < 0 ? 'bad' : undefined}
        />
        <Metric label="Roster" value={`${filled}/${total}`} />
        <div className="salarybar__action">{action}</div>
      </div>
      {blocker ? <div className="salarybar__blocker">{blocker}</div> : null}

      <div className="meter">
        <div className={`meter__fill${over ? ' meter__fill--over' : ''}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
