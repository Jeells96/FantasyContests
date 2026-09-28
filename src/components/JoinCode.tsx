import { useEffect, useState } from 'react';
import type { Contest } from '../types';

/**
 * The contest's six digits, spelled out where everyone can see them. Sharing a
 * contest means reading this out or tapping Copy — there is nothing to memorize
 * and no link that would let a stranger in on its own.
 */
export function JoinCode({ contest, canShare = true }: { contest: Contest; canShare?: boolean }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (!contest.joinCode) return null;

  async function copy() {
    const text = `Join "${contest.name}" on Fantasy Contests with code ${contest.joinCode}`;
    try {
      // The share sheet is the natural way to send this from a phone.
      if (canShare && navigator.share) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(contest.joinCode);
      setCopied(true);
    } catch {
      // Dismissed share sheet or blocked clipboard: the digits are on screen.
    }
  }

  return (
    <div className="joincode">
      <span className="joincode__label">Join code</span>
      <span className="joincode__digits joincode__digits--lg">{contest.joinCode}</span>
      <button type="button" className="btn btn--sm btn--ghost joincode__copy" onClick={() => void copy()}>
        {copied ? 'Copied ✓' : 'Share'}
      </button>
    </div>
  );
}
