import { useState, type ReactNode } from 'react';
import { SPORT_LABELS, type ContestStatus, type Sport } from '../types';

export function SportPill({ sport }: { sport: Sport }) {
  return <span className={`pill pill--${sport}`}>{SPORT_LABELS[sport]}</span>;
}

export function StatusPill({ status }: { status: ContestStatus }) {
  if (status === 'live') {
    return (
      <span className="pill pill--live">
        <span className="dot dot--pulse" /> LIVE
      </span>
    );
  }
  if (status === 'complete') return <span className="pill pill--complete">FINAL</span>;
  return <span className="pill pill--open">OPEN</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="row" style={{ gap: 10, color: 'var(--text-dim)' }}>
      <span className="spinner" />
      {label ? <span className="tiny">{label}</span> : null}
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <div style={{ fontWeight: 700, color: 'var(--text)' }}>{title}</div>
      {hint ? <div className="tiny" style={{ marginTop: 6 }}>{hint}</div> : null}
    </div>
  );
}

export function Metric({ label, value, tone }: { label: string; value: ReactNode; tone?: 'bad' }) {
  return (
    <div className="metric">
      <div className="metric__label">{label}</div>
      <div className={`metric__value${tone === 'bad' ? ' metric__value--bad' : ''}`}>{value}</div>
    </div>
  );
}

export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div
      className="sheet-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div className="sheet" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <div className="sheet__handle" />
        <div className="row row--between" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{title}</div>
          <button type="button" className="btn btn--sm btn--ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
        {footer ? <div style={{ marginTop: 16 }}>{footer}</div> : null}
      </div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
    </label>
  );
}

export function KeyValue({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="kv">
      <span className="muted">{label}</span>
      <span className="kv__value">{value}</span>
    </div>
  );
}

export function Banner({ tone, children }: { tone?: 'warn' | 'bad' | 'ok'; children: ReactNode }) {
  return <div className={`banner${tone ? ` banner--${tone}` : ''}`}>{children}</div>;
}

/**
 * An answer to something the person just tapped, where they are looking.
 *
 * The page's banner sits at the top, which is fine for the state of the page
 * and useless as a reply to a tap: someone far down the player list taps a
 * button, the refusal is written three screens above them, and the button looks
 * broken. This floats above the page instead, so the answer arrives wherever
 * they happen to be.
 */
export function Toast({ tone, children }: { tone?: 'warn' | 'bad' | 'ok'; children: ReactNode }) {
  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      <div className={`toast${tone ? ` toast--${tone}` : ''}`}>{children}</div>
    </div>
  );
}

/**
 * Points a player just gained or lost. Green up, red down; nothing at all when
 * the number is zero.
 */
export function DeltaBadge({ value, className }: { value: number; className?: string }) {
  if (!value) return null;
  const down = value < 0;
  return (
    <span className={`delta-pop${down ? ' delta-pop--down' : ''}${className ? ` ${className}` : ''}`}>
      {value > 0 ? '+' : ''}
      {value.toFixed(1)}
    </span>
  );
}

/** "Savannah Tester" -> "Savannah T." */
export function shortPersonName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return name;
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export function Initials({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();
  return <span className="player__shot-initials">{initials}</span>;
}

/**
 * A section that stays out of the way until it is wanted.
 *
 * Most of a contest's settings are ones most people never change, and a page
 * of them buries the handful that matter. The summary says what the setting
 * currently is, so the section can stay shut and still be informative.
 */
export function Collapsible({
  title,
  summary,
  children,
  defaultOpen = false,
}: {
  title: string;
  summary?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="collapse">
      <button
        type="button"
        className="collapse__head"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="collapse__title">{title}</span>
        {summary ? <span className="collapse__summary">{summary}</span> : null}
        <span className={`collapse__chev${open ? ' collapse__chev--open' : ''}`} aria-hidden="true">
          ›
        </span>
      </button>
      {open ? <div className="collapse__body">{children}</div> : null}
    </div>
  );
}
