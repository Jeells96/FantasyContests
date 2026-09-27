import type { ContestPlayer } from '../types';
import { formatMoney } from '../lib/engine/lineup';
import { Initials } from './ui';

export interface PlayerCardProps {
  player: ContestPlayer;
  selected?: boolean;
  used?: boolean;
  unaffordable?: boolean;
  /** Show live points instead of the projection. */
  live?: boolean;
  onClick?: () => void;
  onInfo?: () => void;
}

/**
 * Player card: headshot, name, position, team, opponent, salary, stat line and
 * either the projection or live scoring. Availability is communicated by the
 * card's own styling rather than by extra labels.
 */
export function PlayerCard({ player, selected, used, unaffordable, live, onClick, onInfo }: PlayerCardProps) {
  const scoring = (player.normalizedPoints ?? 0) > 0;
  const classes = [
    'player',
    selected ? 'player--selected' : '',
    used && !selected ? 'player--used' : '',
    unaffordable && !selected ? 'player--unaffordable' : '',
    live && scoring ? 'player--scoring' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const showRaw = player.sport !== 'nfl' && (player.rawPoints ?? 0) !== (player.normalizedPoints ?? 0);

  return (
    <div className={classes}>
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        className="row"
        style={{ gap: 11, flex: 1, minWidth: 0, background: 'none', padding: 0, textAlign: 'left' }}
      >
        <span className={`player__shot${player.isTeamUnit ? ' player__shot--unit' : ''}`}>
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
            {player.name}
            {player.injuryStatus ? <span className="pill pill--warn">{player.injuryStatus}</span> : null}
          </span>
          <span className="player__meta">
            <span className="pos-tag">{player.position}</span>
            {player.teamAbbr} {player.isHome ? 'vs' : '@'} {player.opponentAbbr}
          </span>
          {player.statLine ? <span className="player__stats">{player.statLine}</span> : null}
        </span>
      </button>

      <div className="player__right">
        <span className="player__salary">{formatMoney(player.salary)}</span>
        {live ? (
          <>
            <span className="player__points">{(player.normalizedPoints ?? 0).toFixed(1)} pts</span>
            {showRaw ? <span className="player__proj">raw {(player.rawPoints ?? 0).toFixed(1)}</span> : null}
          </>
        ) : (
          <span className="player__proj">proj {player.projection.normalized.toFixed(1)}</span>
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
