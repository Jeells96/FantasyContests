import { Link } from 'react-router-dom';
import type { Contest } from '../types';
import { deriveStatus, formatCountdown, formatDateTime } from '../lib/engine/contestState';
import { rosterSummary } from '../lib/engine/roster';
import { formatMoney } from '../lib/engine/lineup';
import { SportPill, StatusPill } from './ui';

export function ContestCard({ contest, entered }: { contest: Contest; entered: boolean }) {
  const status = deriveStatus(contest);
  const untilLock = Date.parse(contest.lockTime) - Date.now();

  return (
    <Link to={`/contest/${contest.id}`} className="card card--interactive" style={{ color: 'inherit', display: 'block' }}>
      <div className="row row--between" style={{ alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.02em' }}>{contest.name}</div>
          <div className="row row--wrap" style={{ gap: 6, marginTop: 6 }}>
            {contest.sports.map((sport) => (
              <SportPill key={sport} sport={sport} />
            ))}
            <span className="pill">{contest.games.length} games</span>
            {entered ? <span className="pill pill--open">ENTERED</span> : null}
          </div>
        </div>
        <StatusPill status={status} />
      </div>

      <div className="divider" style={{ marginTop: 12 }} />

      <div className="row row--between tiny muted">
        <span>{rosterSummary(contest.rosterSlots)}</span>
        <span className="num">{formatMoney(contest.salaryCapInfo.cap)} cap</span>
      </div>

      <div className="row row--between tiny" style={{ marginTop: 6 }}>
        <span className="faint">
          {status === 'open'
            ? `Locks in ${formatCountdown(untilLock)} · ${formatDateTime(contest.lockTime)}`
            : status === 'live'
              ? 'Rosters locked · live scoring'
              : 'Final results available'}
        </span>
        <span className="muted num">
          {contest.entrantCount} {contest.entrantCount === 1 ? 'entry' : 'entries'}
        </span>
      </div>

      <div className="scroll-x" style={{ marginTop: 10 }}>
        {contest.games.slice(0, 6).map((game) => (
          <span key={game.id} className="pill">
            {game.shortName}
            {game.state !== 'pre' ? (
              <span className="num" style={{ color: 'var(--text-faint)' }}>
                {game.away.score ?? 0}-{game.home.score ?? 0}
              </span>
            ) : null}
          </span>
        ))}
        {contest.games.length > 6 ? <span className="pill">+{contest.games.length - 6}</span> : null}
      </div>
    </Link>
  );
}
