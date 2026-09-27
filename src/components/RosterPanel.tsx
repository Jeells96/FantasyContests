import type { ContestPlayer, LineupSelection, RosterSlot } from '../types';
import { formatMoney } from '../lib/engine/lineup';
import { Initials } from './ui';

/**
 * The lineup itself: one row per roster slot. Tapping a slot focuses the player
 * list on the positions that slot accepts.
 */
export function RosterPanel({
  slots,
  lineup,
  playersById,
  activeSlotId,
  onSelectSlot,
  onRemove,
  live,
  readOnly,
}: {
  slots: RosterSlot[];
  lineup: LineupSelection[];
  playersById: Map<string, ContestPlayer>;
  activeSlotId?: string | null;
  onSelectSlot?: (slotId: string) => void;
  onRemove?: (slotId: string) => void;
  live?: boolean;
  readOnly?: boolean;
}) {
  const bySlot = new Map(lineup.map((line) => [line.slotId, line.playerId]));

  return (
    <div className="list">
      {slots.map((slot) => {
        const playerId = bySlot.get(slot.id);
        const player = playerId ? playersById.get(playerId) : undefined;
        const classes = [
          'slot',
          player ? 'slot--filled' : '',
          activeSlotId === slot.id ? 'slot--active' : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <div key={slot.id} className={classes}>
            <button
              type="button"
              className="row"
              style={{ gap: 10, flex: 1, minWidth: 0, textAlign: 'left' }}
              onClick={() => onSelectSlot?.(slot.id)}
              disabled={readOnly}
            >
              <span className="slot__tag">
                {slot.label}
                {slot.sport ? <div className="tiny faint">{slot.sport.toUpperCase()}</div> : null}
              </span>

              {player ? (
                <>
                  <span className={`player__shot${player.isTeamUnit ? ' player__shot--unit' : ''}`} style={{ width: 34, height: 34 }}>
                    {player.headshot ? <img src={player.headshot} alt="" loading="lazy" /> : <Initials name={player.name} />}
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="player__name" style={{ fontSize: 13.5 }}>
                      {player.name}
                    </span>
                    <span className="player__meta">
                      {player.position} · {player.teamAbbr} {player.isHome ? 'vs' : '@'} {player.opponentAbbr}
                    </span>
                  </span>
                </>
              ) : (
                <span className="slot__empty">
                  Empty · {slot.positions.includes('*') ? 'any position' : slot.positions.join(' / ')}
                </span>
              )}
            </button>

            {player ? (
              <div className="player__right">
                {live ? (
                  <span className="player__points">{(player.normalizedPoints ?? 0).toFixed(1)}</span>
                ) : (
                  <span className="player__salary">{formatMoney(player.salary)}</span>
                )}
                {!readOnly && onRemove ? (
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost"
                    style={{ minHeight: 20, padding: '0 4px' }}
                    onClick={() => onRemove(slot.id)}
                    aria-label={`Remove ${player.name}`}
                  >
                    <span className="tiny faint">remove</span>
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
