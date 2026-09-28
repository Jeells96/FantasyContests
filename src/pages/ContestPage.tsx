import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { GamePicks } from '../components/GamePicks';
import { LeaderboardList } from '../components/LeaderboardList';
import { PlayerCard } from '../components/PlayerCard';
import { PlayerSheet } from '../components/PlayerSheet';
import { RosterPanel } from '../components/RosterPanel';
import { SalaryBar } from '../components/SalaryBar';
import { ScoreOverlay } from '../components/ScoreOverlay';
import { Banner, Empty, KeyValue, Spinner, SportPill, StatusPill } from '../components/ui';
import { useContestData } from '../hooks/useContestData';
import { useScoringEvents } from '../hooks/useScoringEvents';
import { usePointDeltas } from '../hooks/usePointDeltas';
import { ScoringTab } from '../components/ScoringTab';
import { ScoreStrip } from '../components/ScoreStrip';
import { useLiveSync } from '../hooks/useLiveSync';
import { saveEntry } from '../lib/db';
import { formatCountdown, formatDateTime, formatGameTime } from '../lib/engine/contestState';
import { buildLeaderboard } from '../lib/engine/leaderboard';
import { formatMoney, validateEntry } from '../lib/engine/lineup';
import { isEligible, rosterSummary } from '../lib/engine/roster';
import { markEntered, teamNameFor } from '../lib/identity';
import { generateTeamName } from '../lib/teamName';
import { captainEnabled, captainMultiplier, captainPremium } from '../lib/engine/captain';
import { statMeta } from '../lib/stats';
import { useSession } from '../state/SessionContext';
import { SPORT_LABELS, type ContestPlayer, type LineupSelection, type Sport } from '../types';

type Tab = 'lineup' | 'board' | 'scoring' | 'info';
type SortKey = 'salary' | 'projection' | 'points';

export function ContestPage() {
  const { contestId } = useParams<{ contestId: string }>();
  const { uid, identity } = useSession();
  const data = useContestData(contestId, uid);
  const { contest, players, playersById, standings, entries, myEntry, locked, status } = data;

  const [tab, setTab] = useState<Tab>('lineup');
  const [lineup, setLineup] = useState<LineupSelection[]>([]);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  const [sportFilter, setSportFilter] = useState<Sport | 'all'>('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('salary');
  const [detail, setDetail] = useState<ContestPlayer | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [teamName, setTeamName] = useState<string>('');
  const picksRef = useRef<HTMLDivElement | null>(null);

  // Adopt the saved entry once, then let local edits stand.
  useEffect(() => {
    if (hydrated || !myEntry) return;
    setLineup(myEntry.lineup ?? []);
    setPicks(myEntry.picks ?? {});
    if (myEntry.teamName) setTeamName(myEntry.teamName);
    // Already entered, so open on the standings rather than the builder.
    setTab('board');
    setHydrated(true);
  }, [myEntry, hydrated]);

  useEffect(() => {
    if (locked) setTab((current) => (current === 'lineup' ? 'board' : current));
    if (locked) setSortKey('points');
  }, [locked]);


  const myPlayerIds = useMemo(
    () => new Set((myEntry?.lineup ?? lineup).map((line) => line.playerId)),
    [myEntry, lineup],
  );
  const { events } = useScoringEvents(contest, players, myPlayerIds, locked && status !== 'complete');
  // Anyone watching a live contest keeps its scores moving.
  useLiveSync(contest, status === 'live');
  // Who just scored, shown everywhere a player appears.
  const pointDeltas = usePointDeltas(players, locked);

  const cap = contest?.salaryCapInfo.cap ?? 0;
  const hasCaptain = captainEnabled(contest);
  const capMultiplier = captainMultiplier(contest);
  const captainPlayerId = lineup.find((line) => line.captain)?.playerId ?? null;
  const validation = useMemo(() => {
    if (!contest) return null;
    return validateEntry(contest, lineup, picks, playersById);
  }, [contest, lineup, picks, playersById]);

  // Once the entry is complete, name the team.
  useEffect(() => {
    if (locked || teamName || !identity || !validation?.valid) return;
    setTeamName(generateTeamName(identity.firstName));
  }, [locked, teamName, identity, validation?.valid]);

  const leaderboard = useMemo(() => {
    if (!contest) return [];
    return buildLeaderboard({
      contest,
      standings,
      entries: locked ? entries : myEntry ? [myEntry] : [],
      players: playersById,
      selfUid: uid,
      locked,
    });
  }, [contest, standings, entries, myEntry, playersById, uid, locked]);

  const rosterComplete = Boolean(validation && validation.filledSlots === contest?.rosterSlots.length);
  const picksComplete =
    !contest?.gameWinner.enabled || contest.games.every((game) => Boolean(picks[game.id]));
  // With the roster done but picks outstanding, the button moves the user on to
  // the picks rather than sitting disabled.
  const showNext = rosterComplete && !picksComplete && Boolean(validation?.filledSlots);

  const activeSlot = contest?.rosterSlots.find((slot) => slot.id === activeSlotId) ?? null;
  const occupantOfActiveSlot = activeSlotId ? lineup.find((line) => line.slotId === activeSlotId) : undefined;
  const salaryUsed = validation?.salaryUsed ?? 0;
  const spendable = cap - salaryUsed + (occupantOfActiveSlot ? playersById.get(occupantOfActiveSlot.playerId)?.salary ?? 0 : 0);

  const rosterablePlayers = useMemo(
    () => players.filter((player) => contest?.rosterSlots.some((slot) => isEligible(player, slot))),
    [players, contest],
  );

  const visiblePlayers = useMemo(() => {
    let list = rosterablePlayers;
    if (activeSlot) list = list.filter((player) => isEligible(player, activeSlot));
    if (sportFilter !== 'all') list = list.filter((player) => player.sport === sportFilter);
    const term = search.trim().toLowerCase();
    if (term) {
      list = list.filter(
        (player) =>
          player.name.toLowerCase().includes(term) ||
          player.teamAbbr.toLowerCase().includes(term) ||
          player.position.toLowerCase().includes(term),
      );
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sortKey === 'projection') return b.projection.normalized - a.projection.normalized;
      if (sortKey === 'points') return (b.normalizedPoints ?? 0) - (a.normalizedPoints ?? 0);
      return b.salary - a.salary;
    });
    return sorted;
  }, [rosterablePlayers, activeSlot, sportFilter, search, sortKey]);

  if (!contest) {
    return (
      <main className="page">
        {data.loading ? <Spinner label="Loading contest…" /> : <Empty title="Contest not found" />}
      </main>
    );
  }

  const usedPlayerIds = new Set(lineup.map((line) => line.playerId));

  /**
   * One control, three states: tap to roster a player, tap again to make them
   * captain, tap a third time to drop them.
   */
  function assignPlayer(player: ContestPlayer) {
    if (!contest || locked) return;
    setMessage(null);

    const existing = lineup.find((line) => line.playerId === player.id);
    if (existing) {
      if (hasCaptain && !existing.captain) {
        promoteToCaptain(existing.slotId, player);
        return;
      }
      setLineup((current) => current.filter((line) => line.playerId !== player.id));
      return;
    }

    const target =
      activeSlot && isEligible(player, activeSlot)
        ? activeSlot
        : contest.rosterSlots.find(
            (slot) => isEligible(player, slot) && !lineup.some((line) => line.slotId === slot.id),
          );
    if (!target) {
      setMessage({ tone: 'bad', text: `No open roster spot for ${player.position}. Tap a spot to replace it.` });
      return;
    }

    // Whoever holds the target spot is refunded before the cap is checked.
    const replaced = lineup.find((line) => line.slotId === target.id);
    const replacedPlayer = replaced ? playersById.get(replaced.playerId) : undefined;
    const refund = replacedPlayer
      ? replacedPlayer.salary + (replaced?.captain ? captainPremium(replacedPlayer, capMultiplier) : 0)
      : 0;
    const available = cap - salaryUsed + refund;
    if (player.salary > available) {
      setMessage({
        tone: 'bad',
        text: `${player.name} costs ${formatMoney(player.salary)} and you have ${formatMoney(
          available,
        )} left. Drop someone first.`,
      });
      return;
    }

    setLineup((current) => [
      ...current.filter((line) => line.slotId !== target.id && line.playerId !== player.id),
      { slotId: target.id, playerId: player.id },
    ]);
    setActiveSlotId(null);
  }

  /** Promoting costs the difference between the two captains' premiums. */
  function promoteToCaptain(slotId: string, player: ContestPlayer) {
    if (!contest || locked || !hasCaptain) return;
    const currentCaptain = lineup.find((line) => line.captain);
    const currentPlayer = currentCaptain ? playersById.get(currentCaptain.playerId) : undefined;
    const released = currentPlayer ? captainPremium(currentPlayer, capMultiplier) : 0;
    const cost = captainPremium(player, capMultiplier) - released;

    if (cost > cap - salaryUsed) {
      setMessage({
        tone: 'bad',
        text: `Making ${player.name} captain costs another ${formatMoney(
          cost,
        )} and you have ${formatMoney(cap - salaryUsed)} left. Drop someone first.`,
      });
      return;
    }

    setMessage(null);
    setLineup((current) => current.map((line) => ({ ...line, captain: line.slotId === slotId })));
  }

  function toggleCaptainSlot(slotId: string) {
    const line = lineup.find((entry) => entry.slotId === slotId);
    const player = line ? playersById.get(line.playerId) : undefined;
    if (!line || !player) return;
    if (line.captain) {
      setLineup((current) => current.map((entry) => ({ ...entry, captain: false })));
      return;
    }
    promoteToCaptain(slotId, player);
  }

  function removeSlot(slotId: string) {
    setLineup((current) => current.filter((line) => line.slotId !== slotId));
  }

  async function submit() {
    if (!contest || !uid || !identity || !validation) return;
    if (!validation.valid) {
      setMessage({ tone: 'bad', text: validation.errors[0] });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await saveEntry({
        contestId: contest.id,
        uid,
        displayName: identity.displayName,
        lineup,
        picks,
        salaryUsed: validation.salaryUsed,
        teamName: teamName || undefined,
        lockedSnapshot: Object.fromEntries(
          lineup.map((line) => [
            line.playerId,
            { salary: playersById.get(line.playerId)?.salary ?? 0, slotId: line.slotId },
          ]),
        ),
      });
      markEntered(contest.id);
      setMessage({ tone: 'ok', text: myEntry ? 'Lineup updated.' : 'Lineup submitted. Good luck!' });
      // Saving finishes the job, so show where the entry now stands.
      setTab('board');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      setMessage({
        tone: 'bad',
        text:
          error instanceof Error && /permission/i.test(error.message)
            ? 'This contest is locked — lineups can no longer be changed.'
            : 'Could not save your lineup. Please try again.',
      });
    } finally {
      setSaving(false);
    }
  }

  const untilLock = Date.parse(contest.lockTime) - Date.now();
  const myRow = leaderboard.find((row) => row.isSelf);

  return (
    <main className="page page--wide">
      <ScoreOverlay events={events} teamName={teamNameFor(identity)} />

      <div className="stack">
        <div>
          <Link to="/" className="tiny faint">
            ← All contests
          </Link>
          <div className="row row--between" style={{ alignItems: 'flex-start', marginTop: 6, gap: 10 }}>
            <h1 style={{ fontSize: 21, fontWeight: 900 }}>{contest.name}</h1>
            <StatusPill status={status} />
          </div>
          <div className="row row--wrap" style={{ gap: 6, marginTop: 8 }}>
            {contest.sports.map((sport) => (
              <SportPill key={sport} sport={sport} />
            ))}
            <span className="pill">{rosterSummary(contest.rosterSlots)}</span>
            <span className="pill">{formatMoney(cap)} cap</span>
            <span className="pill">{standings.length} entries</span>
          </div>
          <div className="tiny faint" style={{ marginTop: 6 }}>
            {status === 'open'
              ? `Everything locks when the first game starts — ${formatDateTime(contest.lockTime)} (${formatCountdown(untilLock)})`
              : status === 'live'
                ? 'Locked. Live scoring in progress.'
                : 'Contest complete.'}
          </div>
        </div>

        <ScoreStrip games={contest.games} lastSyncAt={contest.lastSyncAt ?? undefined} />

        <div className="tabs">
          {(['lineup', 'board', 'scoring', 'info'] as Tab[]).map((key) => (
            <button
              key={key}
              type="button"
              className={`tab${tab === key ? ' tab--active' : ''}`}
              onClick={() => setTab(key)}
            >
              {key === 'lineup'
                ? locked
                  ? 'My lineup'
                  : 'Build lineup'
                : key === 'board'
                  ? 'Leaderboard'
                  : key === 'scoring'
                    ? 'Scoring'
                    : 'Info'}
            </button>
          ))}
        </div>

        {message ? <Banner tone={message.tone === 'ok' ? 'ok' : 'bad'}>{message.text}</Banner> : null}

        {tab === 'lineup' ? (
          locked ? (
            <LockedLineup
              contest={contest}
              playersById={playersById}
              lineup={myEntry?.lineup ?? []}
              picks={myEntry?.picks ?? {}}
              hasEntry={Boolean(myEntry)}
              points={myRow?.total ?? 0}
              bonus={myRow?.bonusPoints ?? 0}
              pointDeltas={pointDeltas}
            />
          ) : (
            <div className="grid grid--builder">
              <div className="stack">
                <HowItWorks
                  contest={contest}
                  hasCaptain={hasCaptain}
                  multiplier={capMultiplier}
                />

                {teamName ? (
                  <div className="card card--tight teamname">
                    <div>
                      <div className="eyebrow">Your team name</div>
                      <div className="teamname__value">{teamName}</div>
                    </div>
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      onClick={() => identity && setTeamName(generateTeamName(identity.firstName))}
                    >
                      Shuffle
                    </button>
                  </div>
                ) : null}

                <div className="card card--tight">
                  <div className="row row--between" style={{ marginBottom: 8 }}>
                    <div className="eyebrow">Player pool · {visiblePlayers.length}</div>
                    {activeSlot ? (
                      <button type="button" className="btn btn--sm btn--ghost" onClick={() => setActiveSlotId(null)}>
                        {activeSlot.positions.includes('*')
                          ? `Filling ${activeSlot.label} ✕`
                          : `${activeSlot.label} only ✕`}
                      </button>
                    ) : null}
                  </div>

                  <input
                    className="input"
                    placeholder="Search player, team or position"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />

                  <div className="scroll-x" style={{ marginTop: 8 }}>
                    {contest.sports.length > 1 ? (
                      <>
                        <FilterChip active={sportFilter === 'all'} onClick={() => setSportFilter('all')}>
                          All sports
                        </FilterChip>
                        {contest.sports.map((sport) => (
                          <FilterChip
                            key={sport}
                            active={sportFilter === sport}
                            onClick={() => setSportFilter(sport)}
                          >
                            {SPORT_LABELS[sport]}
                          </FilterChip>
                        ))}
                      </>
                    ) : null}
                    <FilterChip active={sortKey === 'salary'} onClick={() => setSortKey('salary')}>
                      Salary
                    </FilterChip>
                    <FilterChip active={sortKey === 'projection'} onClick={() => setSortKey('projection')}>
                      Projection
                    </FilterChip>
                  </div>
                </div>

                <div className="list">
                  {visiblePlayers.slice(0, 220).map((player) => (
                    <PlayerCard
                      key={player.id}
                      player={player}
                      selected={usedPlayerIds.has(player.id)}
                      used={usedPlayerIds.has(player.id)}
                      unaffordable={player.salary > spendable}
                      captain={hasCaptain && player.id === captainPlayerId}
                      captainMultiplier={capMultiplier}
                      onClick={() => assignPlayer(player)}
                      onInfo={() => setDetail(player)}
                    />
                  ))}
                  {visiblePlayers.length === 0 ? (
                    <Empty title="No players match" hint="Clear the slot filter or search." />
                  ) : null}
                </div>
              </div>

              <div className="stack" style={{ position: 'sticky', top: 70 }}>
                <div className="card">
                  <div className="section-title">
                    <h2 style={{ fontSize: 15 }}>Your lineup</h2>
                    <span className="tiny faint">
                      {validation?.filledSlots ?? 0} of {contest.rosterSlots.length} spots
                    </span>
                  </div>
                  <RosterPanel
                    slots={contest.rosterSlots}
                    lineup={lineup}
                    playersById={playersById}
                    activeSlotId={activeSlotId}
                    onSelectSlot={(slotId) => setActiveSlotId(activeSlotId === slotId ? null : slotId)}
                    onRemove={removeSlot}
                    onToggleCaptain={hasCaptain ? toggleCaptainSlot : undefined}
                    captainMultiplier={hasCaptain ? capMultiplier : null}
                  />
                </div>

                {contest.gameWinner.enabled ? (
                  <div className="card" ref={picksRef}>
                    <div className="section-title">
                      <h2 style={{ fontSize: 15 }}>Spread picks</h2>
                      <span className="tiny faint">
                        {Object.keys(picks).length}/{contest.games.length}
                      </span>
                    </div>
                    <GamePicks
                      games={contest.games}
                      picks={picks}
                      bonusPoints={contest.gameWinner.bonusPoints}
                      onPick={(gameId, teamId) => setPicks((current) => ({ ...current, [gameId]: teamId }))}
                    />
                  </div>
                ) : null}

                {validation && validation.errors.length > 0 ? (
                  <div className="card card--tight">
                    <div className="eyebrow" style={{ marginBottom: 6 }}>
                      Before you submit
                    </div>
                    <ul className="tiny muted" style={{ margin: 0, paddingLeft: 18 }}>
                      {validation.errors.slice(0, 5).map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>
          )
        ) : null}

        {tab === 'board' ? (
          <LeaderboardList rows={leaderboard} contest={contest} locked={locked} pointDeltas={pointDeltas} />
        ) : null}

        {tab === 'scoring' ? (
          <ScoringTab
            contest={contest}
            players={players}
            entries={locked ? entries : myEntry ? [myEntry] : []}
            pointDeltas={pointDeltas}
            locked={locked}
            selfUid={uid}
          />
        ) : null}

        {tab === 'info' ? <ContestInfo contest={contest} /> : null}
      </div>

      {tab === 'lineup' && !locked ? (
        <SalaryBar
          cap={cap}
          used={salaryUsed}
          filled={validation?.filledSlots ?? 0}
          total={contest.rosterSlots.length}
          blocker={showNext ? null : validation && !validation.valid ? validation.errors[0] : null}
          action={
            showNext ? (
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => picksRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--go"
                disabled={!validation?.valid || saving || !identity}
                onClick={submit}
              >
                {saving ? <span className="spinner" /> : myEntry ? 'Update' : 'Submit'}
              </button>
            )
          }
        />
      ) : null}

      {detail ? <PlayerSheet player={detail} contest={contest} onClose={() => setDetail(null)} /> : null}
    </main>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className={`tab${active ? ' tab--active' : ''}`} onClick={onClick} style={{ flex: 'none' }}>
      {children}
    </button>
  );
}

function LockedLineup({
  contest,
  playersById,
  lineup,
  picks,
  hasEntry,
  points,
  bonus,
  pointDeltas,
}: {
  contest: import('../types').Contest;
  playersById: Map<string, ContestPlayer>;
  lineup: LineupSelection[];
  picks: Record<string, string>;
  hasEntry: boolean;
  points: number;
  bonus: number;
  pointDeltas: Map<string, number>;
}) {
  if (!hasEntry) {
    return (
      <Empty
        title="You did not enter this contest"
        hint="Rosters locked when the first game started. You can still follow the leaderboard."
      />
    );
  }
  return (
    <div className="stack">
      <div className="card">
        <div className="row row--between">
          <div>
            <div className="eyebrow">Your total</div>
            <div style={{ fontSize: 30, fontWeight: 900 }} className="num">
              {points.toFixed(1)}
            </div>
          </div>
          {contest.gameWinner.enabled ? (
            <div style={{ textAlign: 'right' }}>
              <div className="eyebrow">Winner bonus</div>
              <div style={{ fontSize: 20, fontWeight: 800 }} className="num">
                +{bonus.toFixed(1)}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="card">
        <div className="section-title">
          <h2 style={{ fontSize: 15 }}>Locked roster</h2>
          <span className="tiny faint">live points</span>
        </div>
        <RosterPanel
          slots={contest.rosterSlots}
          lineup={lineup}
          playersById={playersById}
          captainMultiplier={captainEnabled(contest) ? captainMultiplier(contest) : null}
          pointDeltas={pointDeltas}
          live
          readOnly
        />
      </div>

      {contest.gameWinner.enabled ? (
        <div className="card">
          <div className="section-title">
            <h2 style={{ fontSize: 15 }}>Your spread picks</h2>
          </div>
          <GamePicks games={contest.games} picks={picks} bonusPoints={contest.gameWinner.bonusPoints} readOnly />
        </div>
      ) : null}
    </div>
  );
}

function ContestInfo({ contest }: { contest: import('../types').Contest }) {
  return (
    <div className="stack">
      <div className="card">
        <div className="section-title">
          <h2 style={{ fontSize: 15 }}>Games</h2>
          <span className="tiny faint">Locks at the first start</span>
        </div>
        <div className="list">
          {contest.games.map((game) => (
            <div className="card card--tight" key={game.id}>
              <div className="row row--between">
                <span style={{ fontWeight: 700 }}>{game.shortName}</span>
                <SportPill sport={game.sport} />
              </div>
              <div className="row row--between tiny muted" style={{ marginTop: 4 }}>
                <span>{formatGameTime(game.startTime)}</span>
                <span>
                  {game.state === 'pre'
                    ? 'Scheduled'
                    : `${game.away.abbreviation} ${game.away.score ?? 0} – ${game.home.score ?? 0} ${game.home.abbreviation} · ${game.statusDetail}`}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="section-title">
          <h2 style={{ fontSize: 15 }}>Automatic salary cap</h2>
        </div>
        <KeyValue label="Salary cap" value={formatMoney(contest.salaryCapInfo.cap)} />
        <KeyValue label="Cheapest valid lineup" value={formatMoney(contest.salaryCapInfo.minLineupCost)} />
        <KeyValue label="Median lineup" value={formatMoney(contest.salaryCapInfo.medianLineupCost)} />
        <KeyValue label="All-stars lineup" value={formatMoney(contest.salaryCapInfo.maxLineupCost)} />
        <p className="tiny faint" style={{ marginBottom: 0 }}>
          The cap is derived from this contest's own player pool, so it always leaves multiple viable builds
          while making a roster of every elite player impossible.
        </p>
      </div>

      {contest.sports.length > 1 || contest.sports[0] !== 'nfl' ? (
        <div className="card">
          <div className="section-title">
            <h2 style={{ fontSize: 15 }}>Cross-sport normalization</h2>
          </div>
          <p className="tiny muted" style={{ marginTop: 0 }}>
            NFL fantasy points are the baseline. Other sports are multiplied by a factor measured from this
            contest's expected scoring, so no sport dominates simply by accumulating more statistical events.
          </p>
          {contest.sports.map((sport) => (
            <KeyValue
              key={sport}
              label={`${SPORT_LABELS[sport]} factor`}
              value={
                <>
                  ×{(contest.normalization.factors[sport] ?? 1).toFixed(3)}
                  <span className="tiny faint">
                    {' '}
                    (anchor {(contest.normalization.anchors[sport] ?? 0).toFixed(1)})
                  </span>
                </>
              }
            />
          ))}
        </div>
      ) : null}

      {contest.gameWinner.enabled ? (
        <div className="card">
          <div className="section-title">
            <h2 style={{ fontSize: 15 }}>Spread pick bonus</h2>
          </div>
          <KeyValue label="Bonus per correct pick" value={`${contest.gameWinner.bonusPercent}%`} />
          <KeyValue label="Contest scoring baseline" value={contest.scoringBaseline.toFixed(1)} />
          <KeyValue label="Points per correct pick" value={`+${contest.gameWinner.bonusPoints.toFixed(1)}`} />
          <p className="tiny faint" style={{ marginBottom: 0 }}>
            The bonus is a percentage of a fixed contest baseline set when the contest was created — never of
            your own score — so every entrant earns exactly the same amount for a correct pick.
          </p>
        </div>
      ) : null}

      <div className="card">
        <div className="section-title">
          <h2 style={{ fontSize: 15 }}>Scoring</h2>
        </div>
        {contest.sports.map((sport) => {
          const table = contest.scoring[sport];
          if (!table) return null;
          return (
            <div key={sport} style={{ marginBottom: 12 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>
                {SPORT_LABELS[sport]}
              </div>
              <table className="table-mini">
                <tbody>
                  {Object.entries(table.values).map(([key, value]) => (
                    <tr key={key}>
                      <td>{statMeta(sport, key).label}</td>
                      <td className="num">{value}</td>
                    </tr>
                  ))}
                  {Object.entries(table.tiers ?? {}).map(([key, tiers]) => (
                    <tr key={key}>
                      <td>{statMeta(sport, key).label}</td>
                      <td className="num tiny">
                        {tiers.map((tier) => `${tier.min}${tier.max === null ? '+' : `-${tier.max}`}: ${tier.points}`).join(' · ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The contest's rules, stated before anyone starts picking. */
function HowItWorks({
  contest,
  hasCaptain,
  multiplier,
}: {
  contest: import('../types').Contest;
  hasCaptain: boolean;
  multiplier: number;
}) {
  return (
    <div className="card card--tight howto">
      <div className="eyebrow" style={{ marginBottom: 8 }}>
        How this contest works
      </div>
      <ul className="howto__list">
        <li>
          <strong>Tap a player</strong> to add them to your roster.
          {hasCaptain ? (
            <>
              {' '}
              <strong>Tap again</strong> to make them your <span className="cpt-badge">CPT</span>.{' '}
              <strong>Tap a third time</strong> to drop them.
            </>
          ) : (
            <> Tap them again to drop them.</>
          )}
        </li>
        {hasCaptain ? (
          <li>
            Your <strong>captain scores {multiplier}× points</strong> — and costs{' '}
            <strong>{multiplier}× salary</strong>. Exactly one captain per roster, shown at the top of your
            lineup.
          </li>
        ) : null}
        <li>
          Fill all <strong>{contest.rosterSlots.length} spots</strong> without going over the{' '}
          <strong>{formatMoney(contest.salaryCapInfo.cap)}</strong> salary cap.
        </li>
        {contest.gameWinner.enabled ? (
          contest.games.some((game) => Boolean(game.spread)) ? (
            <li>
              <strong>Pick one team in every game, against the spread.</strong> The favorite has points taken
              away and the underdog gets points added, to even the teams out. Each button tells you exactly
              what has to happen — "must win by 4+", "can lose by up to 3, or win". Getting it right adds{' '}
              <strong>+{contest.gameWinner.bonusPoints.toFixed(1)}</strong>, the same for everyone.
            </li>
          ) : (
            <li>
              Pick a winner in every game. Each correct pick adds{' '}
              <strong>+{contest.gameWinner.bonusPoints.toFixed(1)}</strong> — the same for everyone.
            </li>
          )
        ) : null}
        <li>
          Everything locks when the first game starts. Until then, nobody can see your roster.
        </li>
      </ul>
    </div>
  );
}
