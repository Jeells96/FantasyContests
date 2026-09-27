import type { ContestGame } from '../types';
import { formatGameTime } from '../lib/engine/contestState';

/** Game-winner predictions. Locked at the same moment as the lineup. */
export function GamePicks({
  games,
  picks,
  onPick,
  readOnly,
  bonusPoints,
}: {
  games: ContestGame[];
  picks: Record<string, string>;
  onPick?: (gameId: string, teamId: string) => void;
  readOnly?: boolean;
  bonusPoints: number;
}) {
  return (
    <div className="stack">
      <div className="banner">
        Pick a winner in every game. Each correct pick adds{' '}
        <strong className="num">+{bonusPoints.toFixed(1)}</strong> contest points — the same bonus for
        everyone in this contest.
      </div>

      {games.map((game) => {
        const pick = picks[game.id];
        const decided = Boolean(game.winnerTeamId);
        return (
          <div key={game.id} className="card card--tight">
            <div className="row row--between tiny faint" style={{ marginBottom: 8 }}>
              <span>{formatGameTime(game.startTime)}</span>
              <span>{game.state === 'pre' ? game.sport.toUpperCase() : game.statusDetail}</span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              {[game.away, game.home].map((team) => {
                const picked = pick === team.id;
                const won = decided && game.winnerTeamId === team.id;
                const lost = decided && game.winnerTeamId !== team.id;
                return (
                  <button
                    key={team.id}
                    type="button"
                    className="btn btn--sm"
                    style={{
                      flex: 1,
                      justifyContent: 'space-between',
                      borderColor: picked ? 'var(--brand)' : undefined,
                      background: picked ? 'rgba(91,140,255,0.16)' : undefined,
                      opacity: lost && picked ? 0.6 : 1,
                    }}
                    disabled={readOnly || !onPick}
                    onClick={() => onPick?.(game.id, team.id)}
                  >
                    <span className="row" style={{ gap: 6 }}>
                      {team.logo ? (
                        <img src={team.logo} alt="" width={18} height={18} style={{ objectFit: 'contain' }} />
                      ) : null}
                      {team.abbreviation}
                      {team.id === game.home.id ? <span className="tiny faint">home</span> : null}
                    </span>
                    <span className="row" style={{ gap: 5 }}>
                      {game.state !== 'pre' ? <span className="num">{team.score ?? 0}</span> : null}
                      {won ? <span className="pill pill--open">W</span> : null}
                      {picked && !decided ? <span className="tiny">✓</span> : null}
                      {picked && won ? <span className="pill pill--open">+</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
