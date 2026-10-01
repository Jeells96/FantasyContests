import { Link } from 'react-router-dom';
import type { Contest } from '../types';
import { deriveStatus, formatCountdown, formatDateTime } from '../lib/engine/contestState';
import { rosterSummary } from '../lib/engine/roster';
import { formatMoney } from '../lib/engine/lineup';
import { SportPill, StatusPill } from './ui';
import { JoinCode } from './JoinCode';
import { OwnerControls } from './OwnerControls';

export function ContestCard({
  contest,
  entered,
  isOwner,
  openPicks = 0,
}: {
  contest: Contest;
  entered: boolean;
  isOwner: boolean;
  /** Spread picks whose line has posted but which this device has not made. */
  openPicks?: number;
}) {
  const status = deriveStatus(contest);
  const untilLock = Date.parse(contest.lockTime) - Date.now();

  return (
    <div className="card card--interactive" style={{ color: 'inherit' }}>
      <Link to={`/contest/${contest.id}`} style={{ color: 'inherit', display: 'block' }}>
      <div className="row row--between" style={{ alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.02em' }}>{contest.name}</div>
          <div className="row row--wrap" style={{ gap: 6, marginTop: 6 }}>
            {contest.sports.map((sport) => (
              <SportPill key={sport} sport={sport} />
            ))}
            <span className="pill">{contest.games.length} games</span>
            {entered ? <span className="pill pill--open">ENTERED</span> : null}
            {openPicks > 0 ? (
              <span className="pill pill--alert">
                {openPicks} PICK{openPicks === 1 ? '' : 'S'} TO MAKE
              </span>
            ) : null}
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

      {/* Outside the link: sharing and managing are not "open the contest". */}
      <div className="card__footer">
        <JoinCode contest={contest} compact />
        {isOwner ? <OwnerControls contest={contest} /> : null}
      </div>
    </div>
  );
}

/**
 * A finished contest, in one line.
 *
 * A contest that is over is a result, not an invitation to do anything, so it
 * gets a line rather than a card: who won, and by how much. They pile up week
 * on week, and a season of them should not be what stands between someone and
 * the contest they are actually playing.
 */
export function CompletedContestRow({ contest, uid }: { contest: Contest; uid: string }) {
  const winner = (contest.results ?? []).find((row) => row.rank === 1);
  const mine = (contest.results ?? []).find((row) => row.uid === uid);
  const iWon = Boolean(winner && mine && winner.uid === mine.uid);

  return (
    <Link to={`/contest/${contest.id}`} className="done-row" style={{ color: 'inherit' }}>
      <span className="done-row__main">
        <span className="done-row__name">{contest.name}</span>
        <span className="tiny faint">
          {formatDateTime(contest.lockTime)}
          {mine && !iWon ? ` · you finished ${ordinal(mine.rank)}` : ''}
        </span>
      </span>
      <span className="done-row__result">
        {winner ? (
          <>
            <span className={`done-row__winner${iWon ? ' done-row__winner--me' : ''}`}>
              {iWon ? 'You won' : winner.displayName}
            </span>
            <span className="tiny faint num">{winner.total.toFixed(1)}</span>
          </>
        ) : (
          <span className="tiny faint">Final</span>
        )}
      </span>
    </Link>
  );
}

function ordinal(rank: number): string {
  const tens = rank % 100;
  if (tens >= 11 && tens <= 13) return `${rank}th`;
  return `${rank}${['th', 'st', 'nd', 'rd'][rank % 10] ?? 'th'}`;
}
