import type { ContestGame } from '../types';
import { formatGameTime } from '../lib/engine/contestState';
import {
  favoriteText,
  formatLine,
  gradePick,
  hasSpread,
  requirementText,
  spreadFor,
} from '../lib/engine/spread';

/**
 * Picks against the spread, written for people who have never bet on one.
 *
 * Each side shows its line and, underneath, exactly what that team has to do —
 * "Must win by 4+" or "Can lose by up to 3, or win" — so the number never has
 * to be interpreted.
 */
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
  const anySpread = games.some(hasSpread);

  return (
    <div className="stack">
      <div className="banner">
        {anySpread ? (
          <>
            <strong>Pick one team in every game.</strong> The favorite starts with points taken away and the
            underdog starts with points added, which evens the teams out. Each button says exactly what your
            team has to do — you do not need to work the number out.
            <div style={{ marginTop: 6 }}>
              Get it right and you add <strong className="num">+{bonusPoints.toFixed(1)}</strong> points — the
              same bonus for everyone.
            </div>
          </>
        ) : (
          <>
            Pick a winner in every game. Each correct pick adds{' '}
            <strong className="num">+{bonusPoints.toFixed(1)}</strong> contest points — the same bonus for
            everyone in this contest.
          </>
        )}
      </div>

      {games.map((game) => {
        const pick = picks[game.id];
        const withLine = hasSpread(game);
        return (
          <div key={game.id} className="card card--tight">
            <div className="row row--between tiny faint" style={{ marginBottom: 6 }}>
              <span>{formatGameTime(game.startTime)}</span>
              <span>{game.state === 'pre' ? game.sport.toUpperCase() : game.statusDetail}</span>
            </div>

            {withLine ? (
              <div className="tiny muted" style={{ marginBottom: 8 }}>
                {favoriteText(game)}
                {game.spread?.source ? <span className="faint"> · line at contest creation</span> : null}
              </div>
            ) : null}

            <div className="pick-grid">
              {(['away', 'home'] as const).map((side) => {
                const team = side === 'home' ? game.home : game.away;
                const picked = pick === team.id;
                const result = picked ? gradePick(game, team.id) : 'pending';
                const final = game.state === 'post';
                return (
                  <button
                    key={team.id}
                    type="button"
                    className={`pick${picked ? ' pick--picked' : ''}${
                      picked && final && result === 'covered' ? ' pick--won' : ''
                    }${picked && final && result === 'missed' ? ' pick--lost' : ''}`}
                    disabled={readOnly || !onPick}
                    onClick={() => onPick?.(game.id, team.id)}
                  >
                    <span className="pick__head">
                      <span className="row" style={{ gap: 6, minWidth: 0 }}>
                        {team.logo ? (
                          <img src={team.logo} alt="" width={18} height={18} style={{ objectFit: 'contain' }} />
                        ) : null}
                        <strong>{team.abbreviation}</strong>
                        {side === 'home' ? <span className="tiny faint">home</span> : null}
                      </span>
                      <span className="row" style={{ gap: 6 }}>
                        {game.state !== 'pre' ? <span className="num tiny">{team.score ?? 0}</span> : null}
                        {withLine ? <span className="pick__line">{formatLine(spreadFor(game, side))}</span> : null}
                      </span>
                    </span>

                    <span className="pick__need">{requirementText(game, side)}</span>

                    {picked ? (
                      <span className="pick__state">
                        {final
                          ? result === 'covered'
                            ? '✓ Bonus earned'
                            : result === 'push'
                              ? 'Tie — no bonus'
                              : 'No bonus'
                          : game.state === 'in'
                            ? result === 'covered'
                              ? 'Currently ahead of the line'
                              : result === 'push'
                                ? 'Exactly on the line'
                                : 'Currently behind the line'
                            : 'Your pick'}
                      </span>
                    ) : null}
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
