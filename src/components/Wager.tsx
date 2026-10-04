import type { Contest, LeaderboardRow, Standing } from '../types';
import { formatWager } from '../lib/engine/wager';

/**
 * Asking whether someone is in on the money.
 *
 * Shown before they have entered, because taking the bet is part of entering,
 * and left visible afterwards so it can be changed right up to lock. Saying no
 * is a first-class answer: the contest is still theirs to play.
 */
export function WagerPrompt({
  contest,
  answer,
  onAnswer,
  locked,
  bettors,
}: {
  contest: Contest;
  answer: boolean | null;
  onAnswer: (value: boolean) => void;
  locked: boolean;
  /** How many people are in so far, this person's own answer included. */
  bettors: number;
}) {
  if (!contest.wager) return null;
  const amount = formatWager(contest.wager.amount);
  const pot = formatWager(contest.wager.amount * bettors);

  return (
    <div className={`card wager-card${answer === null ? ' wager-card--asking' : ''}`}>
      <div className="row row--between" style={{ gap: 10, alignItems: 'flex-start' }}>
        <span style={{ minWidth: 0 }}>
          <span className="eyebrow">Money on it</span>
          <div style={{ fontWeight: 800, fontSize: 15 }}>
            {amount} per person
            {contest.wager.note ? <span className="tiny faint"> · {contest.wager.note}</span> : null}
          </div>
          {/* What is actually on the table, which is the number people want. */}
          <div className="wager-pot">
            {bettors > 0 ? (
              <>
                <strong>{pot}</strong> pot · {bettors} {bettors === 1 ? 'person' : 'people'} in
              </>
            ) : (
              'Nobody is in yet.'
            )}
          </div>
          <p className="tiny faint" style={{ margin: '4px 0 0' }}>
            {answer === null
              ? 'Are you in? You can play either way — this only records who is betting.'
              : answer
                ? `You are in for ${amount}.`
                : 'You are playing for fun. Nothing is riding on it.'}
            {answer !== null && !locked ? ' You can change this until the first game starts.' : ''}
          </p>
        </span>
        <span className="row" style={{ gap: 6, flex: 'none' }}>
          <button
            type="button"
            className={`btn btn--sm${answer === false ? ' btn--primary' : ''}`}
            onClick={() => onAnswer(false)}
            disabled={locked}
            aria-pressed={answer === false}
          >
            For fun
          </button>
          <button
            type="button"
            className={`btn btn--sm${answer === true ? ' btn--primary' : ''}`}
            onClick={() => onAnswer(true)}
            disabled={locked}
            aria-pressed={answer === true}
          >
            I'm in 💰
          </button>
        </span>
      </div>
    </div>
  );
}

/**
 * Who owes the winner, and who has settled.
 *
 * Only shown once the contest is over, and only to the person owed — chasing
 * payment is their job, and a tally nobody can edit but them is the point. The
 * ticks live on the contest, so they survive the phone that made them.
 */
export function WagerSettlement({
  contest,
  rows,
  standings,
  uid,
  onTogglePaid,
}: {
  contest: Contest;
  rows: LeaderboardRow[];
  standings: Standing[];
  uid: string;
  onTogglePaid: (payerUid: string, paid: boolean) => void;
}) {
  if (!contest.wager) return null;
  const inById = new Map(standings.map((row) => [row.uid, row.wagerIn === true]));
  /*
   * The pot goes to the best finish among the people who put money in, which
   * is not always the contest's winner. Someone playing for fun can top the
   * leaderboard without being owed a penny, and the money then belongs to
   * whoever finished highest of those actually betting.
   *
   * Rows arrive in rank order, so the first one still in is that person.
   */
  const betting = rows.filter((row) => inById.get(row.uid));
  const winner = betting[0];
  if (!winner || betting.length < 2) return null;

  const amount = contest.wager.amount;
  const paid = new Set(contest.wagerPaid ?? []);
  const iWon = winner.uid === uid;
  const owing = betting.slice(1);
  /** Set when the contest was won by somebody who was not playing for money. */
  const leader = rows[0];
  const leaderSatOut = Boolean(leader && leader.uid !== winner.uid);
  const settled = owing.filter((row) => paid.has(row.uid)).length;

  // Someone who merely lost needs one line, not a ledger.
  if (!iWon) {
    const iOwe = inById.get(uid) === true && winner.uid !== uid;
    return (
      <div className="card">
        <div className="section-title">
          <h2 style={{ fontSize: 15 }}>Money</h2>
        </div>
        <p className="tiny muted" style={{ margin: 0 }}>
          {winner.teamName ?? winner.displayName} took the pot —{' '}
          {formatWager(amount * owing.length)} from {owing.length}{' '}
          {owing.length === 1 ? 'player' : 'players'}.
          {leaderSatOut
            ? ` ${leader.displayName} finished higher but was playing for fun.`
            : ''}
          {iOwe
            ? ` You owe ${winner.displayName} ${formatWager(amount)}${paid.has(uid) ? ' — marked paid.' : '.'}`
            : ''}
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="section-title">
        <h2 style={{ fontSize: 15 }}>You are owed</h2>
        <span className="tiny faint">
          {settled}/{owing.length} paid
        </span>
      </div>
      <div className="list">
        {owing.map((row) => {
          const isPaid = paid.has(row.uid);
          return (
            <label key={row.uid} className={`owes${isPaid ? ' owes--paid' : ''}`}>
              <input
                type="checkbox"
                checked={isPaid}
                onChange={(event) => onTogglePaid(row.uid, event.target.checked)}
              />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="owes__name">{row.displayName}</span>
                {row.teamName ? <span className="tiny faint"> · {row.teamName}</span> : null}
              </span>
              <span className="owes__amount num">{formatWager(amount)}</span>
            </label>
          );
        })}
      </div>
      <p className="tiny faint" style={{ margin: '8px 0 0' }}>
        {formatWager(amount * (owing.length - settled))} still out of{' '}
        {formatWager(amount * owing.length)}.
        {leaderSatOut
          ? ` You finished highest of everyone betting; ${leader.displayName} placed above you but was playing for fun.`
          : ''}{' '}
        Ticking someone off is just a note to yourself — no money moves through here.
      </p>
    </div>
  );
}
