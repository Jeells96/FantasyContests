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

      <div className="card card--tight">
        <KeyValue label="Salary" value={formatMoney(player.salary)} />
        <KeyValue label="Projected (contest points)" value={player.projection.normalized.toFixed(1)} />
        {player.sport !== 'nfl' ? (
          <KeyValue label="Projected (raw sport points)" value={player.projection.raw.toFixed(1)} />
        ) : null}
        <KeyValue label="Live raw points" value={(player.rawPoints ?? 0).toFixed(2)} />
        <KeyValue label="Live contest points" value={(player.normalizedPoints ?? 0).toFixed(2)} />
        {player.sport !== 'nfl' ? (
          <KeyValue label="Normalization factor" value={`×${factor.toFixed(3)}`} />
        ) : null}
        <KeyValue label="Games played (season)" value={player.gamesPlayed ?? 0} />
      </div>

      {liveRows.length > 0 ? (
        <>
          <div className="section-title" style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: 14 }}>Live scoring</h2>
            <span className="tiny faint">raw points</span>
          </div>
          <table className="table-mini">
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
            </tbody>
          </table>
        </>
      ) : null}

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
