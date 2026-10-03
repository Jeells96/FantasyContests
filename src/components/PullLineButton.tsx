import { useState } from 'react';
import { pullMissingSpreads } from '../hooks/usePendingSpreads';
import { ADMIN_PIN } from '../lib/firebase';
import { useSession } from '../state/SessionContext';

/**
 * Ask the odds feed for a line now, rather than waiting for the check that
 * runs while a contest is open. What it finds is written to the contest, so
 * the pick opens for everyone at once.
 *
 * Behind the admin PIN, because it is not a personal action: it changes the
 * contest for every entrant, and a line pulled early is one everybody is then
 * picking against. Unlocking the admin area once covers it for the session.
 */
export function PullLineButton({ contestId }: { contestId: string }) {
  const { isAdmin, unlockAdmin } = useSession();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);

  async function pull() {
    setBusy(true);
    setResult(null);
    setAsking(false);
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

  function submitPin(event: React.FormEvent) {
    event.preventDefault();
    if (pin.trim() !== ADMIN_PIN) {
      setPinError(true);
      return;
    }
    setPinError(false);
    setPin('');
    // Remembered for the session, so pulling a second line does not ask again.
    void unlockAdmin(ADMIN_PIN).catch(() => undefined);
    void pull();
  }

  if (asking && !isAdmin) {
    return (
      <form className="row row--wrap" style={{ gap: 8, marginTop: 8 }} onSubmit={submitPin}>
        <input
          className={`input input--num${pinError ? ' input--bad' : ''}`}
          style={{ maxWidth: 110 }}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          placeholder="PIN"
          aria-label="Admin PIN"
          value={pin}
          onChange={(event) => {
            setPin(event.target.value);
            setPinError(false);
          }}
        />
        <button type="submit" className="btn btn--sm btn--primary">
          Pull line
        </button>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={() => {
            setAsking(false);
            setPin('');
            setPinError(false);
          }}
        >
          <span className="tiny faint">Cancel</span>
        </button>
        {pinError ? <span className="tiny" style={{ color: 'var(--bad)' }}>Wrong PIN.</span> : null}
      </form>
    );
  }

  return (
    <div className="row row--wrap" style={{ gap: 8, marginTop: 8 }}>
      <button
        type="button"
        className="btn btn--sm btn--primary"
        disabled={busy}
        onClick={() => (isAdmin ? void pull() : setAsking(true))}
      >
        {busy ? <span className="spinner spinner--xs" /> : null}
        {busy ? 'Checking…' : 'Pull line now'}
      </button>
      {result ? <span className="tiny muted">{result}</span> : null}
    </div>
  );
}
