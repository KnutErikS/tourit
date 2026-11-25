import type { Picked, Region, RegobsObs } from './types';

export type Sport = 'ski' | 'surf' | 'climb';

/**
 * Shared, mutable app state. Kept deliberately small: modules read from it,
 * and main.ts is the only place that orchestrates updates + re-rendering.
 */
export const state = {
  /** Which sport the panel is set up for (ui/sport.ts). */
  sport: 'ski' as Sport,
  /** Selected warning date, YYYY-MM-DD. */
  date: '',
  regions: [] as Region[],
  /** Region containing the picked point (or null). */
  selected: null as Region | null,
  picked: null as Picked | null,
  obs: [] as RegobsObs[],
  /** The date `obs` was loaded for ('' = none yet); differs from `date` while a new day loads or after it failed. */
  obsDate: '',

  /** Avalanche layer: minimum slope angle counted as avalanche terrain. */
  thr: 30,
  /** Avalanche layer: show other steep terrain faintly. */
  showRest: true,
  /** Aspect layer: only colour slopes at least this steep. */
  aspMin: 25,
  /** Aspect + avalanche layers: hatch lee slopes of the last days' wind. */
  showLee: true,
};
