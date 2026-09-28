/**
 * House defaults for new contests.
 *
 * Anyone can start a contest, so the admin area no longer runs them — it sets
 * what a new contest starts out as. A creator can still change any of it on the
 * way through; these are only the values the builder opens with.
 */
import { doc, getDoc, onSnapshot, setDoc, type Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';
import { DEFAULT_CAPTAIN_MULTIPLIER } from './engine/captain';
import type { Sport } from '../types';

const CONFIG = 'config';
const DEFAULTS_DOC = 'defaults';

export interface ContestDefaults {
  /** Sports the game picker starts on. */
  sports: Sport[];
  /** How many days ahead the game picker looks. */
  days: number;
  /** Open roster spots; 0 means "use the usual size for the sport". */
  rosterSpots: number;
  captainEnabled: boolean;
  captainMultiplier: number;
  gameWinnerEnabled: boolean;
  /** Game-winner bonus, as a percentage of a median lineup's score. */
  bonusPercent: number;
  updatedAt?: string;
  updatedBy?: string;
}

export const FALLBACK_DEFAULTS: ContestDefaults = {
  sports: ['nfl'],
  days: 3,
  rosterSpots: 0,
  captainEnabled: true,
  captainMultiplier: DEFAULT_CAPTAIN_MULTIPLIER,
  gameWinnerEnabled: true,
  bonusPercent: 5,
};

function fromDoc(data: Record<string, unknown> | undefined): ContestDefaults {
  if (!data) return { ...FALLBACK_DEFAULTS };
  const sports = Array.isArray(data.sports) && data.sports.length > 0 ? (data.sports as Sport[]) : FALLBACK_DEFAULTS.sports;
  const number = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return {
    sports,
    days: number(data.days, FALLBACK_DEFAULTS.days),
    rosterSpots: number(data.rosterSpots, FALLBACK_DEFAULTS.rosterSpots),
    captainEnabled: data.captainEnabled !== false,
    captainMultiplier: number(data.captainMultiplier, FALLBACK_DEFAULTS.captainMultiplier),
    gameWinnerEnabled: data.gameWinnerEnabled !== false,
    bonusPercent: number(data.bonusPercent, FALLBACK_DEFAULTS.bonusPercent),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : undefined,
  };
}

/** Never blocks contest creation: an unreachable config falls back. */
export async function loadContestDefaults(): Promise<ContestDefaults> {
  try {
    const snapshot = await getDoc(doc(db, CONFIG, DEFAULTS_DOC));
    return fromDoc(snapshot.exists() ? (snapshot.data() as Record<string, unknown>) : undefined);
  } catch {
    return { ...FALLBACK_DEFAULTS };
  }
}

export function listenContestDefaults(
  onChange: (defaults: ContestDefaults) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, CONFIG, DEFAULTS_DOC),
    (snapshot) => onChange(fromDoc(snapshot.exists() ? (snapshot.data() as Record<string, unknown>) : undefined)),
    (error) => onError?.(error),
  );
}

export async function saveContestDefaults(defaults: ContestDefaults, updatedBy: string): Promise<void> {
  await setDoc(doc(db, CONFIG, DEFAULTS_DOC), {
    ...defaults,
    updatedAt: new Date().toISOString(),
    updatedBy,
  });
}
