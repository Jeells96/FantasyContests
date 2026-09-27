import type { ReactNode } from 'react';
import { formatMoney } from '../lib/engine/lineup';
import { Metric } from './ui';

/** Sticky footer: salary used, salary remaining, roster progress and submit. */
export function SalaryBar({
  cap,
  used,
  filled,
  total,
  action,
}: {
  cap: number;
  used: number;
  filled: number;
  total: number;
  action: ReactNode;
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
      <div className="meter">
        <div className={`meter__fill${over ? ' meter__fill--over' : ''}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
