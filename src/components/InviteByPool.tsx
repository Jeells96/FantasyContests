import { useMemo, useState } from 'react';
import type { Person, Pool } from '../lib/people';
import type { ContestInvite } from '../types';

/**
 * Inviting a circle rather than a list of names.
 *
 * A pool already is the guest list — picking its members off one at a time was
 * work with a foregone conclusion. One button invites everyone in it; someone
 * who belongs to more than one is asked which, since that is the only thing
 * about it that is genuinely a decision.
 *
 * Invitations are separate from a contest simply being open to a pool: these
 * name people, so they show up as "X invited you" and reach anyone whose pools
 * the contest was not stamped with.
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
  const [choosing, setChoosing] = useState(false);

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
    setChoosing(false);
  };

  const nameOf = (poolId: string) => pools.find((pool) => pool.id === poolId)?.name ?? poolId;

  return (
    <div className="card">
      <div className="section-title">
        <h2 style={{ fontSize: 15 }}>Invite people</h2>
        {invites.length > 0 ? (
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => onChange([])}>
            Clear
          </button>
        ) : null}
      </div>

      {invites.length > 0 ? (
        <p className="tiny muted" style={{ margin: '0 0 10px' }}>
          Inviting {invites.length} {invites.length === 1 ? 'person' : 'people'}:{' '}
          {invites.map((entry) => entry.displayName).join(', ')}.
        </p>
      ) : (
        <p className="tiny muted" style={{ margin: '0 0 10px' }}>
          Everyone in your pool can already find this contest. Inviting them puts it at the top of their list
          with your name on it.
        </p>
      )}

      {myPools.length === 1 || choosing ? null : (
        <button
          type="button"
          className="btn btn--block"
          onClick={() => (myPools.length === 1 ? invite(myPools[0]) : setChoosing(true))}
        >
          Send invites to other users
        </button>
      )}

      {myPools.length === 1 ? (
        <button type="button" className="btn btn--block" onClick={() => invite(myPools[0])}>
          Send invites to {nameOf(myPools[0])} ({membersOf(myPools[0]).length})
        </button>
      ) : null}

      {choosing ? (
        <div className="stack" style={{ gap: 6 }}>
          <span className="tiny faint">Which pool?</span>
          {myPools.map((poolId) => (
            <button key={poolId} type="button" className="btn btn--block" onClick={() => invite(poolId)}>
              {nameOf(poolId)} · {membersOf(poolId).length} people
            </button>
          ))}
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setChoosing(false)}>
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}
