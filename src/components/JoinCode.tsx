import { useEffect, useState } from 'react';
import type { Contest } from '../types';

/** The link that joins someone straight into the contest. */
export function inviteLink(contest: Contest): string {
  const base = `${window.location.origin}${import.meta.env.BASE_URL}`.replace(/\/+$/, '');
  return `${base}/contest/${contest.id}?j=${contest.joinCode}`;
}

/**
 * The contest's six digits and a way to pass them on.
 *
 * Share hands over a link that joins the contest on open, so nobody has to type
 * the code; the digits stay on screen for anyone being told them out loud.
 */
export function JoinCode({ contest, compact = false }: { contest: Contest; compact?: boolean }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (!contest.joinCode) return null;

  async function share() {
    const link = inviteLink(contest);
    const text = `Join "${contest.name}" on Fantasy Contests`;
    try {
      if (navigator.share) {
        await navigator.share({ title: contest.name, text, url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Dismissed share sheet or blocked clipboard: the digits are on screen.
    }
  }

  return (
    <div className={`joincode${compact ? ' joincode--inline' : ''}`}>
      <span className="joincode__label">Code</span>
      <span className={`joincode__digits${compact ? '' : ' joincode__digits--lg'}`}>{contest.joinCode}</span>
      <button
        type="button"
        className="btn btn--sm btn--ghost joincode__copy"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void share();
        }}
      >
        {copied ? 'Link copied ✓' : 'Share link'}
      </button>
    </div>
  );
}
