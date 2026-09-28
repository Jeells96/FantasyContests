import { useState } from 'react';
import { pullMissingSpreads } from '../hooks/usePendingSpreads';

/**
 * Ask the odds feed for a line now, rather than waiting for the check that
 * runs while a contest is open. What it finds is written to the contest, so
 * the pick opens for everyone at once.
 */
export function PullLineButton({ contestId }: { contestId: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function pull() {
    setBusy(true);
    setResult(null);
    try {
      const found = await pullMissingSpreads(contestId);
      setResult(
        found > 0
          ? `Got ${found} line${found === 1 ? '' : 's'}.`
          : 'No line posted for it yet. Try again closer to kickoff.',
      );
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'Could not reach the odds feed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row row--wrap" style={{ gap: 8, marginTop: 8 }}>
      <button type="button" className="btn btn--sm btn--primary" disabled={busy} onClick={() => void pull()}>
        {busy ? <span className="spinner spinner--xs" /> : null}
        {busy ? 'Checking…' : 'Pull line now'}
      </button>
      {result ? <span className="tiny muted">{result}</span> : null}
    </div>
  );
}
