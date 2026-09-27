import type { ReactNode } from 'react';
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

export function Initials({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();
  return <span className="player__shot-initials">{initials}</span>;
}
