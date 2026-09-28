import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { deleteContest, patchContest } from '../lib/db';
import { deriveStatus } from '../lib/engine/contestState';
import { Banner } from './ui';
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
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = deriveStatus(contest);

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
          {status !== 'complete' ? (
            <button type="button" className="btn btn--sm btn--ghost" disabled={busy} onClick={() => void finalize()}>
              Mark final
            </button>
          ) : null}
          <button type="button" className="btn btn--sm btn--danger" disabled={busy} onClick={() => void remove()}>
            Delete
          </button>
          {error ? <Banner tone="bad">{error}</Banner> : null}
        </div>
      ) : null}
    </div>
  );
}
