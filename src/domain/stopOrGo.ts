/**
 * Stop or Go, check 1: how steep may the slope be at today's danger level?
 *
 * The limit is set on the steepest ~20 × 20 m of the area that counts, and
 * the area grows with the danger level (Alpenverein Stop or Go; SLF's
 * Graphical Reduction Method):
 *
 *   1 Low           no general limit (single spots ≥ 40° can still release)
 *   2 Moderate      below 40° in the area of your track
 *   3 Considerable  below 35° on the whole slope
 *   4 High          below 30° on the whole slope, and stay out of runout zones
 *   5 Very high     as High
 *
 * Two adjustments to the level, before the limit is looked up:
 * - Outside the warning's core zone (aspect + height of every avalanche
 *   problem), use one level lower (SLF's "one-level rule").
 * - Signs of instability in the last 48 h (fresh avalanches, whumpfs,
 *   shooting cracks) move it one level up (SLF RiskCheck).
 *
 * Missing data never gives a more lenient answer than the data could:
 * - unknown core zone (no terrain yet) counts as inside;
 * - unknown signs (Regobs not loaded) keep the warning's level, but if the
 *   answer would be worse with signs, "go" becomes "caution";
 * - unknown runout (NVE's map couldn't be read) where runout counts turns
 *   "go" into "caution".
 * Each of them is said in the result.
 *
 * Pure: no imports at runtime, so `node --test` can load it as it is.
 * This is a planning aid, not a verdict on the slope.
 */

export type StopOrGoArea = 'track' | 'slope' | 'terrain';
export type StopOrGoStatus = 'go' | 'caution' | 'stop' | 'none';

export interface StopOrGoInput {
  /** Danger level from the warning (0 = no warning). */
  level: number;
  /**
   * The point's aspect and height fall inside at least one avalanche problem.
   * null = not known (no terrain yet): treated as inside, the cautious choice.
   */
  inCore: boolean | null;
  /** Signs of instability nearby in the last 48 h. null = not known (Regobs not loaded). */
  signs: boolean | null;
  /** Steepest 20 × 20 m around the point itself, degrees (null = no terrain data). */
  steepTrack: number | null;
  /** Steepest 20 × 20 m on the slope the point is on, degrees. */
  steepSlope: number | null;
  /**
   * The point lies in one of NVE's runout bands. null = not known (the map couldn't be
   * read); only asked for when runout can count (level 3 and up).
   */
  inRunout: boolean | null;
}

export interface StopOrGoResult {
  status: StopOrGoStatus;
  /** Danger level from the warning. */
  level: number;
  /** Level after the core-zone and danger-sign adjustments. */
  used: number;
  /** Slope limit for `used`, degrees; null = no general limit. */
  limit: number | null;
  area: StopOrGoArea;
  /** The steepness compared with the limit, degrees. */
  steepness: number | null;
  /** Why the level used differs from the warning's, one per adjustment (shown with an arrow). */
  adjustments: Adjustment[];
  /** Other short reasons in Norwegian (runout, single steep spots, missing data), most important first. */
  reasons: string[];
}

export interface Adjustment {
  /** down = one level lower, up = one higher, same = considered but no change. */
  dir: 'down' | 'up' | 'same';
  text: string;
}

/** Within this many degrees below the limit, say "caution": DEM slopes are good to a few degrees. */
export const MARGIN = 2;
/** Low danger: single spots this steep can still release. */
export const LOW_SPOT = 40;

export const LIMIT: Record<number, number | null> = { 1: null, 2: 40, 3: 35, 4: 30, 5: 30 };
const AREA: Record<number, StopOrGoArea> = { 1: 'track', 2: 'track', 3: 'slope', 4: 'terrain', 5: 'terrain' };

export const AREA_TEXT: Record<StopOrGoArea, string> = {
  track: 'der sporet går',
  slope: 'hele henget',
  terrain: 'hele terrenget, også utløpet',
};

/**
 * End (ms) of the window that danger signs are counted in, for the chosen day
 * (`YYYY-MM-DD`, local time): the end of that day, but never later than now.
 * So a past day looks at its own last 48 h, and today or a future day looks at
 * the 48 h up to now (tomorrow's plan should count what was seen today).
 */
export function signsEnd(date: string, now = Date.now()): number {
  return Math.min(new Date(date + 'T23:59:59').getTime(), now);
}

/** The level the limit is looked up with. Unknown core zone (null) counts as inside; unknown signs (null) as none. */
export function usedLevel(level: number, inCore: boolean | null, signs: boolean | null): number {
  if (level < 1) return 0;
  let l = level;
  if (inCore === false) l -= 1;
  if (signs) l += 1;
  return Math.min(5, Math.max(1, l));
}

/** Status for one level, before runout: the limit, the area it applies to and the steepness compared. */
function judge(used: number, i: StopOrGoInput) {
  const limit = LIMIT[used];
  const area = AREA[used];
  const steepness = area === 'track' ? i.steepTrack : i.steepSlope;
  let status: StopOrGoStatus;
  if (steepness === null) status = 'none';
  else if (limit === null) status = steepness >= LOW_SPOT ? 'caution' : 'go';
  else if (steepness >= limit) status = 'stop';
  else if (steepness >= limit - MARGIN) status = 'caution';
  else status = 'go';
  if (area === 'terrain' && i.inRunout === true && status !== 'none') status = 'stop';
  return { limit, area, steepness, status };
}

export function stopOrGo(i: StopOrGoInput): StopOrGoResult {
  const reasons: string[] = [];
  if (i.level < 1) {
    return { status: 'none', level: i.level, used: 0, limit: null, area: 'track', steepness: null, adjustments: [], reasons: ['Ingen snøskredvarsel for dagen.'] };
  }
  const used = usedLevel(i.level, i.inCore, i.signs);
  const { limit, area, steepness, status: judged } = judge(used, i);

  const adjustments: Adjustment[] = [];
  if (i.inCore === false) adjustments.push({ dir: 'down', text: 'Utenfor himmelretningene og høydene i varselet: én faregrad ned.' });
  if (i.inCore === null) adjustments.push({ dir: 'same', text: 'Kjenner ikke himmelretning og høyde for punktet: bruker faregraden i varselet.' });
  if (i.signs === true) adjustments.push({ dir: 'up', text: 'Faretegn i området siste 48 t: én faregrad opp.' });
  if (i.signs === null) adjustments.push({ dir: 'same', text: 'Mangler observasjoner fra Regobs: vet ikke om det er meldt faretegn i området siste 48 t.' });

  if (steepness === null) {
    reasons.unshift('Mangler terrengdata for punktet.');
    return { status: 'none', level: i.level, used, limit, area, steepness, adjustments, reasons };
  }

  let status = judged;
  if (area === 'terrain' && i.inRunout === true) reasons.unshift('Punktet ligger i utløpssone fra bratt terreng.');
  if (limit === null && status === 'caution') reasons.unshift(`Enkelte svært bratte punkt (≥ ${LOW_SPOT}°) kan løsne også ved faregrad 1.`);

  // Unknown signs: what would the answer be if there were some?
  const worst = i.signs === null ? judge(usedLevel(i.level, i.inCore, true), i) : null;
  if (worst && status === 'go' && worst.status !== 'go' && worst.limit !== null) {
    status = 'caution';
    reasons.push(`Uten Regobs: med faretegn i området ville grensen vært under ${worst.limit}° (${AREA_TEXT[worst.area]}).`);
  }
  // Unknown runout where runout counts (now, or with signs): can't say "go".
  if ((area === 'terrain' || worst?.area === 'terrain') && i.inRunout === null && status !== 'stop') {
    if (status === 'go') status = 'caution';
    reasons.push('Fikk ikke lest NVEs utløpskart: vet ikke om punktet ligger i en utløpssone.');
  }
  return { status, level: i.level, used, limit, area, steepness, adjustments, reasons };
}
