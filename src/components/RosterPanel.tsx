import type { ContestPlayer, LineupSelection, RosterSlot } from '../types';
import { formatMoney } from '../lib/engine/lineup';
import { allFinal, phaseOfPlayer, type ScorePhase } from '../lib/engine/phase';
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
  phases,
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
  /** Where each game is up to, so a projection is not shown as a score. */
  phases?: Map<string, ScorePhase>;
  live?: boolean;
  readOnly?: boolean;
}) {
  // Marking a score "final" only says something while others are not. Once
  // every game is over it is on every line, which is no longer a distinction.
  const mixed = phases ? !allFinal(phases) : false;
  const bySlot = new Map(lineup.map((line) => [line.slotId, line.playerId]));
  const captainSlotId = lineup.find((line) => line.captain)?.slotId ?? null;
  // Captain first, then most expensive to cheapest, with the spots still to
  // fill at the bottom — the same order a roster reads in everywhere else.
  const salaryOf = (slotId: string): number => {
    const playerId = bySlot.get(slotId);
    return playerId ? playersById.get(playerId)?.salary ?? 0 : -1;
  };
  const ordered = [...slots].sort(
    (a, b) =>
      Number(b.id === captainSlotId) - Number(a.id === captainSlotId) || salaryOf(b.id) - salaryOf(a.id),
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
                  (() => {
                    const phase = phases ? phaseOfPlayer(phases, player) : 'live';
                    const multiplier = isCaptain ? captainMultiplier ?? 1 : 1;
                    // Their game has not started: this is what they are expected
                    // to do, not what they have done.
                    if (phase === 'pre') {
                      return (
                        <span className="player__proj">
                          proj {(player.projection.normalized * multiplier).toFixed(1)}
                        </span>
                      );
                    }
                    return (
                      <span className={`player__points player__points--${phase}`}>
                        {((player.normalizedPoints ?? 0) * multiplier).toFixed(1)}
                        {phase === 'final' && mixed ? <span className="phase-tag">final</span> : null}
                        <DeltaBadge value={(pointDeltas?.get(player.id) ?? 0) * multiplier} />
                      </span>
                    );
                  })()
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
