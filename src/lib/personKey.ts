/**
 * Matching people by name.
 *
 * Kept apart from the directory it serves so the scoring engine can collapse
 * two devices into one person without reaching for Firestore.
 */

/**
 * A name reduced to something that matches across devices: case, spacing and
 * punctuation are ignored, so "J.T. O'Neill" and "jt oneill" are one person.
 * Firestore field paths use dots, so the key never contains one.
 */
export function personKey(firstName: string, lastName: string): string {
  const clean = (value: string) =>
    value
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  const first = clean(firstName);
  const last = clean(lastName);
  return first && last ? `${first}-${last}` : '';
}

/**
 * The same key from a name already joined up, as an entry or a standing stores
 * it. Everything after the first word is the surname, so "Mary Anne Kelly"
 * keeps matching herself.
 */
export function displayKey(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  if (parts.length < 2) return '';
  return personKey(parts[0], parts.slice(1).join(' '));
}
