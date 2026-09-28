import { useState } from 'react';
import { personKey, type Person } from '../lib/people';
import type { ContestInvite } from '../types';

/**
 * Who to invite to a contest.
 *
 * The list is the people who share a pool with you. A name can also be typed
 * in, which is how somebody who has never opened the site gets invited: the
 * invitation waits for them and appears the first time they enter that name.
 */
export function InvitePicker({
  people,
  invites,
  onChange,
}: {
  people: Person[];
  invites: ContestInvite[];
  onChange: (invites: ContestInvite[]) => void;
}) {
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const chosen = new Set(invites.map((invite) => invite.key));

  function toggle(person: Person) {
    onChange(
      chosen.has(person.key)
        ? invites.filter((invite) => invite.key !== person.key)
        : [
            ...invites,
            {
              key: person.key,
              firstName: person.firstName,
              lastName: person.lastName,
              displayName: person.displayName,
            },
          ],
    );
  }

  function addTyped(event: React.FormEvent) {
    event.preventDefault();
    const key = personKey(first, last);
    if (key === '' || chosen.has(key)) {
      setFirst('');
      setLast('');
      return;
    }
    onChange([
      ...invites,
      {
        key,
        firstName: first.trim(),
        lastName: last.trim(),
        displayName: `${first.trim()} ${last.trim()}`,
      },
    ]);
    setFirst('');
    setLast('');
  }

  return (
    <div className="card stack">
      <div>
        <div className="label" style={{ margin: 0 }}>
          Invite people
        </div>
        <div className="tiny faint">
          Anyone invited sees this contest waiting for them with a Join button — no code to type. Everyone
          else still needs the code.
        </div>
      </div>

      {people.length > 0 ? (
        <div className="row row--wrap" style={{ gap: 6 }}>
          {people.map((person) => (
            <button
              key={person.key}
              type="button"
              className={`btn btn--sm${chosen.has(person.key) ? ' btn--primary' : ''}`}
              onClick={() => toggle(person)}
            >
              {person.displayName}
            </button>
          ))}
        </div>
      ) : null}

      <form className="row row--wrap" style={{ gap: 8 }} onSubmit={addTyped}>
        <input
          className="input"
          style={{ flex: '1 1 120px' }}
          value={first}
          onChange={(event) => setFirst(event.target.value)}
          placeholder="First name"
          aria-label="Invite first name"
        />
        <input
          className="input"
          style={{ flex: '1 1 120px' }}
          value={last}
          onChange={(event) => setLast(event.target.value)}
          placeholder="Last name"
          aria-label="Invite last name"
        />
        <button type="submit" className="btn btn--sm" disabled={personKey(first, last) === ''}>
          Invite
        </button>
      </form>

      {invites.length > 0 ? (
        <div className="row row--wrap" style={{ gap: 6 }}>
          {invites.map((invite) => (
            <span key={invite.key} className="pill pill--open">
              {invite.displayName}
              <button
                type="button"
                className="pill__x"
                onClick={() => onChange(invites.filter((entry) => entry.key !== invite.key))}
                aria-label={`Remove ${invite.displayName}`}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
