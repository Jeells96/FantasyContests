import type { ContestPlayer } from '../types';
import { formatMoney } from '../lib/engine/lineup';
import { DeltaBadge, Initials } from './ui';

export interface PlayerCardProps {
  player: ContestPlayer;
  selected?: boolean;
  used?: boolean;
  unaffordable?: boolean;
  /** Show live points instead of the projection. */
  live?: boolean;
  /** This player is the team captain. */
  captain?: boolean;
  /** Salary and points multiplier applied to the captain. */
  captainMultiplier?: number;
  /** Contest points this player just added, shown as a green pop. */
  pointsDelta?: number;
  onClick?: () => void;
  onInfo?: () => void;
}

/**
 * Player card: headshot, name, position, team, opponent, salary, stat line and
 * either the projection or live scoring. Availability is communicated by the
 * card's own styling rather than by extra labels.
 */
export function PlayerCard({
  player,
  selected,
  used,
  unaffordable,
  live,
  captain,
  captainMultiplier = 1.5,
  pointsDelta,
  onClick,
  onInfo,
}: PlayerCardProps) {
  const scoring = (player.normalizedPoints ?? 0) > 0;
  const salary = captain ? Math.round(player.salary * captainMultiplier) : player.salary;
  const points = captain
    ? Math.round((player.normalizedPoints ?? 0) * captainMultiplier * 10) / 10
    : player.normalizedPoints ?? 0;
  const projection = captain
    ? Math.round(player.projection.normalized * captainMultiplier * 10) / 10
    : player.projection.normalized;
  const shownDelta = pointsDelta ? Math.round(pointsDelta * (captain ? captainMultiplier : 1) * 10) / 10 : 0;
  const classes = [
    'player',
    shownDelta > 0 ? 'player--scored' : '',
    shownDelta < 0 ? 'player--dropped' : '',
    captain ? 'player--captain' : '',
    selected ? 'player--selected' : '',
    used && !selected ? 'player--used' : '',
    unaffordable && !selected ? 'player--unaffordable' : '',
    live && scoring ? 'player--scoring' : '',
  ]
    .filter(Boolean)
    .join(' ');


  return (
    <div className={classes}>
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        className="row"
        style={{ gap: 11, flex: 1, minWidth: 0, background: 'none', padding: 0, textAlign: 'left' }}
      >
        <span className={`player__shot${player.isTeamUnit ? ' player__shot--unit' : ''}`} data-sport={player.sport}>
          {player.headshot ? (
            <img
              src={player.headshot}
              alt=""
              loading="lazy"
              onError={(event) => {
                (event.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <Initials name={player.name} />
          )}
        </span>

        <span className="player__body">
          <span className="player__name">
            {captain ? <span className="cpt-badge">CPT</span> : null}
            {player.name}
            {player.injuryStatus ? <span className="pill pill--warn">{player.injuryStatus}</span> : null}
            {/* Says why somebody good is cheap tonight. */}
            {player.availabilityNote ? (
              <span className="pill pill--warn">{player.availabilityNote}</span>
            ) : null}
          </span>
          <span className="player__meta">
            <span className="pos-tag">{player.position}</span>
            {player.teamAbbr} {player.isHome ? 'vs' : '@'} {player.opponentAbbr}
          </span>
          {player.statLine ? (
            <span className="player__stats">
              {/* Before kickoff this is last season's average, not a forecast of today. */}
              {live ? null : <span className="stat-tag">avg</span>}
              {player.statLine}
            </span>
          ) : null}
        </span>
      </button>

      <div className="player__right">
        <span className={`player__salary${captain ? ' player__salary--captain' : ''}`}>{formatMoney(salary)}</span>
        {live ? (
          <>
            <span className="player__points">
              {points.toFixed(1)} pts
              <DeltaBadge value={shownDelta} />
            </span>

          </>
        ) : (
          <span className="player__proj">proj {projection.toFixed(1)} pts</span>
        )}
        {onInfo ? (
          <button type="button" className="btn btn--sm btn--ghost" style={{ minHeight: 22, padding: '0 4px' }} onClick={onInfo}>
            <span className="tiny faint">details</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
