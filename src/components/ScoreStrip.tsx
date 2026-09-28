import { useEffect, useMemo, useRef, useState } from 'react';
import type { ContestGame, ContestTeam } from '../types';
import { formatGameTime } from '../lib/engine/contestState';

/** How long a score change stays highlighted. */
const FLASH_MS = 2200;
/** Pixels per second the ticker drifts when the strip overflows. */
const DRIFT_PX_PER_SEC = 16;
/** How long a touch or scroll pauses the drift. */
const RESUME_MS = 5000;
/** A beat at each end before the ticker turns around. */
const EDGE_HOLD_MS = 1200;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** True for a moment after `value` changes, so a score can flash. */
function useFlash(value: number | undefined): boolean {
  const previous = useRef(value);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const before = previous.current;
    previous.current = value;
    if (before === undefined || value === undefined || value === before) return;
    setOn(true);
    const timer = window.setTimeout(() => setOn(false), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [value]);
  return on;
}

function TeamRow({ team, leading }: { team: ContestTeam; leading: boolean }) {
  const flash = useFlash(team.score);
  return (
    <div className={`ss-row${leading ? ' ss-row--lead' : ''}`}>
      {team.logo ? <img className="ss-logo" src={team.logo} alt="" loading="lazy" /> : <span className="ss-logo ss-logo--blank" />}
      <span className="ss-abbr">{team.abbreviation}</span>
      <span className={`ss-score${flash ? ' ss-score--flash' : ''}`}>{team.score ?? 0}</span>
    </div>
  );
}

function ScoreCard({ game }: { game: ContestGame }) {
  const live = game.state === 'in';
  const final = game.state === 'post';
  const homeScore = game.home.score ?? 0;
  const awayScore = game.away.score ?? 0;
  const clock = game.situation?.clock?.trim();
  const detail = game.situation?.detail?.trim();

  // Pre-game shows kickoff, live shows the game clock, final shows the result.
  const statusLine = live
    ? clock || game.statusDetail || 'In progress'
    : final
      ? game.statusDetail || 'Final'
      : formatGameTime(game.startTime) || game.statusDetail || '';

  return (
    <div className={`ss-card${live ? ' ss-card--live' : ''}`} aria-label={`${game.shortName} ${statusLine}`}>
      <div className="ss-head">
        <span className="ss-league">{game.sport.toUpperCase()}</span>
        {live ? <span className="ss-dot" aria-hidden="true" /> : null}
        <span className="ss-status">{statusLine}</span>
      </div>
      <TeamRow team={game.away} leading={final && awayScore > homeScore} />
      <TeamRow team={game.home} leading={final && homeScore > awayScore} />
      {live && detail ? <div className="ss-detail">{detail}</div> : null}
    </div>
  );
}

export function ScoreStrip({ games, lastSyncAt }: { games: ContestGame[]; lastSyncAt?: string }) {
  const track = useRef<HTMLDivElement | null>(null);
  const [tick, setTick] = useState(() => Date.now());
  const pausedUntil = useRef(0);

  const liveCount = games.filter((game) => game.state === 'in').length;
  const anyLive = liveCount > 0;

  // A once-a-second heartbeat so "updated Ns ago" keeps counting between syncs.
  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Slow drift when the cards overflow, so the board reads as a live ticker.
  useEffect(() => {
    const node = track.current;
    if (!node || !anyLive || prefersReducedMotion()) return;
    let frame = 0;
    let last = performance.now();
    // The offset is kept here rather than read back from the element, because
    // scrollLeft reads back rounded to whole pixels and a sub-pixel step per
    // frame would never accumulate.
    let offset = node.scrollLeft;
    let direction = 1;
    const step = (now: number) => {
      const elapsed = now - last;
      last = now;
      frame = requestAnimationFrame(step);
      if (now < pausedUntil.current) return;
      const span = node.scrollWidth - node.clientWidth;
      if (span <= 4) return;
      offset += direction * (DRIFT_PX_PER_SEC * elapsed) / 1000;
      // Turn around at each end rather than snapping back to the start.
      if (offset >= span) {
        offset = span;
        direction = -1;
        pausedUntil.current = now + EDGE_HOLD_MS;
      } else if (offset <= 0) {
        offset = 0;
        direction = 1;
        pausedUntil.current = now + EDGE_HOLD_MS;
      }
      node.scrollLeft = offset;
    };
    frame = requestAnimationFrame(step);
    const hold = () => {
      pausedUntil.current = performance.now() + RESUME_MS;
      // Pick up wherever the reader left the strip.
      offset = node.scrollLeft;
      direction = 1;
    };
    node.addEventListener('pointerdown', hold);
    node.addEventListener('wheel', hold, { passive: true });
    node.addEventListener('touchstart', hold, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      node.removeEventListener('pointerdown', hold);
      node.removeEventListener('wheel', hold);
      node.removeEventListener('touchstart', hold);
    };
  }, [anyLive, games.length]);

  const since = useMemo(() => {
    if (!lastSyncAt) return '';
    const ms = tick - new Date(lastSyncAt).getTime();
    if (!Number.isFinite(ms) || ms < 0) return 'just now';
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ago`;
  }, [lastSyncAt, tick]);

  if (games.length === 0) return null;

  return (
    <section className="scorestrip" aria-label="Game scoreboard">
      <div className="ss-bar">
        <span className={`ss-flag${anyLive ? ' ss-flag--live' : ''}`}>
          {anyLive ? <span className="ss-dot" aria-hidden="true" /> : null}
          {anyLive ? `Live · ${liveCount} game${liveCount === 1 ? '' : 's'}` : 'Scoreboard'}
        </span>
        {since ? <span className="ss-since">updated {since}</span> : null}
      </div>
      <div className="ss-track" ref={track}>
        {games.map((game) => (
          <ScoreCard key={`${game.sport}-${game.id}`} game={game} />
        ))}
      </div>
    </section>
  );
}
