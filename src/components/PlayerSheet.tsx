import type { Contest, ContestPlayer } from '../types';
import { scoringBreakdown } from '../lib/scoring';
import { normalizationFactor } from '../lib/engine/normalization';
import { statMeta } from '../lib/stats';
import { formatMoney } from '../lib/engine/lineup';
import { KeyValue, Sheet, SportPill } from './ui';

/** Full detail for one player, including how their fantasy points were built. */
export function PlayerSheet({
  player,
  contest,
  onClose,
}: {
  player: ContestPlayer;
  contest: Contest;
  onClose: () => void;
}) {
  const table = contest.scoring[player.sport];
  const factor = normalizationFactor(contest.normalization, player.sport);
  const liveRows = scoringBreakdown(player.liveStats, table);
  const seasonRows = scoringBreakdown(player.seasonStats, table).slice(0, 8);
  const liveRaw = liveRows.reduce((sum, row) => sum + row.points, 0);
  const started = player.started === true;

  return (
    <Sheet
      title={
        <span className="row" style={{ gap: 8 }}>
          {player.name}
          <SportPill sport={player.sport} />
        </span>
      }
      onClose={onClose}
    >
      <div className="row row--wrap" style={{ gap: 6, marginBottom: 12 }}>
        <span className="pill">{player.position}</span>
        <span className="pill">
          {player.teamAbbr} {player.isHome ? 'vs' : '@'} {player.opponentAbbr}
        </span>
        {player.jersey ? <span className="pill">#{player.jersey}</span> : null}
        {player.injuryStatus ? <span className="pill pill--warn">{player.injuryStatus}</span> : null}
      </div>

      {/* How the points on the leaderboard were actually earned. */}
      <div className="card card--tight">
        <div className="row row--between" style={{ alignItems: 'baseline' }}>
          <span className="eyebrow">Points so far</span>
          <span className="num" style={{ fontSize: 26, fontWeight: 900 }}>
            {(player.normalizedPoints ?? 0).toFixed(1)}
          </span>
        </div>
        {liveRows.length > 0 ? (
          <table className="table-mini" style={{ marginTop: 8 }}>
            <tbody>
              {liveRows.map((row) => (
                <tr key={row.key}>
                  <td>{statMeta(player.sport, row.key).label}</td>
                  <td className="num">{row.value}</td>
                  <td className="num" style={{ color: row.points >= 0 ? 'var(--accent)' : 'var(--bad)' }}>
                    {row.points > 0 ? '+' : ''}
                    {row.points}
                  </td>
                </tr>
              ))}
              <tr className="table-mini__total">
                <td>{player.sport === 'nfl' ? 'Total' : 'Raw total'}</td>
                <td />
                <td className="num">{round1(liveRaw)}</td>
              </tr>
              {player.sport !== 'nfl' ? (
                <tr className="table-mini__total">
                  <td>Contest points (×{factor.toFixed(3)})</td>
                  <td />
                  <td className="num">{(player.normalizedPoints ?? 0).toFixed(1)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        ) : (
          <p className="tiny faint" style={{ margin: '8px 0 0' }}>
            {started ? 'Nothing on the stat sheet yet.' : 'This game has not started.'}
          </p>
        )}
      </div>

      <div className="card card--tight">
        <KeyValue label="Salary" value={formatMoney(player.salary)} />
        <KeyValue label="Projected (contest points)" value={player.projection.normalized.toFixed(1)} />
        {player.sport !== 'nfl' ? (
          <KeyValue label="Projected (raw sport points)" value={player.projection.raw.toFixed(1)} />
        ) : null}
        <KeyValue label="Games played (season)" value={player.gamesPlayed ?? 0} />
      </div>

      {seasonRows.length > 0 ? (
        <>
          <div className="section-title" style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: 14 }}>Season per game</h2>
          </div>
          <table className="table-mini">
            <tbody>
              {seasonRows.map((row) => (
                <tr key={row.key}>
                  <td>{statMeta(player.sport, row.key).label}</td>
                  <td className="num">{row.value}</td>
                  <td className="num faint">{row.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {player.recentStats ? (
        <p className="tiny faint" style={{ marginBottom: 0 }}>
          Salary blends season production with recent form and the game context.
        </p>
      ) : null}
    </Sheet>
  );
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
