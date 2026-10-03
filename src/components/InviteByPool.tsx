import { useMemo } from 'react';
import type { Person, Pool } from '../lib/people';
import type { ContestInvite } from '../types';

/**
 * Opening a contest to the people you play with.
 *
 * A pool is already the guest list, so there is nothing to pick: one button
 * opens the contest to it. Nobody is named — the creator knows who they play
 * with, and a roll call of eleven friends is noise on the way to publishing.
 *
 * The pool is only named when someone belongs to more than one, because then
 * which group is a real question. Even then it asks which group, never which
 * people.
 *
 * Underneath this is still a list of invitations, which is what makes the
 * contest arrive with the creator's name on it rather than merely being
 * findable by the pool.
 */
export function InviteByPool({
  people,
  pools,
  myKey,
  invites,
  onChange,
}: {
  people: Record<string, Person>;
  pools: Pool[];
  myKey: string;
  invites: ContestInvite[];
  onChange: (invites: ContestInvite[]) => void;
}) {
  const myPools = people[myKey]?.pools ?? [];

  const membersOf = useMemo(
    () => (poolId: string) =>
      Object.values(people)
        .filter((person) => person.key !== myKey && person.pools.includes(poolId))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [people, myKey],
  );

  if (myPools.length === 0) return null;

  const invite = (poolId: string) => {
    const next = membersOf(poolId).map((person) => ({
      key: person.key,
      firstName: person.firstName,
      lastName: person.lastName,
      displayName: person.displayName,
    }));
    // Added to whoever is already invited, so inviting a second pool keeps the first.
    const byKey = new Map(invites.map((entry) => [entry.key, entry]));
    for (const entry of next) byKey.set(entry.key, entry);
    onChange([...byKey.values()]);
  };

  const nameOf = (poolId: string) => pools.find((pool) => pool.id === poolId)?.name ?? poolId;
  /** Which of this person's pools are already fully invited. */
  const invitedKeys = new Set(invites.map((entry) => entry.key));
  const invitedPools = myPools.filter((poolId) => {
    const members = membersOf(poolId);
    return members.length > 0 && members.every((person) => invitedKeys.has(person.key));
  });
  const single = myPools.length === 1;

  return (
    <div className="card">
      <div className="section-title">
        <h2 style={{ fontSize: 15 }}>Who can join</h2>
        {invites.length > 0 ? (
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => onChange([])}>
            Undo
          </button>
        ) : null}
      </div>

      {/*
       * One pool is not a choice, so it is not presented as one: no group to
       * name and no roll call of people the creator already knows they are
       * playing with. Belonging to two is the only time the group matters, and
       * then the question is only which — never which people.
       */}
      {single ? (
        <>
          <p className="tiny muted" style={{ margin: '0 0 10px' }}>
            {invites.length > 0
              ? 'Anyone you play with can join this contest, and it will be waiting at the top of their list.'
              : 'Your contest is already visible to the people you play with. Letting them join puts it at the top of their list with your name on it.'}
          </p>
          {invites.length === 0 ? (
            <button type="button" className="btn btn--block" onClick={() => invite(myPools[0])}>
              Allow anyone to join
            </button>
          ) : null}
        </>
      ) : (
        <>
          <p className="tiny muted" style={{ margin: '0 0 10px' }}>
            {invitedPools.length > 0
              ? `Open to ${invitedPools.map(nameOf).join(' and ')}.`
              : 'Choose which group you are opening this contest to.'}
          </p>
          <div className="stack" style={{ gap: 6 }}>
            {myPools.map((poolId) => {
              const already = invitedPools.includes(poolId);
              return (
                <button
                  key={poolId}
                  type="button"
                  className={`btn btn--block${already ? ' btn--primary' : ''}`}
                  onClick={() => invite(poolId)}
                  disabled={already}
                  aria-pressed={already}
                >
                  {already ? `${nameOf(poolId)} ✓` : `Allow ${nameOf(poolId)} to join`}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
