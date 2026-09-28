import { useEffect, useMemo, useState } from 'react';
import { ContestCard } from '../components/ContestCard';
import { Empty, Spinner } from '../components/ui';
import { countEntrants, listenContests } from '../lib/db';
import { deriveStatus } from '../lib/engine/contestState';
import { enteredContests } from '../lib/identity';
import { useSession } from '../state/SessionContext';
import type { Contest, ContestStatus } from '../types';

const ORDER: ContestStatus[] = ['live', 'open', 'complete'];
const HEADINGS: Record<ContestStatus, string> = {
  live: 'Live now',
  open: 'Open contests',
  complete: 'Completed',
};

export function HomePage() {
  const { identity } = useSession();
  const [contests, setContests] = useState<Contest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [, setTick] = useState(0);
  const entered = useMemo(() => enteredContests(), []);

  useEffect(
    () =>
      listenContests(
        (next) => setContests(next),
        (e) => setError(e.message),
      ),
    [],
  );

  // Re-render every second so the countdown to lock runs here too, not only on
  // the contest page.
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Entry counts come from an aggregation query rather than the contest
  // document, which only an admin may write, so the number is live for users.
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
            One lineup per contest. Salaries, salary caps and cross-sport scoring are calculated
            automatically from the games in each contest.
          </p>
        </div>

        {error ? <div className="banner banner--bad">{error}</div> : null}
        {contests === null && !error ? <Spinner label="Loading contests…" /> : null}

        {contests !== null && contests.length === 0 ? (
          <Empty
            title="No contests yet"
            hint="An admin can create one from the Admin area using today's NFL, MLB or NBA games."
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
              <div className="grid grid--contests">
                {list.map((contest) => (
                  <ContestCard
                    key={contest.id}
                    contest={{ ...contest, entrantCount: counts[contest.id] ?? contest.entrantCount }}
                    entered={entered.has(contest.id)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
