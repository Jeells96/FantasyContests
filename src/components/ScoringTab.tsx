import { useMemo, useState } from 'react';
import type { Contest, ContestPlayer, Entry } from '../types';
import { captainEnabled, captainMultiplier } from '../lib/engine/captain';
import { bestPossibleLineup } from '../lib/engine/optimal';
import { formatMoney } from '../lib/engine/lineup';
import { DeltaBadge, Empty, Initials, shortPersonName } from './ui';

/**
 * The scoring tab: who is putting up points, who has them, and the best score
 * the pool allows.
 */
export function ScoringTab({
  contest,
  players,
  entries,
  pointDeltas,
  locked,
  selfUid,
}: {
  contest: Contest;
  players: ContestPlayer[];
  entries: Entry[];
  pointDeltas: Map<string, number>;
  locked: boolean;
  selfUid: string | null;
}) {
  const [showBest, setShowBest] = useState(false);
  const [showAllFeed, setShowAllFeed] = useState(false);
  const final = contest.status === 'complete';
  const multiplier = captainMultiplier(contest);

  /** playerId -> the teams rostering them. Only knowable once rosters unlock. */
  const owners = useMemo(() => {
    const map = new Map<string, { label: string; isSelf: boolean; isCaptain: boolean }[]>();
    if (!locked) return map;
    for (const entry of entries) {
      // Short enough to sit under a feed row: "Savannah T."
      const label = shortPersonName(entry.displayName);
      for (const line of entry.lineup) {
        const list = map.get(line.playerId) ?? [];
        list.push({ label, isSelf: entry.uid === selfUid, isCaptain: Boolean(line.captain) });
        map.set(line.playerId, list);
      }
    }
    return map;
  }, [entries, locked, selfUid]);

  // Computed on demand: it is a knapsack over the whole pool.
  const best = useMemo(
    () =>
      showBest
        ? bestPossibleLineup(players, contest.rosterSlots, contest.salaryCapInfo.cap, {
            enabled: captainEnabled(contest),
            multiplier,
          })
        : null,
    [showBest, players, contest, multiplier],
  );

  const scorers = useMemo(
    () => [...players].sort((a, b) => (b.normalizedPoints ?? 0) - (a.normalizedPoints ?? 0)),
    [players],
  );

  const log = contest.scoringLog ?? [];

  return (
    <div className="stack">
      <div className="card card--tight">
        <div className="row row--between" style={{ gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow">{final ? 'Perfect lineup' : 'Best possible right now'}</div>
            <div className="tiny muted">
              {final
                ? 'The highest score anyone could have made from this pool.'
                : 'The highest score available from this pool at this moment, under the same cap.'}
            </div>
          </div>
          <button type="button" className="btn btn--sm" onClick={() => setShowBest((value) => !value)}>
            {showBest ? 'Hide' : 'Show'}
          </button>
        </div>

        {showBest ? (
          best ? (
            <div style={{ marginTop: 12 }}>
              <div className="row row--between" style={{ marginBottom: 8 }}>
                <span className="num" style={{ fontSize: 22, fontWeight: 900 }}>
                  {best.totalPoints.toFixed(1)}
                </span>
                <span className="tiny faint num">
                  {formatMoney(best.totalSalary)} of {formatMoney(contest.salaryCapInfo.cap)}
                </span>
              </div>
              <div className="list">
                {best.picks.map((pick) => (
                  <div className="lb-line" key={pick.player.id}>
                    <span className="faint" style={{ fontWeight: 700 }}>
                      {pick.isCaptain ? <span className="cpt-badge">CPT</span> : '—'}
                    </span>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {pick.player.name}
                      <span className="faint">
                        {' '}
                        {pick.player.position} · {pick.player.teamAbbr}
                      </span>
                    </span>
                    <span className="num faint">{formatMoney(pick.salary)}</span>
                    <span className="num" style={{ fontWeight: 800, minWidth: 48, textAlign: 'right' }}>
                      {pick.points.toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>
              {!best.exact ? (
                <p className="tiny faint" style={{ marginBottom: 0 }}>
                  Close to the best this position-locked roster allows, not guaranteed to be the exact maximum.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="tiny faint" style={{ marginTop: 10, marginBottom: 0 }}>
              No complete lineup fits the cap from this pool yet.
            </p>
          )
        ) : null}
      </div>

      <div className="card card--tight">
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          Scoring feed
        </div>
        {log.length === 0 ? (
          <p className="tiny faint" style={{ margin: 0 }}>
            Nothing yet. Every time a player gains or loses points it shows up here, newest first.
          </p>
        ) : (
          <>
            <div className="list">
              {(showAllFeed ? log : log.slice(0, FEED_PREVIEW)).map((event) => (
                <div className={`feed feed--compact${event.delta < 0 ? ' feed--down' : ''}`} key={event.id}>
                  <span className="feed__shot">
                    {event.headshot ? (
                      <img src={event.headshot} alt="" loading="lazy" />
                    ) : (
                      <Initials name={event.playerName} />
                    )}
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="feed__name">
                      {event.playerName}
                      <span className="faint"> · {event.teamAbbr}</span>
                    </span>
                    {event.situation || event.clock || event.scoreLine ? (
                      <span className="board">
                        {event.situation ? <span className="board__cell">{event.situation}</span> : null}
                        {event.clock ? <span className="board__cell">{event.clock}</span> : null}
                        {event.scoreLine ? (
                          <span className="board__cell board__cell--score">{event.scoreLine}</span>
                        ) : null}
                      </span>
                    ) : null}
                    <OwnerTags owners={owners.get(event.playerId)} locked={locked} />
                  </span>
                  <span className="feed__delta">
                    <DeltaBadge value={event.delta} className="delta-pop--static" />
                    <span className="tiny faint num">{event.total.toFixed(1)}</span>
                  </span>
                </div>
              ))}
            </div>
            {log.length > FEED_PREVIEW ? (
              <button
                type="button"
                className="btn btn--sm btn--ghost btn--block"
                style={{ marginTop: 8 }}
                onClick={() => setShowAllFeed((value) => !value)}
              >
                {showAllFeed ? 'Show less' : `Show all ${log.length}`}
              </button>
            ) : null}
          </>
        )}
      </div>

      <div className="card card--tight">
        <div className="row row--between" style={{ marginBottom: 8 }}>
          <div className="eyebrow">Players by points</div>
          <span className="tiny faint">{scorers.filter((p) => (p.normalizedPoints ?? 0) > 0).length} scoring</span>
        </div>
        {scorers.length === 0 ? (
          <Empty title="No players yet" />
        ) : (
          <div className="list">
            {scorers.slice(0, 60).map((player) => {
              const delta = pointDeltas.get(player.id) ?? 0;
              return (
                <div
                  className={`feed${delta > 0 ? ' feed--scored' : ''}${delta < 0 ? ' feed--down' : ''}`}
                  key={player.id}
                >
                  <span className="feed__shot">
                    {player.headshot ? (
                      <img src={player.headshot} alt="" loading="lazy" />
                    ) : (
                      <Initials name={player.name} />
                    )}
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="feed__name">
                      {player.name}
                      <span className="faint">
                        {' '}
                        · {player.position} · {player.teamAbbr}
                      </span>
                    </span>
                    {player.statLine ? <span className="feed__stats">{player.statLine}</span> : null}
                    <OwnerTags owners={owners.get(player.id)} locked={locked} />
                  </span>
                  <span className="feed__delta">
                    <span className="num" style={{ fontWeight: 800 }}>
                      {(player.normalizedPoints ?? 0).toFixed(1)}
                      <DeltaBadge value={delta} />
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** How many feed rows show before the list is expanded. */
const FEED_PREVIEW = 5;

/** Who has this player, once rosters are public. */
function OwnerTags({
  owners,
  locked,
}: {
  owners?: { label: string; isSelf: boolean; isCaptain: boolean }[];
  locked: boolean;
}) {
  if (!locked || !owners || owners.length === 0) return null;
  return (
    <span className="feed__owners">
      {owners.map((owner, index) => (
        <span key={`${owner.label}-${index}`} className={`owner-tag${owner.isSelf ? ' owner-tag--self' : ''}`}>
          {owner.isCaptain ? <span className="owner-tag__cpt">C</span> : null}
          {owner.label}
        </span>
      ))}
    </span>
  );
}
