import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { ContestCard, CompletedContestRow } from '../components/ContestCard';
import { Banner, Empty, Spinner } from '../components/ui';
import {
  countEntrants,
  declineInvitation,
  findContestByJoinCode,
  getMyEntry,
  joinContest,
  listenMyContests,
  listenMyInvitations,
  listenPoolContests,
} from '../lib/db';
import { hasSpread } from '../lib/engine/spread';
import { deriveStatus, formatDateTime } from '../lib/engine/contestState';
import { useLiveContestsSync } from '../hooks/useLiveSync';
import { rosterSummary } from '../lib/engine/roster';
import { enteredContests } from '../lib/identity';
import { useSession } from '../state/SessionContext';
import { loadPeople } from '../lib/people';
import { formatWager } from '../lib/engine/wager';
import type { Contest, ContestStatus } from '../types';

const ORDER: ContestStatus[] = ['live', 'open', 'complete'];
const HEADINGS: Record<ContestStatus, string> = {
  live: 'Live now',
  open: 'Open contests',
  complete: 'Completed',
};

export function HomePage() {
  const { identity, uid, personKey } = useSession();
  const [contests, setContests] = useState<Contest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [openPicks, setOpenPicks] = useState<Record<string, number>>({});
  const [invitations, setInvitations] = useState<Contest[]>([]);
  const [poolContests, setPoolContests] = useState<Contest[]>([]);
  const [myPools, setMyPools] = useState<string[]>([]);
  const [, setTick] = useState(0);
  const entered = useMemo(() => enteredContests(), []);

  // Only the contests this device started or joined with a code.
  useEffect(
    () =>
      listenMyContests(
        uid,
        (next) => setContests(next),
        (e) => setError(e.message),
      ),
    [uid],
  );

  // Contests somebody invited this name to, which need no code.
  useEffect(() => {
    if (!personKey) return;
    return listenMyInvitations(personKey, uid, setInvitations);
  }, [personKey, uid]);

  // Which circles this person belongs to; a contest from one is theirs to see.
  useEffect(() => {
    if (!personKey) return;
    let cancelled = false;
    void loadPeople().then((people) => {
      if (!cancelled) setMyPools(people[personKey]?.pools ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [personKey]);

  // Anything started by someone who shares a pool, without anyone being named.
  useEffect(() => {
    if (myPools.length === 0) {
      setPoolContests([]);
      return;
    }
    return listenPoolContests(myPools, uid, setPoolContests, () => undefined);
  }, [myPools, uid]);

  // The list is the other page people leave open, so it keeps live contests
  // scoring rather than leaving that to whoever has a contest page up.
  useLiveContestsSync(contests);

  // Re-render every second so the countdown to lock runs here too, not only on
  // the contest page.
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Entry counts come from an aggregation query rather than the contest
  // document, so the number is live without anyone writing to the contest.
  useEffect(() => {
    if (!contests || contests.length === 0) return;
    let cancelled = false;
    void Promise.all(
      contests.map(async (contest) => [contest.id, await countEntrants(contest.id).catch(() => contest.entrantCount)] as const),
    ).then((pairs) => {
      if (!cancelled) setCounts(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [contests]);

  // A line that posted after someone entered is worth telling them about.
  useEffect(() => {
    const waiting = (contests ?? []).filter(
      (contest) => contest.gameWinner.enabled && deriveStatus(contest) === 'open' && contest.games.some(hasSpread),
    );
    if (waiting.length === 0) return;
    let cancelled = false;
    void Promise.all(
      waiting.map(async (contest) => {
        const entry = await getMyEntry(contest.id, uid).catch(() => null);
        if (!entry) return [contest.id, 0] as const;
        const missing = contest.games.filter((game) => hasSpread(game) && !entry.picks?.[game.id]).length;
        return [contest.id, missing] as const;
      }),
    ).then((pairs) => {
      if (!cancelled) setOpenPicks(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [contests, uid]);

  /*
   * Everything this person could join but has not: named invitations and
   * anything from a pool they are in. The same contest can arrive both ways, so
   * it is listed once.
   */
  const waiting = useMemo(() => {
    const byId = new Map<string, Contest>();
    for (const contest of [...invitations, ...poolContests]) byId.set(contest.id, contest);
    return [...byId.values()].sort((a, b) => a.lockTime.localeCompare(b.lockTime));
  }, [invitations, poolContests]);

  const grouped = useMemo(() => {
    const map = new Map<ContestStatus, Contest[]>();
    for (const contest of contests ?? []) {
      const status = deriveStatus(contest);
      map.set(status, [...(map.get(status) ?? []), contest]);
    }
    for (const [status, list] of map.entries()) {
      map.set(
        status,
        list.sort((a, b) =>
          status === 'complete' ? b.lockTime.localeCompare(a.lockTime) : a.lockTime.localeCompare(b.lockTime),
        ),
      );
    }
    return map;
  }, [contests]);

  return (
    <main className="page">
      <div className="stack stack--lg">
        <div>
          <div className="eyebrow">Daily fantasy</div>
          <h1 style={{ fontSize: 24, fontWeight: 900 }}>
            {identity ? `Welcome back, ${identity.firstName}` : 'Contests'}
          </h1>
          <p className="muted tiny" style={{ margin: '6px 0 0' }}>
            Start a contest and share its six-digit code, or enter someone else's code to join theirs.
          </p>
        </div>

        <div className="row row--wrap" style={{ gap: 8 }}>
          <Link to="/new" className="btn btn--primary" style={{ flex: '1 1 160px' }}>
            + Start a contest
          </Link>
        </div>

        <JoinByCode uid={uid} known={contests} />

        {waiting.length > 0 ? (
          <section>
            <div className="section-title">
              <h2>Open to you</h2>
              <span className="tiny faint">{waiting.length}</span>
            </div>
            <div className="list">
              {waiting.map((contest) => (
                <Invitation key={contest.id} contest={contest} uid={uid} myKey={personKey} />
              ))}
            </div>
          </section>
        ) : null}

        {error ? <div className="banner banner--bad">{error}</div> : null}
        {contests === null && !error ? <Spinner label="Loading contests…" /> : null}

        {contests !== null && contests.length === 0 ? (
          <Empty
            title="No contests yet"
            hint="Start one with today's NFL, MLB or NBA games, or join a friend's with their code."
          />
        ) : null}

        {ORDER.map((status) => {
          const list = grouped.get(status);
          if (!list || list.length === 0) return null;
          return (
            <section key={status}>
              <div className="section-title">
                <h2>{HEADINGS[status]}</h2>
                <span className="tiny faint">{list.length}</span>
              </div>
              {status === 'complete' ? (
                <div>
                  {list.map((contest) => (
                    <CompletedContestRow key={contest.id} contest={contest} uid={uid} />
                  ))}
                </div>
              ) : (
                <div className="grid grid--contests">
                  {list.map((contest) => (
                    <ContestCard
                      key={contest.id}
                      contest={{ ...contest, entrantCount: counts[contest.id] ?? contest.entrantCount }}
                      entered={entered.has(contest.id)}
                      isOwner={contest.ownerId === uid}
                      openPicks={openPicks[contest.id] ?? 0}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}

/** Six digits is the whole door: type a code, land in the contest. */
function JoinByCode({ uid, known }: { uid: string; known: Contest[] | null }) {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Already a member: skip the write and just open it.
      const mine = known?.find((contest) => contest.joinCode === code);
      if (mine) {
        navigate(`/contest/${mine.id}`);
        return;
      }
      const contest = await findContestByJoinCode(code);
      if (!contest) {
        setError('No contest has that code. Check the six digits with whoever started it.');
        return;
      }
      // Firestore applies the membership write locally at once and syncs it when
      // it can, so opening the contest never waits on the round trip.
      void joinContest(contest.id, uid);
      navigate(`/contest/${contest.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join that contest');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit} style={{ gap: 10 }}>
      <div>
        <div className="label" style={{ margin: 0 }}>
          Join with a code
        </div>
        <div className="tiny faint">Ask whoever started the contest for its six digits.</div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <input
          className="input input--code"
          value={code}
          onChange={(event) => {
            setCode(event.target.value.replace(/\D/g, '').slice(0, 6));
            setError(null);
          }}
          inputMode="numeric"
          autoComplete="off"
          placeholder="000000"
          aria-label="Six-digit contest code"
        />
        <button type="submit" className="btn btn--primary" disabled={code.length !== 6 || busy}>
          {busy ? <span className="spinner" /> : 'Join'}
        </button>
      </div>
      {error ? <Banner tone="bad">{error}</Banner> : null}
    </form>
  );
}

/** A contest waiting for this name, joinable without a code. */
function Invitation({ contest, uid, myKey }: { contest: Contest; uid: string; myKey: string }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  // Named personally, or simply in the same circle. Saying "invited you" for a
  // contest nobody invited them to is a small lie that reads as a bug.
  const named = Boolean(myKey && (contest.inviteKeys ?? []).includes(myKey));

  return (
    <div className="card card--tight row row--between" style={{ gap: 10 }}>
      <span style={{ minWidth: 0 }}>
        <span style={{ fontWeight: 800, display: 'block' }}>{contest.name}</span>
        <span className="tiny faint">
          {named
            ? contest.ownerName
              ? `${contest.ownerName} invited you`
              : 'You have been invited'
            : contest.ownerName
              ? `${contest.ownerName} started this`
              : 'Open to your pool'}
          {contest.wager ? ` · ${formatWager(contest.wager.amount)} a player` : ''} ·{' '}
          {rosterSummary(contest.rosterSlots)} · locks {formatDateTime(contest.lockTime)}
        </span>
      </span>
      <span className="row" style={{ gap: 6, flex: 'none' }}>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            // Only off the invitation list: their code still works if they
            // change their mind.
            void declineInvitation(contest.id, uid);
          }}
        >
          <span className="tiny faint">No thanks</span>
        </button>
        <button
          type="button"
          className="btn btn--sm btn--primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            // The write syncs on its own; opening the contest need not wait.
            void joinContest(contest.id, uid);
            navigate(`/contest/${contest.id}`);
          }}
        >
          Join
        </button>
      </span>
    </div>
  );
}
