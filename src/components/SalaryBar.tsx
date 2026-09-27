import type { ReactNode } from 'react';
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

  return (
    <div className="salarybar">
      <div className="salarybar__grid">
        <Metric label="Salary" value={formatMoney(used)} tone={over ? 'bad' : undefined} />
        <Metric label="Remaining" value={formatMoney(remaining)} tone={over ? 'bad' : undefined} />
        <Metric label="Roster" value={`${filled}/${total}`} />
        {action}
      </div>
      {blocker ? <div className="salarybar__blocker">{blocker}</div> : null}

      <div className="meter">
        <div className={`meter__fill${over ? ' meter__fill--over' : ''}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
