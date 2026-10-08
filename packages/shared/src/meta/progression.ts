import type { ClassId } from '../data/classes.ts';

/**
 * Bonds (§4.10, §4.12): the permanent currency. Earned from distance milestones,
 * landmarks cleared, finishing, and railroad bonds carried to the end.
 */
export const BONDS = {
  /** Per 10 km reached (8 at most). */
  perTenKm: 1,
  perLandmark: 3,
  finish: 10,
  /** Per railroad bond in your backpack when the run ends. */
  perBondItem: 3,
  /** Hard cap per run (sanity check on claims). */
  maxPerRun: 60,
} as const;

/** What one player brings home from a run. */
export interface RunAward {
  km: number;
  won: boolean;
  landmarks: number;
  bondItems: number;
}

export function bondsFor(a: RunAward): number {
  const km = Math.max(0, Math.min(80, a.km));
  const n =
    Math.floor(km / 10) * BONDS.perTenKm +
    Math.max(0, Math.min(3, a.landmarks)) * BONDS.perLandmark +
    (a.won ? BONDS.finish : 0) +
    Math.max(0, Math.min(5, a.bondItems)) * BONDS.perBondItem;
  return Math.min(BONDS.maxPerRun, n);
}

/** Lifetime stats kept with the account (§4.12). */
export interface LifetimeStats {
  runs: number;
  wins: number;
  bestKm: number;
  kills: number;
  landmarks: number;
  bounties: number;
  minutes: number;
}

export const EMPTY_STATS: LifetimeStats = {
  runs: 0,
  wins: 0,
  bestKm: 0,
  kills: 0,
  landmarks: 0,
  bounties: 0,
  minutes: 0,
};

/** The account as the client sees it. */
export interface Profile {
  id: string;
  username: string;
  guest: boolean;
  /** Linked sign-in providers. */
  providers: string[];
  bonds: number;
  classes: ClassId[];
  stats: LifetimeStats;
}

/** Sign-in providers (§4.12); 'dev' exists only on development servers. */
export type Provider = 'discord' | 'google' | 'github' | 'dev';
export const PROVIDERS: Provider[] = ['discord', 'google', 'github'];
