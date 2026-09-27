import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Banner, Empty, KeyValue, Sheet, Spinner, SportPill, Toggle } from '../components/ui';
import { createContest, getContest, getPool, updateContest } from '../lib/db';
import { buildPlayerPool, listGamesRange, type ProviderGame } from '../lib/providers';
import { earliestStart, formatGameTime, latestStart } from '../lib/engine/contestState';
import { formatMoney } from '../lib/engine/lineup';
import { gameWinnerBonusPoints, priceContest, type PricingResult } from '../lib/engine/pricing';
import {
  POSITIONAL_PRESETS,
  buildDefaultRoster,
  isOpenRoster,
  normalizeSlotIds,
  openRoster,
} from '../lib/engine/roster';
import { cloneScoring, DEFAULT_SCORING, defaultScoringFor } from '../lib/scoring';
import { STATS_BY_SPORT, statMeta } from '../lib/stats';
import { useSession } from '../state/SessionContext';
import {
  SPORTS,
  SPORT_LABELS,
  type Contest,
  type ContestPlayer,
  type ContestScoring,
  type RosterSlot,
  type Sport,
} from '../types';
import type { PoolPlayer } from '../lib/providers/types';

/** A stored player carries everything needed to re-price without refetching. */
function toPoolPlayer(player: ContestPlayer): PoolPlayer {
  return {
    id: player.id,
    sport: player.sport,
    name: player.name,
    shortName: player.shortName,
    positions: player.positions,
    position: player.position,
    teamId: player.teamId,
    teamAbbr: player.teamAbbr,
    opponentAbbr: player.opponentAbbr,
    isHome: player.isHome,
    gameId: player.gameId,
    headshot: player.headshot,
    jersey: player.jersey,
    injuryStatus: player.injuryStatus,
    isTeamUnit: player.isTeamUnit,
    seasonStats: player.seasonStats ?? {},
    gamesPlayed: player.gamesPlayed ?? 0,
    recentStats: player.recentStats,
    contextMultiplier: player.contextMultiplier ?? 1,
  };
}

const todayISO = () => new Date().toISOString().slice(0, 10);

export function AdminContestPage() {
  const { contestId } = useParams<{ contestId: string }>();
  const { isAdmin } = useSession();
  const navigate = useNavigate();
  const editing = Boolean(contestId);

  const [step, setStep] = useState(editing ? 3 : 1);
  const [sports, setSports] = useState<Sport[]>(['nfl']);
  const [date, setDate] = useState(todayISO());
  const [days, setDays] = useState(3);
  const [available, setAvailable] = useState<ProviderGame[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pool, setPool] = useState<PoolPlayer[]>([]);
  const [rosterSlots, setRosterSlots] = useState<RosterSlot[]>(buildDefaultRoster(['nfl']));
  const [scoring, setScoring] = useState<ContestScoring>(defaultScoringFor(['nfl']));
  const [gameWinnerEnabled, setGameWinnerEnabled] = useState(true);
  const [bonusPercent, setBonusPercent] = useState(5);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [loadingGames, setLoadingGames] = useState(false);
  const [buildingPool, setBuildingPool] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(!editing);
  const [existing, setExisting] = useState<Contest | null>(null);

  const selectedGames = useMemo(
    () => available.filter((game) => selectedIds.includes(game.id)),
    [available, selectedIds],
  );

  /* ------------------------------------------------------------ edit mode ---- */
  useEffect(() => {
    if (!contestId) return;
    let cancelled = false;
    (async () => {
      try {
        const [contest, players] = await Promise.all([getContest(contestId), getPool(contestId)]);
        if (cancelled || !contest) return;
        setExisting(contest);
        setSports(contest.sports);
        setAvailable(contest.games);
        setSelectedIds(contest.games.map((game) => game.id));
        setPool(players.map(toPoolPlayer));
        setRosterSlots(contest.rosterSlots);
        setScoring(contest.scoring);
        setGameWinnerEnabled(contest.gameWinner.enabled);
        setBonusPercent(contest.gameWinner.bonusPercent);
        setName(contest.name);
        setNotes(contest.notes ?? '');
        setDate(contest.lockTime.slice(0, 10));
        setLoaded(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load contest');
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contestId]);

  /* -------------------------------------------------------------- schedule ---- */
  const loadGames = useCallback(async () => {
    if (sports.length === 0) return;
    setLoadingGames(true);
    setError(null);
    try {
      const start = new Date(`${date}T00:00:00`);
      const batches = await Promise.all(sports.map((sport) => listGamesRange(sport, start, days)));
      const games = batches.flat().sort((a, b) => a.startTime.localeCompare(b.startTime));
      setAvailable(games);
      setSelectedIds((current) => current.filter((id) => games.some((game) => game.id === id)));
    } catch (e) {
      setError(e instanceof Error ? `Could not load games: ${e.message}` : 'Could not load games');
    } finally {
      setLoadingGames(false);
    }
  }, [sports, date, days]);

  useEffect(() => {
    if (editing) return;
    void loadGames();
  }, [editing, loadGames]);

  /* ------------------------------------------------------------ player pool --- */
  async function buildPool() {
    if (selectedGames.length === 0) return;
    setBuildingPool(true);
    setError(null);
    setProgress('Starting…');
    try {
      const players = await buildPlayerPool(selectedGames, {
        onProgress: setProgress,
        recentFormLimit: 70,
      });
      if (players.length === 0) {
        setError('No players came back for those games. Try different games.');
        return;
      }
      setPool(players);
      const sportsInPool = Array.from(new Set(players.map((p) => p.sport)));
      setRosterSlots(buildDefaultRoster(sportsInPool));
      setScoring(defaultScoringFor(sportsInPool));
      if (!name) {
        setName(defaultContestName(selectedGames));
      }
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? `Could not build the player pool: ${e.message}` : 'Pool build failed');
    } finally {
      setBuildingPool(false);
      setProgress('');
    }
  }

  /* ---------------------------------------------------------------- pricing --- */
  const pricing: PricingResult | null = useMemo(() => {
    if (pool.length === 0 || rosterSlots.length === 0) return null;
    try {
      return priceContest(pool, rosterSlots, scoring, selectedGames);
    } catch {
      return null;
    }
  }, [pool, rosterSlots, scoring, selectedGames]);

  const bonusPoints = pricing ? gameWinnerBonusPoints(pricing.scoringBaseline, bonusPercent) : 0;

  async function publish() {
    if (!pricing || selectedGames.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const games = selectedGames;
      const payload = {
        name: name.trim() || defaultContestName(games),
        sports: Array.from(new Set(games.map((game) => game.sport))),
        games,
        rosterSlots: normalizeSlotIds(rosterSlots),
        scoring,
        normalization: pricing.normalization,
        salaryCapInfo: pricing.salaryCapInfo,
        scoringBaseline: pricing.scoringBaseline,
        gameWinner: {
          enabled: gameWinnerEnabled,
          bonusPercent,
          bonusPoints,
        },
        lockTime: earliestStart(games),
        lastGameStart: latestStart(games),
        status: 'open' as const,
        finalizedAt: null,
        playerCount: pricing.players.length,
        notes: notes.trim(),
      };

      if (editing && contestId && existing) {
        await updateContest(contestId, { ...existing, ...payload, id: contestId }, pricing.players);
        navigate('/admin');
      } else {
        const id = await createContest({ ...payload, players: pricing.players });
        navigate(`/contest/${id}`);
      }
    } catch (e) {
      setError(
        e instanceof Error && /permission/i.test(e.message)
          ? 'Firestore rejected the write. Is the admin account signed in and are the rules deployed?'
          : e instanceof Error
            ? e.message
            : 'Save failed',
      );
    } finally {
      setSaving(false);
    }
  }

  if (!isAdmin) {
    return (
      <main className="page">
        <Empty title="Admin only" hint="Unlock the admin area with the PIN first." />
      </main>
    );
  }
  if (!loaded) {
    return (
      <main className="page">
        <Spinner label="Loading contest…" />
      </main>
    );
  }

  return (
    <main className="page page--wide">
      <div className="stack stack--lg">
        <div>
          <div className="eyebrow">Admin</div>
          <h1 style={{ fontSize: 22, fontWeight: 900 }}>{editing ? 'Edit contest' : 'Create contest'}</h1>
          <p className="tiny muted" style={{ margin: '6px 0 0' }}>
            Choose games and rules. Player pools, salaries, the salary cap and cross-sport normalization are
            calculated for you.
          </p>
        </div>

        <div className="tabs">
          {['1 · Games', '2 · Player pool', '3 · Rules', '4 · Publish'].map((label, index) => (
            <button
              key={label}
              type="button"
              className={`tab${step === index + 1 ? ' tab--active' : ''}`}
              onClick={() => setStep(index + 1)}
              disabled={index + 1 > 1 && pool.length === 0 && index + 1 !== 2}
            >
              {label}
            </button>
          ))}
        </div>

        {error ? <Banner tone="bad">{error}</Banner> : null}

        {step === 1 ? (
          <div className="stack">
            <div className="card">
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                Sports
              </div>
              <div className="row row--wrap" style={{ gap: 8 }}>
                {SPORTS.map((sport) => (
                  <button
                    key={sport}
                    type="button"
                    className={`btn btn--sm${sports.includes(sport) ? ' btn--primary' : ''}`}
                    onClick={() =>
                      setSports((current) =>
                        current.includes(sport) ? current.filter((s) => s !== sport) : [...current, sport],
                      )
                    }
                  >
                    {SPORT_LABELS[sport]}
                  </button>
                ))}
              </div>

              <div className="grid grid--2" style={{ marginTop: 12 }}>
                <div className="field">
                  <label htmlFor="date">From date</label>
                  <input
                    id="date"
                    type="date"
                    className="input"
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="days">Days ahead</label>
                  <select
                    id="days"
                    className="select"
                    value={days}
                    onChange={(event) => setDays(Number(event.target.value))}
                  >
                    {[1, 2, 3, 5, 7].map((value) => (
                      <option key={value} value={value}>
                        {value} day{value > 1 ? 's' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <button
                type="button"
                className="btn btn--sm btn--block"
                style={{ marginTop: 10 }}
                onClick={() => void loadGames()}
                disabled={loadingGames || sports.length === 0}
              >
                {loadingGames ? <span className="spinner" /> : 'Reload games'}
              </button>
            </div>

            <div className="card">
              <div className="row row--between" style={{ marginBottom: 8 }}>
                <div className="eyebrow">Games · {selectedIds.length} selected</div>
                {selectedIds.length > 0 ? (
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => setSelectedIds([])}>
                    Clear
                  </button>
                ) : null}
              </div>

              {loadingGames ? <Spinner label="Loading schedule…" /> : null}
              {!loadingGames && available.length === 0 ? (
                <Empty title="No games found" hint="Try another date or sport." />
              ) : null}

              <div className="list">
                {available.map((game) => {
                  const checked = selectedIds.includes(game.id);
                  return (
                    <button
                      key={game.id}
                      type="button"
                      className={`player${checked ? ' player--selected' : ''}`}
                      onClick={() =>
                        setSelectedIds((current) =>
                          current.includes(game.id) ? current.filter((id) => id !== game.id) : [...current, game.id],
                        )
                      }
                    >
                      <span className="player__body">
                        <span className="player__name">{game.shortName}</span>
                        <span className="player__meta">
                          {formatGameTime(game.startTime)} ·{' '}
                          {game.state === 'pre' ? 'scheduled' : game.statusDetail || game.state}
                        </span>
                      </span>
                      <span className="player__right">
                        <SportPill sport={game.sport} />
                        {game.state !== 'pre' ? <span className="tiny pill pill--warn">started</span> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              className="btn btn--primary btn--block"
              disabled={selectedIds.length === 0}
              onClick={() => setStep(2)}
            >
              Continue with {selectedIds.length} game{selectedIds.length === 1 ? '' : 's'}
            </button>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="stack">
            <div className="card">
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                Automatic player pool
              </div>
              <p className="tiny muted" style={{ marginTop: 0 }}>
                Pulls every player in the selected games with their team, position, opponent, headshot, season
                production and recent form, then prices them against each other.
              </p>
              <div className="row row--wrap" style={{ gap: 6, marginBottom: 12 }}>
                {selectedGames.map((game) => (
                  <span className="pill" key={game.id}>
                    {game.shortName}
                  </span>
                ))}
              </div>
              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={() => void buildPool()}
                disabled={buildingPool || selectedGames.length === 0}
              >
                {buildingPool ? <span className="spinner" /> : pool.length > 0 ? 'Rebuild player pool' : 'Build player pool'}
              </button>
              {buildingPool ? (
                <p className="tiny faint" style={{ marginBottom: 0, marginTop: 10 }}>
                  {progress}
                </p>
              ) : null}
            </div>

            {pool.length > 0 ? (
              <div className="card">
                <KeyValue label="Players in pool" value={pool.length} />
                {Array.from(new Set(pool.map((p) => p.sport))).map((sport) => (
                  <KeyValue
                    key={sport}
                    label={`${SPORT_LABELS[sport]} players`}
                    value={pool.filter((p) => p.sport === sport).length}
                  />
                ))}
                <KeyValue
                  label="With recent form"
                  value={pool.filter((p) => p.recentStats).length}
                />
                <button type="button" className="btn btn--block" style={{ marginTop: 10 }} onClick={() => setStep(3)}>
                  Continue to rules
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="stack">
            {pool.length === 0 ? (
              <Empty title="No player pool yet" hint="Build the pool in step 2 first." />
            ) : null}

            <RosterEditor slots={rosterSlots} sports={sports} onChange={setRosterSlots} />

            <ScoringEditor scoring={scoring} onChange={setScoring} />

            <div className="card">
              <div className="section-title">
                <h2 style={{ fontSize: 15 }}>Game-winner picks</h2>
              </div>
              <Toggle
                checked={gameWinnerEnabled}
                onChange={setGameWinnerEnabled}
                label="Require a winner pick for every game"
              />
              {gameWinnerEnabled ? (
                <div className="field" style={{ marginTop: 12 }}>
                  <label htmlFor="bonus">Bonus per correct pick (% of contest baseline)</label>
                  <input
                    id="bonus"
                    type="number"
                    className="input input--num"
                    min={0}
                    max={100}
                    step={0.5}
                    value={bonusPercent}
                    onChange={(event) => setBonusPercent(Number(event.target.value))}
                  />
                  <p className="tiny faint" style={{ margin: '6px 0 0' }}>
                    Baseline {pricing?.scoringBaseline.toFixed(1) ?? '—'} contest points ⇒ every correct pick is
                    worth <strong>+{bonusPoints.toFixed(1)}</strong> for every entrant.
                  </p>
                </div>
              ) : null}
            </div>

            {pricing ? <PricingSummary pricing={pricing} /> : null}

            <button type="button" className="btn btn--primary btn--block" onClick={() => setStep(4)} disabled={!pricing}>
              Continue to publish
            </button>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="stack">
            <div className="card">
              <div className="field">
                <label htmlFor="name">Contest name</label>
                <input
                  id="name"
                  className="input"
                  value={name}
                  maxLength={80}
                  placeholder={defaultContestName(selectedGames)}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="field" style={{ marginTop: 12 }}>
                <label htmlFor="notes">Notes (optional)</label>
                <input
                  id="notes"
                  className="input"
                  value={notes}
                  maxLength={140}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </div>
            </div>

            {pricing ? (
              <>
                <PricingSummary pricing={pricing} />
                <div className="card">
                  <KeyValue label="Games" value={selectedGames.length} />
                  <KeyValue label="Roster spots" value={rosterSlots.length} />
                  <KeyValue label="Locks" value={formatGameTime(earliestStart(selectedGames))} />
                  <KeyValue
                    label="Game-winner bonus"
                    value={gameWinnerEnabled ? `${bonusPercent}% (+${bonusPoints.toFixed(1)})` : 'Disabled'}
                  />
                </div>
              </>
            ) : null}

            <button
              type="button"
              className="btn btn--go btn--block"
              disabled={!pricing || saving}
              onClick={() => void publish()}
            >
              {saving ? <span className="spinner" /> : editing ? 'Save changes' : 'Publish contest'}
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function defaultContestName(games: ProviderGame[]): string {
  if (games.length === 0) return 'New contest';
  const sports = Array.from(new Set(games.map((game) => game.sport))).map((s) => SPORT_LABELS[s]);
  const date = new Date(earliestStart(games)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${sports.join(' + ')} ${games.length}-game slate · ${date}`;
}

function PricingSummary({ pricing }: { pricing: PricingResult }) {
  const [showPlayers, setShowPlayers] = useState(false);
  const top = useMemo(
    () => [...pricing.players].sort((a, b) => b.salary - a.salary).slice(0, 40),
    [pricing.players],
  );
  const sportsInPool = Array.from(new Set(pricing.players.map((p) => p.sport)));

  return (
    <div className="card">
      <div className="section-title">
        <h2 style={{ fontSize: 15 }}>Calculated pricing</h2>
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => setShowPlayers(true)}>
          Inspect salaries
        </button>
      </div>
      <KeyValue label="Salary cap" value={formatMoney(pricing.salaryCapInfo.cap)} />
      <KeyValue label="Cheapest lineup" value={formatMoney(pricing.salaryCapInfo.minLineupCost)} />
      <KeyValue label="Median lineup" value={formatMoney(pricing.salaryCapInfo.medianLineupCost)} />
      <KeyValue label="All-stars lineup" value={formatMoney(pricing.salaryCapInfo.maxLineupCost)} />
      <KeyValue label="Contest scoring baseline" value={pricing.scoringBaseline.toFixed(1)} />
      {sportsInPool.map((sport) => (
        <KeyValue
          key={sport}
          label={`${SPORT_LABELS[sport]} normalization`}
          value={`×${(pricing.normalization.factors[sport] ?? 1).toFixed(3)} (anchor ${(pricing.normalization.anchors[sport] ?? 0).toFixed(1)})`}
        />
      ))}

      {showPlayers ? (
        <Sheet title="Top salaries" onClose={() => setShowPlayers(false)}>
          <table className="table-mini">
            <thead>
              <tr>
                <th>Player</th>
                <th>Pos</th>
                <th className="num">Proj</th>
                <th className="num">Salary</th>
              </tr>
            </thead>
            <tbody>
              {top.map((player) => (
                <tr key={player.id}>
                  <td>
                    {player.name}
                    <div className="tiny faint">
                      {player.teamAbbr} {player.isHome ? 'vs' : '@'} {player.opponentAbbr}
                    </div>
                  </td>
                  <td>{player.position}</td>
                  <td className="num">{player.projection.normalized.toFixed(1)}</td>
                  <td className="num">{formatMoney(player.salary)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Sheet>
      ) : null}
    </div>
  );
}

function RosterEditor({
  slots,
  sports,
  onChange,
}: {
  slots: RosterSlot[];
  sports: Sport[];
  onChange: (slots: RosterSlot[]) => void;
}) {
  function update(index: number, patch: Partial<RosterSlot>) {
    onChange(slots.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)));
  }

  return (
    <div className="card">
      <div className="section-title">
        <h2 style={{ fontSize: 15 }}>Roster format</h2>
        <span className="tiny faint">{slots.length} spots</span>
      </div>

      <p className="tiny muted" style={{ marginTop: 0 }}>
        Spots are interchangeable by default — any player from the pool fits any spot, which keeps multi-sport
        contests simple. Entrants may leave spots empty if they run out of salary. Type positions into a spot to
        restrict it.
      </p>

      <div className="scroll-x" style={{ marginBottom: 10 }}>
        {[6, 8, 9, 11].map((count) => (
          <button
            key={count}
            type="button"
            className={`btn btn--sm${slots.length === count && isOpenRoster(slots) ? ' btn--primary' : ''}`}
            style={{ flex: 'none' }}
            onClick={() => onChange(openRoster(count))}
          >
            {count} spots
          </button>
        ))}
        {sports.length > 1 ? (
          <button
            type="button"
            className="btn btn--sm"
            style={{ flex: 'none' }}
            onClick={() => onChange(buildDefaultRoster(sports))}
          >
            Multi-sport default
          </button>
        ) : null}
      </div>

      <div className="scroll-x" style={{ marginBottom: 10 }}>
        {sports.map((sport) => (
          <button
            key={sport}
            type="button"
            className="btn btn--sm btn--ghost"
            style={{ flex: 'none' }}
            onClick={() => onChange(POSITIONAL_PRESETS[sport].map((slot) => ({ ...slot })))}
          >
            {SPORT_LABELS[sport]} positional preset
          </button>
        ))}
      </div>

      <div className="list">
        {slots.map((slot, index) => (
          <div className="card card--tight" key={`${slot.id}-${index}`}>
            <div className="row" style={{ gap: 8 }}>
              <input
                className="input"
                style={{ maxWidth: 96 }}
                value={slot.label}
                aria-label="Slot label"
                onChange={(event) => update(index, { label: event.target.value.toUpperCase().slice(0, 8) })}
              />
              <input
                className="input"
                value={slot.positions.join(', ')}
                aria-label="Eligible positions"
                placeholder="RB, WR, TE or *"
                onChange={(event) =>
                  update(index, {
                    positions: event.target.value
                      .split(',')
                      .map((part) => part.trim().toUpperCase())
                      .filter(Boolean),
                  })
                }
              />
              <select
                className="select"
                style={{ maxWidth: 92 }}
                value={slot.sport ?? ''}
                aria-label="Slot sport"
                onChange={(event) =>
                  update(index, { sport: event.target.value ? (event.target.value as Sport) : undefined })
                }
              >
                <option value="">Any</option>
                {sports.map((sport) => (
                  <option key={sport} value={sport}>
                    {SPORT_LABELS[sport]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn--sm btn--danger btn--icon"
                aria-label="Remove slot"
                onClick={() => onChange(slots.filter((_, i) => i !== index))}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="btn btn--sm btn--block"
        style={{ marginTop: 10 }}
        onClick={() =>
          onChange(
            normalizeSlotIds([...slots, { id: 'spot', label: `#${slots.length + 1}`, positions: ['*'] }]),
          )
        }
      >
        + Add roster spot
      </button>
      <p className="tiny faint" style={{ marginBottom: 0, marginTop: 8 }}>
        <code>*</code> accepts any player. Listing positions (<code>RB, WR, TE</code>) restricts the spot, and
        pinning it to a sport keeps that spot for that sport's pool.
      </p>
    </div>
  );
}

function ScoringEditor({
  scoring,
  onChange,
}: {
  scoring: ContestScoring;
  onChange: (scoring: ContestScoring) => void;
}) {
  const sportsInScoring = Object.keys(scoring) as Sport[];

  function setValue(sport: Sport, key: string, value: number) {
    const table = scoring[sport];
    if (!table) return;
    onChange({ ...scoring, [sport]: { ...table, values: { ...table.values, [key]: value } } });
  }

  function removeValue(sport: Sport, key: string) {
    const table = scoring[sport];
    if (!table) return;
    const values = { ...table.values };
    delete values[key];
    onChange({ ...scoring, [sport]: { ...table, values } });
  }

  function setTierPoints(sport: Sport, statKey: string, index: number, points: number) {
    const table = scoring[sport];
    if (!table?.tiers?.[statKey]) return;
    const tiers = table.tiers[statKey].map((tier, i) => (i === index ? { ...tier, points } : tier));
    onChange({ ...scoring, [sport]: { ...table, tiers: { ...table.tiers, [statKey]: tiers } } });
  }

  return (
    <div className="card">
      <div className="section-title">
        <h2 style={{ fontSize: 15 }}>Scoring</h2>
        <span className="tiny faint">points per stat</span>
      </div>

      {sportsInScoring.map((sport) => {
        const table = scoring[sport];
        if (!table) return null;
        const unused = STATS_BY_SPORT[sport].filter((stat) => table.values[stat.key] === undefined);
        return (
          <div key={sport} style={{ marginBottom: 16 }}>
            <div className="row row--between" style={{ marginBottom: 8 }}>
              <SportPill sport={sport} />
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => onChange({ ...scoring, [sport]: cloneScoring(DEFAULT_SCORING[sport]) })}
              >
                Reset to default
              </button>
            </div>

            <div className="list">
              {Object.entries(table.values).map(([key, value]) => (
                <div className="row" style={{ gap: 8 }} key={key}>
                  <span className="tiny" style={{ flex: 1, minWidth: 0 }}>
                    {statMeta(sport, key).label}
                  </span>
                  <input
                    className="input input--num"
                    style={{ maxWidth: 92 }}
                    type="number"
                    step={0.05}
                    value={value}
                    aria-label={`${statMeta(sport, key).label} points`}
                    onChange={(event) => setValue(sport, key, Number(event.target.value))}
                  />
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost btn--icon"
                    aria-label={`Remove ${key}`}
                    onClick={() => removeValue(sport, key)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            {Object.entries(table.tiers ?? {}).map(([statKey, tiers]) => (
              <div key={statKey} style={{ marginTop: 10 }}>
                <div className="eyebrow" style={{ marginBottom: 6 }}>
                  {statMeta(sport, statKey).label} tiers
                </div>
                <div className="list">
                  {tiers.map((tier, index) => (
                    <div className="row" style={{ gap: 8 }} key={`${tier.min}-${tier.max}`}>
                      <span className="tiny" style={{ flex: 1 }}>
                        {tier.min}
                        {tier.max === null ? '+' : `–${tier.max}`}
                      </span>
                      <input
                        className="input input--num"
                        style={{ maxWidth: 92 }}
                        type="number"
                        step={0.5}
                        value={tier.points}
                        aria-label={`Tier ${tier.min} points`}
                        onChange={(event) => setTierPoints(sport, statKey, index, Number(event.target.value))}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {unused.length > 0 ? (
              <select
                className="select"
                style={{ marginTop: 10 }}
                value=""
                aria-label={`Add ${SPORT_LABELS[sport]} scoring category`}
                onChange={(event) => {
                  if (event.target.value) setValue(sport, event.target.value, 0);
                }}
              >
                <option value="">+ Add scoring category…</option>
                {unused.map((stat) => (
                  <option key={stat.key} value={stat.key}>
                    {stat.label}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
