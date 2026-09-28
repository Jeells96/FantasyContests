import type { ContestPlayer, LineupSelection, RosterSlot } from '../types';
import { formatMoney } from '../lib/engine/lineup';
import { DeltaBadge, Initials } from './ui';

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
  onToggleCaptain,
  captainMultiplier,
  pointDeltas,
  live,
  readOnly,
}: {
  slots: RosterSlot[];
  lineup: LineupSelection[];
  playersById: Map<string, ContestPlayer>;
  activeSlotId?: string | null;
  onSelectSlot?: (slotId: string) => void;
  onRemove?: (slotId: string) => void;
  onToggleCaptain?: (slotId: string) => void;
  /** Set when the contest has captains, which also enables the CPT control. */
  captainMultiplier?: number | null;
  /** playerId -> contest points just added. */
  pointDeltas?: Map<string, number>;
  live?: boolean;
  readOnly?: boolean;
}) {
  const bySlot = new Map(lineup.map((line) => [line.slotId, line.playerId]));
  const captainSlotId = lineup.find((line) => line.captain)?.slotId ?? null;
  // The captain always leads the roster, wherever the roster is shown.
  const ordered = [...slots].sort(
    (a, b) => Number(b.id === captainSlotId) - Number(a.id === captainSlotId),
  );

  return (
    <div className="list">
      {ordered.map((slot) => {
        const isCaptain = slot.id === captainSlotId;
        const playerId = bySlot.get(slot.id);
        const player = playerId ? playersById.get(playerId) : undefined;
        const justScored = player ? (pointDeltas?.get(player.id) ?? 0) !== 0 : false;
        const classes = [
          'slot',
          player ? 'slot--filled' : '',
          justScored ? 'slot--scored' : '',
          isCaptain ? 'slot--captain' : '',
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
                {/* The captain keeps their spot number: they are one of the
                    roster's spots, not an extra one on top. */}
                {slot.label}
                {isCaptain ? <span className="cpt-badge">CPT</span> : null}
                {slot.sport ? <div className="tiny faint">{slot.sport.toUpperCase()}</div> : null}
              </span>

              {player ? (
                <>
                  <span className={`player__shot${player.isTeamUnit ? ' player__shot--unit' : ''}`} data-sport={player.sport} style={{ width: 34, height: 34 }}>
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
                  {slot.positions.includes('*') ? 'Empty — tap to fill' : `Empty · ${slot.positions.join(' / ')}`}
                </span>
              )}
            </button>

            {player ? (
              <div className="player__right">
                {live ? (
                  <span className="player__points">
                    {(
                      (player.normalizedPoints ?? 0) * (isCaptain ? captainMultiplier ?? 1 : 1)
                    ).toFixed(1)}
                    <DeltaBadge
                      value={
                        (pointDeltas?.get(player.id) ?? 0) * (isCaptain ? captainMultiplier ?? 1 : 1)
                      }
                    />
                  </span>
                ) : (
                  <span className={`player__salary${isCaptain ? ' player__salary--captain' : ''}`}>
                    {formatMoney(
                      isCaptain ? Math.round(player.salary * (captainMultiplier ?? 1)) : player.salary,
                    )}
                  </span>
                )}
                {!readOnly && captainMultiplier && onToggleCaptain ? (
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost"
                    style={{ minHeight: 20, padding: '0 4px' }}
                    onClick={() => onToggleCaptain(slot.id)}
                    aria-label={isCaptain ? `Remove captain from ${player.name}` : `Make ${player.name} captain`}
                  >
                    <span className={`tiny ${isCaptain ? 'cpt-text' : 'faint'}`}>
                      {isCaptain ? 'captain' : 'make captain'}
                    </span>
                  </button>
                ) : null}
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
