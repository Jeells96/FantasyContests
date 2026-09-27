import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Banner, Empty, Spinner, SportPill, StatusPill } from '../components/ui';
import { deleteContest, listenContests, patchContest } from '../lib/db';
import { deriveStatus, formatDateTime } from '../lib/engine/contestState';
import { rosterSummary } from '../lib/engine/roster';
import { formatMoney } from '../lib/engine/lineup';
import { useSession } from '../state/SessionContext';
import type { Contest } from '../types';

/**
 * Admin area. The PIN unlocks a dedicated Firebase Auth account; every write
 * below is checked again by the Firestore security rules, so an unlocked UI on
 * its own grants nothing.
 */
export function AdminPage() {
  const { isAdmin } = useSession();
  return <main className="page">{isAdmin ? <AdminDashboard /> : <PinGate />}</main>;
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
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      // Distinguish a wrong PIN from a project that is not set up, so a broken
      // configuration is not reported as a typo.
      setError(
        /user-not-found|configuration-not-found|operation-not-allowed/i.test(message)
          ? 'The admin account does not exist on this Firebase project yet — see the README "Admin bootstrap" section.'
          : /network|unavailable|timeout|failed to fetch/i.test(message)
            ? 'Cannot reach Firebase to verify the PIN. Check the connection and try again.'
            : /too-many-requests/i.test(message)
              ? 'Too many attempts. Wait a moment and try again.'
              : 'Incorrect PIN.',
      );
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
        <p className="muted tiny">Enter the admin PIN to manage contests.</p>
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

function AdminDashboard() {
  const { lockAdmin } = useSession();
  const [contests, setContests] = useState<Contest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(
    () =>
      listenContests(setContests, (e) => setError(e.message)),
    [],
  );

  async function remove(contest: Contest) {
    if (!window.confirm(`Delete "${contest.name}" and every entry in it? This cannot be undone.`)) return;
    setBusyId(contest.id);
    try {
      await deleteContest(contest.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusyId(null);
    }
  }

  async function finalize(contest: Contest) {
    setBusyId(contest.id);
    try {
      await patchContest(contest.id, { status: 'complete', finalizedAt: new Date().toISOString() });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not finalize');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="stack stack--lg">
      <div className="row row--between">
        <div>
          <div className="eyebrow">Admin</div>
          <h1 style={{ fontSize: 22, fontWeight: 900 }}>Contest management</h1>
        </div>
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => void lockAdmin()}>
          Lock admin
        </button>
      </div>

      <Link to="/admin/new" className="btn btn--primary btn--block">
        + Create contest
      </Link>

      {error ? <Banner tone="bad">{error}</Banner> : null}
      {contests === null ? <Spinner label="Loading…" /> : null}
      {contests?.length === 0 ? <Empty title="No contests yet" hint="Create your first contest above." /> : null}

      <div className="list">
        {(contests ?? []).map((contest) => {
          const status = deriveStatus(contest);
          return (
            <div className="card" key={contest.id}>
              <div className="row row--between" style={{ alignItems: 'flex-start', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800 }}>{contest.name}</div>
                  <div className="row row--wrap" style={{ gap: 6, marginTop: 6 }}>
                    {contest.sports.map((sport) => (
                      <SportPill key={sport} sport={sport} />
                    ))}
                    <span className="pill">{contest.games.length} games</span>
                    <span className="pill">{contest.playerCount} players</span>
                    <span className="pill">{formatMoney(contest.salaryCapInfo.cap)}</span>
                  </div>
                  <div className="tiny faint" style={{ marginTop: 6 }}>
                    {rosterSummary(contest.rosterSlots)} · locks {formatDateTime(contest.lockTime)} ·{' '}
                    {contest.entrantCount} entries
                  </div>
                </div>
                <StatusPill status={status} />
              </div>

              <div className="row row--wrap" style={{ gap: 8, marginTop: 12 }}>
                <Link to={`/admin/contest/${contest.id}`} className="btn btn--sm">
                  Edit
                </Link>
                <Link to={`/admin/live/${contest.id}`} className="btn btn--sm">
                  Live scoring
                </Link>
                <Link to={`/contest/${contest.id}`} className="btn btn--sm btn--ghost">
                  View
                </Link>
                {status !== 'complete' ? (
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost"
                    disabled={busyId === contest.id}
                    onClick={() => void finalize(contest)}
                  >
                    Mark final
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn--sm btn--danger"
                  disabled={busyId === contest.id}
                  onClick={() => void remove(contest)}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
