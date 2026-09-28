import { useEffect, useState } from 'react';
import { Banner, Spinner } from '../components/ui';
import { FALLBACK_DEFAULTS, listenContestDefaults, saveContestDefaults, type ContestDefaults } from '../lib/defaults';
import {
  forgetPerson,
  listenPeople,
  listenPools,
  savePools,
  setPersonPools,
  type Person,
  type Pool,
} from '../lib/people';
import { DEFAULT_ROSTER_SIZE } from '../lib/engine/roster';
import { useSession } from '../state/SessionContext';
import type { Sport } from '../types';

const SPORTS: Sport[] = ['nfl', 'mlb', 'nba'];

/**
 * Admin area.
 *
 * Contests are no longer run from here — anyone can start one. What the PIN
 * protects is the house settings every new contest opens with.
 */
export function AdminPage() {
  const { isAdmin } = useSession();
  return (
    <main className="page">
      {isAdmin ? (
        <div className="stack stack--lg">
          <PoolsEditor />
          <DefaultsEditor />
        </div>
      ) : (
        <PinGate />
      )}
    </main>
  );
}

/**
 * Pools decide who can invite whom.
 *
 * Someone in a pool can invite the other people in it and sees them listed
 * when they start a contest. Someone in no pool never sees inviting at all and
 * never appears as an option — and is told nothing about it either way.
 */
function PoolsEditor() {
  const [pools, setPools] = useState<Pool[] | null>(null);
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => listenPools(setPools, (e) => setError(e.message)), []);
  useEffect(() => listenPeople(setPeople, (e) => setError(e.message)), []);

  async function addPool(event: React.FormEvent) {
    event.preventDefault();
    const label = name.trim();
    if (label === '' || !pools) return;
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (id === '' || pools.some((pool) => pool.id === id)) {
      setError('There is already a pool with that name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await savePools([...pools, { id, name: label }]);
      setName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  async function removePool(pool: Pool) {
    if (!pools) return;
    if (!window.confirm(`Delete the "${pool.name}" pool? Everyone in it loses invites.`)) return;
    setBusy(true);
    try {
      await savePools(pools.filter((entry) => entry.id !== pool.id));
      // Leave nobody pointing at a pool that no longer exists.
      for (const person of Object.values(people)) {
        if (person.pools.includes(pool.id)) {
          await setPersonPools(person.key, person.pools.filter((id) => id !== pool.id));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(person: Person, poolId: string) {
    const next = person.pools.includes(poolId)
      ? person.pools.filter((id) => id !== poolId)
      : [...person.pools, poolId];
    setBusy(true);
    setError(null);
    try {
      await setPersonPools(person.key, next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  const roster = Object.values(people).sort((a, b) => a.displayName.localeCompare(b.displayName));

  return (
    <div className="stack">
      <div>
        <div className="eyebrow">Admin</div>
        <h1 style={{ fontSize: 22, fontWeight: 900 }}>Pools and invites</h1>
        <p className="tiny muted" style={{ margin: '6px 0 0' }}>
          People in a pool can invite each other to contests and see each other listed. Anyone not in a pool
          never sees the invite option and never appears as one — nothing tells them either way. Everyone can
          still start contests and share them by code.
        </p>
      </div>

      {error ? <Banner tone="bad">{error}</Banner> : null}

      <div className="card stack">
        <div className="label" style={{ margin: 0 }}>
          Pools
        </div>
        <div className="row row--wrap" style={{ gap: 6 }}>
          {(pools ?? []).map((pool) => (
            <span key={pool.id} className="pill">
              {pool.name}
              <button
                type="button"
                className="pill__x"
                disabled={busy}
                onClick={() => void removePool(pool)}
                aria-label={`Delete ${pool.name}`}
              >
                ✕
              </button>
            </span>
          ))}
          {pools !== null && pools.length === 0 ? <span className="tiny faint">No pools yet.</span> : null}
        </div>
        <form className="row" style={{ gap: 8 }} onSubmit={addPool}>
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Friends and family"
            aria-label="New pool name"
          />
          <button type="submit" className="btn btn--sm btn--primary" disabled={busy || name.trim() === ''}>
            Add
          </button>
        </form>
      </div>

      <div className="card stack">
        <div className="row row--between">
          <div className="label" style={{ margin: 0 }}>
            People who have used the site
          </div>
          <span className="tiny faint">{roster.length}</span>
        </div>
        {roster.length === 0 ? (
          <p className="tiny faint" style={{ margin: 0 }}>
            Nobody yet. A name appears here the first time someone enters it.
          </p>
        ) : (
          <div className="list">
            {roster.map((person) => (
              <div className="card card--tight" key={person.key}>
                <div className="row row--between" style={{ gap: 8 }}>
                  <span style={{ fontWeight: 800, minWidth: 0 }}>
                    {person.displayName}
                    <button
                      type="button"
                      className="pill__x"
                      disabled={busy}
                      title="Remove this name from the list"
                      onClick={() => {
                        if (window.confirm(`Remove ${person.displayName} from the list?`)) {
                          void forgetPerson(person.key);
                        }
                      }}
                    >
                      ✕
                    </button>
                  </span>
                  <span className="tiny faint">
                    {person.pools.length === 0
                      ? 'no pool'
                      : person.pools
                          .map((id) => (pools ?? []).find((pool) => pool.id === id)?.name ?? id)
                          .join(' · ')}
                  </span>
                </div>
                <div className="row row--wrap" style={{ gap: 6, marginTop: 8 }}>
                  {(pools ?? []).map((pool) => (
                    <button
                      key={pool.id}
                      type="button"
                      className={`btn btn--sm${person.pools.includes(pool.id) ? ' btn--primary' : ''}`}
                      disabled={busy}
                      onClick={() => void toggle(person, pool.id)}
                    >
                      {pool.name}
                    </button>
                  ))}
                  {(pools ?? []).length === 0 ? (
                    <span className="tiny faint">Add a pool above first.</span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PinGate() {
  const { unlockAdmin } = useSession();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await unlockAdmin(pin);
    } catch {
      setError('Incorrect PIN.');
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ maxWidth: 360, margin: '8vh auto 0' }}>
      <div className="center">
        <div className="eyebrow">Restricted</div>
        <h1 style={{ fontSize: 22, fontWeight: 900 }}>Admin access</h1>
        <p className="muted tiny">
          Enter the admin PIN to change the settings new contests start with. You do not need this to
          start a contest.
        </p>
      </div>
      <form className="stack" onSubmit={submit}>
        <input
          className="input input--pin"
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 8))}
          inputMode="numeric"
          autoComplete="off"
          placeholder="••••"
          aria-label="Admin PIN"
          autoFocus
        />
        {error ? <Banner tone="bad">{error}</Banner> : null}
        <button type="submit" className="btn btn--primary btn--block" disabled={pin.length < 4 || busy}>
          {busy ? <span className="spinner" /> : 'Unlock'}
        </button>
      </form>
    </div>
  );
}

function DefaultsEditor() {
  const { lockAdmin, uid } = useSession();
  const [draft, setDraft] = useState<ContestDefaults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(
    () =>
      listenContestDefaults(
        (next) => setDraft((current) => current ?? next),
        (e) => setError(e.message),
      ),
    [],
  );

  function update(patch: Partial<ContestDefaults>) {
    setSaved(false);
    setDraft((current) => ({ ...(current ?? FALLBACK_DEFAULTS), ...patch }));
  }

  function toggleSport(sport: Sport) {
    if (!draft) return;
    const next = draft.sports.includes(sport)
      ? draft.sports.filter((value) => value !== sport)
      : [...draft.sports, sport];
    // At least one sport, or the game picker has nothing to load.
    update({ sports: next.length > 0 ? next : draft.sports });
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await saveContestDefaults(draft, uid);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  if (!draft) return <Spinner label="Loading settings…" />;

  const rosterHint =
    draft.rosterSpots > 0
      ? `${draft.rosterSpots} spots`
      : `the usual size (NFL ${DEFAULT_ROSTER_SIZE.nfl}, MLB ${DEFAULT_ROSTER_SIZE.mlb}, NBA ${DEFAULT_ROSTER_SIZE.nba})`;

  return (
    <div className="stack stack--lg">
      <div className="row row--between">
        <div>
          <div className="eyebrow">Admin</div>
          <h2 style={{ fontSize: 20, fontWeight: 900 }}>Default settings</h2>
        </div>
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => void lockAdmin()}>
          Lock admin
        </button>
      </div>

      <p className="tiny muted" style={{ margin: 0 }}>
        Anyone can start a contest. These are the settings their builder opens with — whoever starts a
        contest can still change any of it before publishing.
      </p>

      {error ? <Banner tone="bad">{error}</Banner> : null}

      <div className="card stack">
        <div>
          <div className="label">Sports selected to start</div>
          <div className="row row--wrap" style={{ gap: 8, marginTop: 8 }}>
            {SPORTS.map((sport) => (
              <button
                key={sport}
                type="button"
                className={`btn btn--sm${draft.sports.includes(sport) ? ' btn--primary' : ''}`}
                onClick={() => toggleSport(sport)}
              >
                {sport.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span className="label">Days of games to load</span>
          <input
            className="input"
            type="number"
            min={1}
            max={14}
            value={draft.days}
            onChange={(event) => update({ days: clamp(Number(event.target.value), 1, 14) })}
          />
          <span className="tiny faint">How far ahead the game picker looks from the chosen date.</span>
        </label>

        <label className="field">
          <span className="label">Roster spots</span>
          <input
            className="input"
            type="number"
            min={0}
            max={12}
            value={draft.rosterSpots}
            onChange={(event) => update({ rosterSpots: clamp(Number(event.target.value), 0, 12) })}
          />
          <span className="tiny faint">0 means use {rosterHint}.</span>
        </label>
      </div>

      <div className="card stack">
        <label className="row row--between">
          <span className="label" style={{ margin: 0 }}>
            Team captain on by default
          </span>
          <input
            type="checkbox"
            checked={draft.captainEnabled}
            onChange={(event) => update({ captainEnabled: event.target.checked })}
          />
        </label>
        <label className="field">
          <span className="label">Captain multiplier</span>
          <input
            className="input"
            type="number"
            step={0.1}
            min={1}
            max={3}
            value={draft.captainMultiplier}
            onChange={(event) => update({ captainMultiplier: clamp(Number(event.target.value), 1, 3) })}
          />
          <span className="tiny faint">Captains cost this much more and score this much more.</span>
        </label>
      </div>

      <div className="card stack">
        <label className="row row--between">
          <span className="label" style={{ margin: 0 }}>
            Game-winner picks on by default
          </span>
          <input
            type="checkbox"
            checked={draft.gameWinnerEnabled}
            onChange={(event) => update({ gameWinnerEnabled: event.target.checked })}
          />
        </label>
        <label className="field">
          <span className="label">Bonus per correct pick</span>
          <input
            className="input"
            type="number"
            step={0.5}
            min={0}
            max={50}
            value={draft.bonusPercent}
            onChange={(event) => update({ bonusPercent: clamp(Number(event.target.value), 0, 50) })}
          />
          <span className="tiny faint">Percent of a median lineup's score, per pick against the spread.</span>
        </label>
      </div>

      <button type="button" className="btn btn--primary btn--block" disabled={saving} onClick={() => void save()}>
        {saving ? <span className="spinner" /> : saved ? 'Saved ✓' : 'Save defaults'}
      </button>

      {draft.updatedAt ? (
        <div className="tiny faint center">Last changed {new Date(draft.updatedAt).toLocaleString()}</div>
      ) : null}
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
