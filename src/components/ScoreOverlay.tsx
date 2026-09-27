import type { ScoringEvent } from '../lib/engine/liveEvents';

/**
 * Broadcast-style scoring animation:
 *
 *   JAREN'S TEAM
 *   TOUCHDOWN!
 *   Patrick Mahomes          +6
 */
export function ScoreOverlay({ events, teamName }: { events: ScoringEvent[]; teamName: string }) {
  const event = events[0];
  if (!event) return null;

  return (
    <div className="score-pop" key={event.id}>
      <div className={`score-pop__card${event.tone === 'big' ? ' score-pop__card--big' : ''}${event.tone === 'bad' ? ' score-pop__card--bad' : ''}`}>
        {event.headshot ? (
          <span className="score-pop__shot">
            <img src={event.headshot} alt="" />
          </span>
        ) : null}
        <span style={{ minWidth: 0 }}>
          <span className="score-pop__team">{teamName}</span>
          <div className={`score-pop__title${event.tone === 'big' ? ' score-pop__title--big' : ''}`}>
            {event.title}
          </div>
          <div className="score-pop__player">
            {event.playerName} · {event.teamAbbr}
          </div>
        </span>
        <span className={`score-pop__points${event.points < 0 ? ' score-pop__points--bad' : ''}`}>
          {event.points > 0 ? '+' : ''}
          {Number.isInteger(event.points) ? event.points : event.points.toFixed(1)}
        </span>
      </div>
    </div>
  );
}
