import type { Contest, LeaderboardRow } from '../types';
import { formatMoney } from '../lib/engine/lineup';
import { ownershipOf } from '../lib/engine/ownership';
import { PlayerName } from './PlayerName';
import { formatLine, gradePick, hasSpread, pickOpen, spreadFor } from '../lib/engine/spread';
import { phaseOfPlayer, phasesByGame } from '../lib/engine/phase';

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
  onOpenPlayer,
}: {
  rows: LeaderboardRow[];
  contest: Contest;
  pointDeltas?: Map<string, number>;
  onOpenPlayer?: (playerId: string) => void;
}) {
  const columns = rows.length <= 2 ? 1 : rows.length <= 4 ? 2 : rows.length <= 9 ? 3 : 4;
  const captainMultiplier = contest.captain?.multiplier ?? 1.5;
  const phases = phasesByGame(contest);
  // What each player cost, and how many of the teams here took him.
  const ownership = ownershipOf(rows);

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
            <span className="rg-name">
              {row.teamName ?? row.displayName}
              {row.wagerIn ? <span className="wager-mark" title="In on the wager">💰</span> : null}
            </span>
          </div>

          <div className="rg-total">{row.total.toFixed(1)}</div>
          {/* Where the total came from: a pick bonus is not a player's doing. */}
          {contest.gameWinner.enabled ? (
            <div className="rg-split">
              <span>{row.fantasyPoints.toFixed(1)} roster</span>
              <span className={row.bonusPoints > 0 ? 'rg-split__bonus' : undefined}>
                {row.bonusPoints > 0 ? '+' : ''}
                {row.bonusPoints.toFixed(1)} picks
              </span>
            </div>
          ) : null}

          {row.lines ? (
            <div className="rg-lines">
              {row.lines.map((line) => {
                const delta = line.player ? pointDeltas?.get(line.player.id) ?? 0 : 0;
                const shown = Math.round(delta * (line.isCaptain ? captainMultiplier : 1) * 10) / 10;
                const phase = phaseOfPlayer(phases, line.player);
                // Nobody has a score before their game starts, so showing one —
                // a flat 0.0 — reads as "played and did nothing". What they are
                // expected to do is the honest number, said as an expectation.
                const projected = line.player
                  ? Math.round(line.player.projection.normalized * (line.isCaptain ? captainMultiplier : 1) * 10) / 10
                  : 0;
                return (
                  <div
                    className={`rg-line${shown > 0 ? ' rg-line--scored' : ''}${shown < 0 ? ' rg-line--dropped' : ''}`}
                    key={line.slot.id}
                  >
                    <span className="rg-who">
                      {/* Outside the name, so a long name truncates around the
                          badge rather than the badge surviving alone. */}
                      {line.isCaptain ? <span className="rg-cpt">C</span> : null}
                      <span className="rg-player">
                        {line.player ? (
                          <PlayerName
                            name={shortName(line.player.name, line.player.teamAbbr)}
                            playerId={line.player.id}
                            onOpenPlayer={onOpenPlayer}
                          />
                        ) : (
                          '—'
                        )}
                      </span>
                      <span className={`rg-pts rg-pts--${phase}`}>
                        {phase === 'pre' && line.player ? (
                          <span className="rg-proj" title="Projected — this game has not started">
                            {projected.toFixed(1)}
                          </span>
                        ) : (
                          line.normalizedPoints.toFixed(1)
                        )}
                        {shown !== 0 ? (
                          <span className={`rg-delta${shown < 0 ? ' rg-delta--down' : ''}`}>
                            {shown > 0 ? '+' : ''}
                            {shown.toFixed(1)}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    {/* What they cost and how rare they are, on their own small
                        line: a full salary cannot share a tile row with a name
                        without one of them losing. */}
                    {line.player ? (
                      <span className="rg-meta">
                        <span className="rg-sal">{formatMoney(line.salary)}</span>
                        <span className="rg-own">
                          {ownership.byPlayer.get(line.player.id) ?? 0}/{ownership.teams} teams
                        </span>
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rg-hidden">Hidden until lock</div>
          )}

          {contest.gameWinner.enabled && row.picks ? (
            <>
              <div className="rg-picks__head">
                {/* Against decided games, not every game: "2/5" with three still
                    to play reads as three wrong. */}
                {row.correctPicks}/{row.decidedPicks} picks
                {row.bonusPoints > 0 ? (
                  <span className="rg-split__bonus"> +{row.bonusPoints.toFixed(1)}</span>
                ) : null}
                {row.totalPicks > row.decidedPicks ? (
                  <span className="faint"> · {row.totalPicks - row.decidedPicks} open</span>
                ) : null}
              </div>
            <div className="rg-picks">
              {contest.games.map((game) => {
                const pick = row.picks?.[game.id];
                const team = [game.home, game.away].find((candidate) => candidate.id === pick);
                const result = gradePick(game, pick);
                const final = game.state === 'post';
                const side = team && team.id === game.home.id ? 'home' : 'away';
                // Somebody else's pick on a game still to start is withheld, so
                // an empty slot here is a secret rather than an omission.
                const covered = !row.isSelf && pickOpen(game);
                if (covered) {
                  return (
                    <span key={game.id} className="rg-pick rg-pick--hidden" title="Hidden until the game starts">
                      🔒
                    </span>
                  );
                }
                return (
                  <span
                    key={game.id}
                    className={`rg-pick${final && result === 'covered' ? ' rg-pick--won' : ''}${
                      final && result === 'missed' ? ' rg-pick--lost' : ''
                    }${final && result === 'push' ? ' rg-pick--push' : ''}`}
                  >
                    {team?.abbreviation ?? '—'}
                    {team && hasSpread(game) ? <span className="rg-pick__line">{formatLine(spreadFor(game, side))}</span> : null}
                    {final && result !== 'pending' ? (
                      <span className="rg-pick__mark">
                        {result === 'covered' ? '✓' : result === 'push' ? '=' : '✗'}
                      </span>
                    ) : null}
                  </span>
                );
              })}
            </div>
            </>
          ) : null}
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
