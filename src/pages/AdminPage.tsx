import { useEffect, useState } from 'react';
import { Banner, Spinner } from '../components/ui';
import { FALLBACK_DEFAULTS, listenContestDefaults, saveContestDefaults, type ContestDefaults } from '../lib/defaults';
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
  return <main className="page">{isAdmin ? <DefaultsEditor /> : <PinGate />}</main>;
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
          <h1 style={{ fontSize: 22, fontWeight: 900 }}>Default settings</h1>
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
