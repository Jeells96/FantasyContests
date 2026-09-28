import type { Contest, LeaderboardRow } from '../types';

/**
 * Every roster at once, as tiles.
 *
 * The point is to take in the whole field in a glance, so the tiles shrink to
 * fit the number of entrants rather than stacking into a long scroll: a handful
 * of teams get big tiles, a full group gets a tight grid.
 */
export function RosterGrid({
  rows,
  contest,
  pointDeltas,
}: {
  rows: LeaderboardRow[];
  contest: Contest;
  pointDeltas?: Map<string, number>;
}) {
  const columns = rows.length <= 2 ? 1 : rows.length <= 4 ? 2 : rows.length <= 9 ? 3 : 4;
  const captainMultiplier = contest.captain?.multiplier ?? 1.5;

  return (
    <div
      className={`roster-grid${columns >= 4 ? ' roster-grid--dense' : ''}`}
      style={{ ['--rg-cols' as string]: columns }}
    >
      {rows.map((row) => (
        <div
          key={row.uid}
          className={`rg-card${row.isSelf ? ' rg-card--self' : ''}${row.rank === 1 ? ' rg-card--leader' : ''}`}
        >
          <div className="rg-head">
            <span className="rg-rank">{row.rank}</span>
            <span className="rg-name">{row.teamName ?? row.displayName}</span>
          </div>

          <div className="rg-total">
            {row.total.toFixed(1)}
            {contest.gameWinner.enabled && row.bonusPoints > 0 ? (
              <span className="rg-bonus">+{row.bonusPoints.toFixed(1)}</span>
            ) : null}
          </div>

          {row.lines ? (
            <div className="rg-lines">
              {row.lines.map((line) => {
                const delta = line.player ? pointDeltas?.get(line.player.id) ?? 0 : 0;
                const shown = Math.round(delta * (line.isCaptain ? captainMultiplier : 1) * 10) / 10;
                return (
                  <div
                    className={`rg-line${shown > 0 ? ' rg-line--scored' : ''}${shown < 0 ? ' rg-line--dropped' : ''}`}
                    key={line.slot.id}
                  >
                    <span className="rg-player">
                      {line.isCaptain ? <span className="rg-cpt">C</span> : null}
                      {line.player ? shortName(line.player.name, line.player.teamAbbr) : '—'}
                    </span>
                    <span className="rg-pts">
                      {line.normalizedPoints.toFixed(1)}
                      {shown !== 0 ? (
                        <span className={`rg-delta${shown < 0 ? ' rg-delta--down' : ''}`}>
                          {shown > 0 ? '+' : ''}
                          {shown.toFixed(1)}
                        </span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rg-hidden">Hidden until lock</div>
          )}
        </div>
      ))}
    </div>
  );
}

/** "Tyler Higbee" -> "T. Higbee"; team units keep their abbreviation. */
function shortName(name: string, teamAbbr: string): string {
  if (/D\/ST|DEF/i.test(name)) return `${teamAbbr} D/ST`;
  const parts = name.replace(/\s+(Jr\.?|Sr\.?|I{2,}|IV|V)$/i, '').split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}
