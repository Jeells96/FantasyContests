/**
 * Money riding on a contest.
 *
 * The app records an agreement; it never holds or moves anything. Amounts are
 * whole units of whatever currency the players use between themselves, so they
 * are formatted plainly rather than localised into a currency nobody chose.
 */
export function formatWager(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  const whole = Number.isInteger(rounded);
  return `$${whole ? rounded.toLocaleString('en-US') : rounded.toFixed(2)}`;
}

/** What the winner collects: everyone else who took the bet, at the stake. */
export function potFor(amount: number, bettors: number): number {
  return amount * Math.max(0, bettors - 1);
}
