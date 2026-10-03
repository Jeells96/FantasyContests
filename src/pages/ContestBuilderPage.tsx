import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Banner, Collapsible, Empty, KeyValue, Sheet, Spinner, SportPill, Toggle } from '../components/ui';
import { createContest, getContest, getPool, updateContest } from '../lib/db';
import { buildPlayerPool, listGamesRange, type ProviderGame } from '../lib/providers';
import { withSpreads } from '../lib/providers/odds';
import { deriveStatus, earliestStart, formatGameTime, latestStart } from '../lib/engine/contestState';
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
import { DEFAULT_CAPTAIN_MULTIPLIER } from '../lib/engine/captain';
import { STATS_BY_SPORT, statMeta } from '../lib/stats';
import { useSession } from '../state/SessionContext';
import { FALLBACK_DEFAULTS, loadContestDefaults, type ContestDefaults } from '../lib/defaults';
import { InviteByPool } from '../components/InviteByPool';
import { loadPeople, loadPools, type Person, type Pool } from '../lib/people';
import type { ContestInvite } from '../types';
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

export function ContestBuilderPage() {
  const { contestId } = useParams<{ contestId: string }>();
  const { uid, identity, personKey: myKey } = useSession();
  const navigate = useNavigate();
  const editing = Boolean(contestId);

  // A duplicate arrives here pointed straight at its invite step.
  const [query] = useSearchParams();
  const [step, setStep] = useState(() => {
    const asked = Number(query.get('step'));
    if (asked >= 1 && asked <= 4) return asked;
    return editing ? 3 : 1;
  });
  const [sports, setSports] = useState<Sport[]>(['nfl']);
  const [date, setDate] = useState(todayISO());
  const [days, setDays] = useState(3);
  const [available, setAvailable] = useState<ProviderGame[]>([]);
  /*
   * The games chosen so far, kept whole rather than as ids.
   *
   * A contest is often a weekend rather than a day — Sunday's slate plus Monday
   * night, or a baseball game tonight and football tomorrow — and each of those
   * is a separate look at the schedule. Holding ids into whichever list happens
   * to be loaded meant every new search silently dropped what was already
   * picked. Keeping the games means a search only adds to the shelf.
   */
  const [picked, setPicked] = useState<ProviderGame[]>([]);
  const [pool, setPool] = useState<PoolPlayer[]>([]);
  const [rosterSlots, setRosterSlots] = useState<RosterSlot[]>(buildDefaultRoster(['nfl']));
  const [scoring, setScoring] = useState<ContestScoring>(defaultScoringFor(['nfl']));
  const [gameWinnerEnabled, setGameWinnerEnabled] = useState(true);
  const [captainOn, setCaptainOn] = useState(true);
  const [captainX, setCaptainX] = useState(DEFAULT_CAPTAIN_MULTIPLIER);
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
  const [defaults, setDefaults] = useState<ContestDefaults>(FALLBACK_DEFAULTS);
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [pools, setPools] = useState<Pool[]>([]);
  const [invites, setInvites] = useState<ContestInvite[]>([]);
  const [wagerOn, setWagerOn] = useState(false);
  const [wagerAmount, setWagerAmount] = useState(5);
  const [wagerNote, setWagerNote] = useState('');

  const selectedGames = useMemo(
    () => [...picked].sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [picked],
  );
  const selectedIds = useMemo(() => new Set(picked.map((game) => game.id)), [picked]);

  /** How many separate days the slate spans, as the person's calendar sees it. */
  const pickedDays = useMemo(
    () => new Set(picked.map((game) => new Date(game.startTime).toDateString())).size,
    [picked],
  );

  /** Add a game to the shelf, or take it off. */
  const toggleGame = useCallback((game: ProviderGame) => {
    setPicked((current) =>
      current.some((entry) => entry.id === game.id)
        ? current.filter((entry) => entry.id !== game.id)
        : [...current, game],
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadPeople().then((next) => {
      if (!cancelled) setPeople(next);
    });
    void loadPools().then((next) => {
      if (!cancelled) setPools(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* -------------------------------------------------------- house defaults ---- */
  // What a new contest opens with. The creator can change any of it below.
  useEffect(() => {
    if (editing) return;
    let cancelled = false;
    void loadContestDefaults().then((next) => {
      if (cancelled) return;
      setDefaults(next);
      setSports(next.sports);
      setDays(next.days);
      setCaptainOn(next.captainEnabled);
      setCaptainX(next.captainMultiplier);
      setGameWinnerEnabled(next.gameWinnerEnabled);
      setBonusPercent(next.bonusPercent);
      setRosterSlots(next.rosterSpots > 0 ? openRoster(next.rosterSpots) : buildDefaultRoster(next.sports));
    });
    return () => {
      cancelled = true;
    };
  }, [editing]);

  /* ------------------------------------------------------------ edit mode ---- */
  useEffect(() => {
    if (!contestId) return;
    let cancelled = false;
    (async () => {
      try {
        const [contest, players] = await Promise.all([getContest(contestId), getPool(contestId)]);
        if (cancelled) return;
        if (!contest) {
          setError('That contest no longer exists.');
          setLoaded(true);
          return;
        }
        setExisting(contest);
        setSports(contest.sports);
        setAvailable(contest.games);
        setPicked(contest.games);
        setPool(players.map(toPoolPlayer));
        setRosterSlots(contest.rosterSlots);
        setScoring(contest.scoring);
        setGameWinnerEnabled(contest.gameWinner.enabled);
        setBonusPercent(contest.gameWinner.bonusPercent);
        setCaptainOn(Boolean(contest.captain?.enabled));
        setCaptainX(contest.captain?.multiplier ?? DEFAULT_CAPTAIN_MULTIPLIER);
        setName(contest.name);
        setNotes(contest.notes ?? '');
        setInvites(contest.invites ?? []);
        setWagerOn(Boolean(contest.wager));
        setWagerAmount(contest.wager?.amount ?? 5);
        setWagerNote(contest.wager?.note ?? '');
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
      // Refresh anything already picked that this search also returned, so a
      // reload updates start times and scores without losing the selection.
      setPicked((current) =>
        current.map((entry) => games.find((game) => game.id === entry.id) ?? entry),
      );
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
      setRosterSlots(defaults.rosterSpots > 0 ? openRoster(defaults.rosterSpots) : buildDefaultRoster(sportsInPool));
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
      return priceContest(pool, rosterSlots, scoring, selectedGames, {
        enabled: captainOn,
        multiplier: captainX,
      });
    } catch {
      return null;
    }
  }, [pool, rosterSlots, scoring, selectedGames, captainOn, captainX]);

  const bonusPoints = pricing ? gameWinnerBonusPoints(pricing.scoringBaseline, bonusPercent) : 0;

  async function publish() {
    if (!pricing || selectedGames.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      // Freeze the betting line now; it is never read again.
      const games = await withSpreads(selectedGames);
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
        captain: { enabled: captainOn, multiplier: captainX },
        lockTime: earliestStart(games),
        lastGameStart: latestStart(games),
        status: 'open' as const,
        ownerId: existing?.ownerId || uid,
        ownerName: existing?.ownerName || identity?.displayName || '',
        invites,
        inviteKeys: invites.map((invite) => invite.key),
        // Whoever shares a pool with the creator sees this without being named.
        poolIds: people[myKey]?.pools ?? [],
        // Always stated, so turning it off on an edit actually removes it.
        wager:
          wagerOn && wagerAmount > 0
            ? { amount: wagerAmount, ...(wagerNote.trim() ? { note: wagerNote.trim() } : {}) }
            : null,
        finalizedAt: null,
        playerCount: pricing.players.length,
        notes: notes.trim(),
      };

      if (editing && contestId && existing) {
        await updateContest(contestId, { ...existing, ...payload, id: contestId }, pricing.players);
        navigate(`/contest/${contestId}`);
      } else {
        const id = await createContest({ ...payload, players: pricing.players });
        navigate(`/contest/${id}`);
      }
    } catch (e) {
      setError(
        e instanceof Error && /permission/i.test(e.message)
          ? 'Firestore rejected the write. Are the security rules deployed?'
          : e instanceof Error
            ? e.message
            : 'Save failed',
      );
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return (
      <main className="page">
        <Spinner label="Loading contest…" />
      </main>
    );
  }
  if (editing) {
    // Never open an editable builder for a contest that could not be read: an
    // unreadable contest is not proof that it is yours.
    if (!existing) {
      return (
        <main className="page">
          <Empty title="Could not load contest" hint={error ?? 'Check your connection and try again.'} />
        </main>
      );
    }
    // Once the first game kicks off the rules are what everyone played by.
    if (deriveStatus(existing) !== 'open') {
      return (
        <main className="page">
          <Empty
            title="Settings are locked"
            hint="This contest has started, so its games, roster and scoring can no longer be changed."
          />
        </main>
      );
    }
    // A contest belongs to whoever started it; nobody else can change it.
    if (existing.ownerId && existing.ownerId !== uid) {
      return (
        <main className="page">
          <Empty
            title="Not your contest"
            hint={`Only ${existing.ownerName || 'the person who started it'} can edit this contest.`}
          />
        </main>
      );
    }
  }

  return (
    <main className="page page--wide">
      <div className="stack stack--lg">
        <div>
          <div className="eyebrow">{editing ? 'Your contest' : 'New contest'}</div>
          <h1 style={{ fontSize: 22, fontWeight: 900 }}>{editing ? 'Edit contest' : 'Start a contest'}</h1>
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

            {/* What is on the shelf, including games from searches already left
                behind — otherwise a pick from another day is invisible here. */}
            {selectedGames.length > 0 ? (
              <div className="card">
                <div className="row row--between" style={{ marginBottom: 8 }}>
                  <div className="eyebrow">
                    Your slate · {selectedGames.length} game{selectedGames.length === 1 ? '' : 's'}
                    {pickedDays > 1 ? ` across ${pickedDays} days` : ''}
                  </div>
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => setPicked([])}>
                    Clear
                  </button>
                </div>
                <div className="list">
                  {selectedGames.map((game) => (
                    <button
                      key={game.id}
                      type="button"
                      className="player player--selected"
                      onClick={() => toggleGame(game)}
                    >
                      <span className="player__body">
                        <span className="player__name">{game.shortName}</span>
                        <span className="player__meta">{formatGameTime(game.startTime)}</span>
                      </span>
                      <span className="player__right">
                        <SportPill sport={game.sport} />
                        <span className="tiny faint">remove</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="card">
              <div className="row row--between" style={{ marginBottom: 8 }}>
                <div className="eyebrow">Schedule</div>
                <span className="tiny faint">Change the date to add more days</span>
              </div>

              {loadingGames ? <Spinner label="Loading schedule…" /> : null}
              {!loadingGames && available.length === 0 ? (
                <Empty title="No games found" hint="Try another date or sport." />
              ) : null}

              <div className="list">
                {available.map((game) => {
                  const checked = selectedIds.has(game.id);
                  return (
                    <button
                      key={game.id}
                      type="button"
                      className={`player${checked ? ' player--selected' : ''}`}
                      onClick={() => toggleGame(game)}
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
              disabled={selectedGames.length === 0}
              onClick={() => setStep(2)}
            >
              Continue with {selectedGames.length} game{selectedGames.length === 1 ? '' : 's'}
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
                <h2 style={{ fontSize: 15 }}>Team captain</h2>
              </div>
              <Toggle
                checked={captainOn}
                onChange={setCaptainOn}
                label="Let entrants name one captain"
              />
              {captainOn ? (
                <div className="field" style={{ marginTop: 12 }}>
                  <label htmlFor="captainx">Captain multiplier (salary and points)</label>
                  <input
                    id="captainx"
                    type="number"
                    className="input input--num"
                    min={1}
                    max={3}
                    step={0.1}
                    value={captainX}
                    onChange={(event) => setCaptainX(Number(event.target.value) || DEFAULT_CAPTAIN_MULTIPLIER)}
                  />
                  <p className="tiny faint" style={{ margin: '6px 0 0' }}>
                    The captain scores {captainX}× points and costs {captainX}× salary. The salary cap below
                    already accounts for it.
                  </p>
                </div>
              ) : null}
            </div>

            <div className="card">
              <div className="section-title">
                <h2 style={{ fontSize: 15 }}>Money on it</h2>
              </div>
              <Toggle
                checked={wagerOn}
                onChange={setWagerOn}
                label="Play for a set amount"
              />
              {wagerOn ? (
                <div className="stack" style={{ marginTop: 12 }}>
                  <div className="field">
                    <label htmlFor="wager">Amount each player puts in</label>
                    <input
                      id="wager"
                      type="number"
                      inputMode="decimal"
                      className="input input--num"
                      min={1}
                      step={1}
                      value={wagerAmount}
                      onChange={(event) => setWagerAmount(Math.max(0, Number(event.target.value) || 0))}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="wagernote">Terms (optional)</label>
                    <input
                      id="wagernote"
                      className="input"
                      maxLength={80}
                      placeholder="Winner takes all"
                      value={wagerNote}
                      onChange={(event) => setWagerNote(event.target.value)}
                    />
                  </div>
                  <p className="tiny faint" style={{ margin: 0 }}>
                    Everyone joining is asked whether they are in, and can play without betting. Nothing is
                    collected here — the contest keeps the tally and ticks off who has settled up.
                  </p>
                </div>
              ) : null}
            </div>

            <div className="card">
              <div className="section-title">
                <h2 style={{ fontSize: 15 }}>Spread picks</h2>
              </div>
              <Toggle
                checked={gameWinnerEnabled}
                onChange={setGameWinnerEnabled}
                label="Require a pick against the spread for every game"
              />
              <p className="tiny faint" style={{ margin: '8px 0 0' }}>
                The betting line is captured when you publish and frozen onto the contest, so later movement
                cannot change what entrants picked against. A game with no line available falls back to a
                straight winner pick.
              </p>
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

            <InviteByPool
              people={people}
              pools={pools}
              myKey={myKey}
              invites={invites}
              onChange={setInvites}
            />

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
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  // A slate spanning days says so, rather than naming itself after the first.
  const first = day(earliestStart(games));
  const last = day(latestStart(games));
  return `${sports.join(' + ')} ${games.length}-game slate · ${first === last ? first : `${first}–${last}`}`;
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
      <Collapsible
        title="Calculated pricing"
        summary={`${formatMoney(pricing.salaryCapInfo.cap)} cap · ${pricing.players.length} players`}
      >
      <div className="row row--between" style={{ margin: '10px 0 6px' }}>
        <span className="tiny faint">How the cap and salaries were worked out</span>
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
      </Collapsible>

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
        contests simple.
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

      <Collapsible
        title="Edit spots"
        summary={describeRoster(slots)}
      >
      <p className="tiny muted" style={{ marginTop: 10 }}>
        A spot marked <code>ANY</code> takes any player in the pool. Type positions into it
        (<code>RB, WR, TE</code>) to restrict it, or pin it to a sport to reserve it for that sport's players.
        Entrants may leave spots empty if they run out of salary.
      </p>

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
                value={slot.positions.includes('*') ? 'ANY' : slot.positions.join(', ')}
                aria-label="Eligible positions"
                placeholder="ANY, or RB, WR, TE"
                onChange={(event) =>
                  update(index, {
                    // "ANY" is how an open spot is written; `*` is how it is stored.
                    positions: /^\s*(any|\*)\s*$/i.test(event.target.value)
                      ? ['*']
                      : event.target.value
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
      </Collapsible>
    </div>
  );
}

/** "8 spots, any player" or "QB, RB×2, WR×3 …" — enough to leave the editor shut. */
function describeRoster(slots: RosterSlot[]): string {
  if (slots.length === 0) return 'no spots';
  if (isOpenRoster(slots)) return `${slots.length} spots · any player`;
  const counts = new Map<string, number>();
  for (const slot of slots) {
    const key = slot.positions.includes('*') ? 'ANY' : slot.positions.join('/');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, n]) => (n > 1 ? `${key}×${n}` : key)).join(', ');
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
      <Collapsible
        title="Scoring"
        summary={`${sportsInScoring.map((sport) => SPORT_LABELS[sport]).join(' + ')} · standard points`}
      >
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
      </Collapsible>
    </div>
  );
}
