import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { deleteContest, duplicateContest, patchContest } from '../lib/db';
import { deriveStatus } from '../lib/engine/contestState';
import { Banner } from './ui';
import { PullLineButton } from './PullLineButton';
import { hasSpread } from '../lib/engine/spread';
import { useSession } from '../state/SessionContext';
import type { Contest } from '../types';

/**
 * Running a contest, kept out of the way.
 *
 * These belong to whoever started it and are not part of playing, so they live
 * on the contests page behind an edit button rather than sitting on top of the
 * contest itself.
 */
export function OwnerControls({ contest }: { contest: Contest }) {
  const navigate = useNavigate();
  const { uid, identity } = useSession();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = deriveStatus(contest);

  /** Same contest, different people: the copy lands on its invite step. */
  async function duplicate() {
    const name = window.prompt('Name for the copy', `${contest.name} (copy)`);
    if (name === null) return;
    setBusy(true);
    setError(null);
    try {
      const id = await duplicateContest(contest.id, { id: uid, name: identity?.displayName }, name);
      navigate(`/contest/${id}/edit?step=4`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not duplicate');
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${contest.name}" and every entry in it? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await deleteContest(contest.id);
      navigate('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
      setBusy(false);
    }
  }

  async function finalize() {
    setBusy(true);
    setError(null);
    try {
      await patchContest(contest.id, { status: 'complete', finalizedAt: new Date().toISOString() });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not finalize');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`ownerctl${open ? ' ownerctl--open' : ''}`}>
      <button
        type="button"
        className={`btn btn--sm${open ? ' btn--primary' : ' btn--ghost'}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {open ? 'Done' : 'Edit'}
      </button>

      {open ? (
        <div className="ownerctl__menu">
          {status === 'open' ? (
            <Link to={`/contest/${contest.id}/edit`} className="btn btn--sm">
              Contest settings
            </Link>
          ) : (
            <span className="tiny faint">Settings locked — the contest has started.</span>
          )}
          <Link to={`/contest/${contest.id}/live`} className="btn btn--sm">
            Live scoring
          </Link>
          <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void duplicate()}>
            Duplicate
          </button>
          {status !== 'complete' ? (
            <button type="button" className="btn btn--sm btn--ghost" disabled={busy} onClick={() => void finalize()}>
              Mark final
            </button>
          ) : null}
          <button type="button" className="btn btn--sm btn--danger" disabled={busy} onClick={() => void remove()}>
            Delete
          </button>
          {status === 'open' && contest.gameWinner.enabled && contest.games.some((game) => !hasSpread(game)) ? (
            <div style={{ flex: '1 1 100%' }}>
              <div className="tiny faint">
                {contest.games.filter((game) => !hasSpread(game)).length} game(s) still have no spread.
              </div>
              <PullLineButton contestId={contest.id} />
            </div>
          ) : null}
          {error ? <Banner tone="bad">{error}</Banner> : null}
        </div>
      ) : null}
    </div>
  );
}
