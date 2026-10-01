import { useState } from 'react';
import type { Contest, LeaderboardRow } from '../types';
import { formatMoney } from '../lib/engine/lineup';
import { formatLine, gradePick, hasSpread, spreadFor } from '../lib/engine/spread';
import { phaseOfPlayer, phasesByGame } from '../lib/engine/phase';
import { DeltaBadge, Empty } from './ui';
import { RosterGrid } from './RosterGrid';
import { PlayerName } from './PlayerName';

/**
 * Live leaderboard. Rosters are only ever present in a row once the contest has
 * locked (or for the viewer's own entry), because the data for other entrants
 * simply is not readable before then.
 */
export function LeaderboardList({
  rows,
  contest,
  locked,
  pointDeltas,
  onOpenPlayer,
}: {
  rows: LeaderboardRow[];
  contest: Contest;
  locked: boolean;
  pointDeltas?: Map<string, number>;
  onOpenPlayer?: (playerId: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const phases = phasesByGame(contest);
  const bonusPer = contest.gameWinner.enabled ? contest.gameWinner.bonusPoints : 0;
  // The whole field at a glance is the more useful default.
  const [showAll, setShowAll] = useState(true);

  if (rows.length === 0) {
    return <Empty title="No entries yet" hint="Be the first to build a lineup." />;
  }

  return (
    <div className="list">
      {!locked ? (
        <div className="banner banner--warn">
          Rosters and spread picks stay hidden until the first game starts. Scoring begins at lock.
        </div>
      ) : (
        <button
          type="button"
          className={`btn btn--sm${showAll ? ' btn--primary' : ''}`}
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? 'Hide all rosters' : 'Show every roster'}
        </button>
      )}

      {showAll && locked ? (
        <RosterGrid rows={rows} contest={contest} pointDeltas={pointDeltas} onOpenPlayer={onOpenPlayer} />
      ) : null}

      {showAll && locked
        ? null
        : rows.map((row) => {
        const open = expanded === row.uid;
        return (
          <div key={row.uid}>
            <button
              type="button"
              className={`lb-row${row.isSelf ? ' lb-row--self' : ''}${row.rank === 1 ? ' lb-row--leader' : ''}`}
              onClick={() => setExpanded(open ? null : row.uid)}
            >
              <span className="lb-rank">{row.rank}</span>
              <span style={{ minWidth: 0 }}>
                <span className="lb-name">
                  {row.teamName ?? row.displayName}
                  {row.isSelf ? <span className="tiny muted"> · you</span> : null}
                </span>
                {row.teamName ? <span className="lb-sub">{row.displayName}</span> : null}
                <span className="lb-sub">
                  {row.fantasyPoints.toFixed(1)} roster
                  {contest.gameWinner.enabled ? (
                    <>
                      {' + '}
                      <span className={row.bonusPoints > 0 ? 'lb-bonus' : undefined}>
                        {row.bonusPoints.toFixed(1)} picks
                      </span>
                      {' ('}
                      {row.correctPicks}/{row.decidedPicks} correct
                      {row.totalPicks > row.decidedPicks ? `, ${row.totalPicks - row.decidedPicks} to come` : ''}
                      {')'}
                    </>
                  ) : (
                    ' pts'
                  )}
                  {row.lines ? ` · ${formatMoney(row.salaryUsed)}` : ''}
                  {row.violations.length > 0 ? ' · invalid lineup' : ''}
                </span>
              </span>
              <span className="lb-total">{row.total.toFixed(1)}</span>
            </button>

            {open ? (
              <div className="lb-detail">
                {row.violations.length > 0 ? (
                  <div className="banner banner--bad" style={{ marginBottom: 10 }}>
                    This lineup does not satisfy the contest rules: {row.violations.join('; ')}.
                  </div>
                ) : null}

                {row.lines ? (
                  <>
                    {row.lines.map((line) => {
                      const phase = phaseOfPlayer(phases, line.player);
                      const projected = line.player
                        ? Math.round(
                            line.player.projection.normalized *
                              (line.isCaptain ? contest.captain?.multiplier ?? 1.5 : 1) *
                              10,
                          ) / 10
                        : 0;
                      return (
                      <div className="lb-line" key={line.slot.id}>
                        <span className="faint" style={{ fontWeight: 700 }}>
                          {line.isCaptain ? <span className="cpt-badge">CPT</span> : line.slot.label}
                        </span>
                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {line.player ? (
                            <>
                              <PlayerName
                                name={line.player.name}
                                playerId={line.player.id}
                                onOpenPlayer={onOpenPlayer}
                              />
                              <span className="faint">
                                {' '}
                                {line.player.position} · {line.player.teamAbbr}
                              </span>
                              {line.player.statLine ? (
                                <div className="tiny faint">
                                  {/* Until they play, this is their average, not tonight. */}
                                  {phase === 'pre' ? <span className="stat-tag">avg</span> : null}
                                  {line.player.statLine}
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <span className="faint">empty</span>
                          )}
                        </span>
                        <span className="num faint">{line.player ? formatMoney(line.salary) : ''}</span>
                        <span
                          className={`num lb-pts lb-pts--${phase}`}
                          style={{ fontWeight: 800, minWidth: 54, textAlign: 'right' }}
                        >
                          {phase === 'pre' && line.player ? (
                            <span className="lb-proj" title="Projected — this game has not started">
                              {projected.toFixed(1)}
                            </span>
                          ) : (
                            line.normalizedPoints.toFixed(1)
                          )}
                          {line.player ? (
                            <DeltaBadge
                              value={
                                (pointDeltas?.get(line.player.id) ?? 0) *
                                (line.isCaptain ? contest.captain?.multiplier ?? 1.5 : 1)
                              }
                            />
                          ) : null}
                        </span>
                      </div>
                      );
                    })}

                    {contest.gameWinner.enabled && row.picks ? (
                      <div style={{ marginTop: 10 }}>
                        <div className="eyebrow" style={{ marginBottom: 6 }}>
                          Spread picks · {row.correctPicks}/{row.decidedPicks} correct
                          {row.bonusPoints > 0 ? ` · +${row.bonusPoints.toFixed(1)} pts` : ''}
                          {row.totalPicks > row.decidedPicks
                            ? ` · ${row.totalPicks - row.decidedPicks} to come`
                            : ''}
                        </div>
                        <div className="row row--wrap" style={{ gap: 6 }}>
                          {contest.games.map((game) => {
                            const pick = row.picks?.[game.id];
                            const team = [game.home, game.away].find((t) => t.id === pick);
                            const result = gradePick(game, pick);
                            const final = game.state === 'post';
                            const side = team && team.id === game.home.id ? 'home' : 'away';
                            return (
                              <span
                                key={game.id}
                                className={`pill${final && result === 'covered' ? ' pill--open' : ''}${
                                  final && result === 'missed' ? ' pill--bad' : ''
                                }${final && result === 'push' ? ' pill--warn' : ''}`}
                              >
                                {team?.abbreviation ?? '—'}
                                {team && hasSpread(game) ? ` ${formatLine(spreadFor(game, side))}` : ''}
                                {final && result !== 'pending' ? (
                                  <span className="pick-pts">
                                    {' '}
                                    {result === 'covered' ? `✓ +${bonusPer}` : result === 'push' ? '= push' : '✗'}
                                  </span>
                                ) : (
                                  <span className="pick-pts faint"> · open</span>
                                )}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="tiny muted">
                    This entrant's roster is hidden until the contest locks.
                  </div>
                )}
              </div>
            ) : null}
          </div>
        );
          })}
    </div>
  );
}
