import type { ObsKind, RegobsObs, RegobsTest } from '../types';

/**
 * Regobs signs near a point: the danger signs, avalanches and poor stability
 * tests reported in the region lately, each weighted by how close it was to
 * the point's height and aspect (Rules 4, 19 and 20 in the tourit rules note).
 *
 * Weighting (our own choice, untested):
 * - height: within HEIGHT_NEAR_M of the point counts 1, within HEIGHT_MID_M
 *   0.5, further away 0.25;
 * - aspect (only avalanche reports give one): the point's aspect or a
 *   neighbouring one counts 1, any other 0.5;
 * - whatever a report or the point doesn't tell counts 1, the cautious choice.
 * A group of signs is "on" when its weights add up to ON_SCORE: one report
 * near the point's height and aspect, or several further away. Each report
 * counts once per group.
 *
 * Pure: type imports only, so `node --test` can load it as it is.
 */

const NO_ACTIVITY = /ingen skredaktivitet/i;

/** Avalanche > danger sign > anything else. */
export function obsKind(o: RegobsObs): ObsKind {
  if (o.AvalancheObs) return 'skred';
  if ((o.AvalancheActivityObs2 ?? []).some((a) => !NO_ACTIVITY.test(a.EstimatedNumName ?? ''))) return 'skred';
  // DangerSignTID ending in 01 = "Ingen faretegn observert"
  if ((o.DangerObs ?? []).some((d) => d.DangerSignTID && d.DangerSignTID % 100 !== 1)) return 'tegn';
  return 'obs';
}

export type SignKind = 'avalanche' | 'whumpf' | 'cracks' | 'poorTest' | 'windSnow' | 'heavySnow' | 'warming' | 'wetSnow' | 'glide';

export const SIGN_LABEL: Record<SignKind, string> = {
  avalanche: 'ferske skred',
  whumpf: 'drønn i snøen',
  cracks: 'skytende sprekker',
  poorTest: 'dårlig stabilitetstest (ECT)',
  windSnow: 'fersk vindtransportert snø',
  heavySnow: 'stort snøfall',
  warming: 'rask temperaturstigning eller snøsmelting',
  wetSnow: 'mye vann i snøen',
  glide: 'ferske glidesprekker',
};

/** Regobs danger signs, by DangerSignTID % 100 (checked against last season's reports). */
const DANGER_SIGN: Record<number, SignKind> = {
  2: 'avalanche',
  3: 'whumpf',
  5: 'heavySnow',
  7: 'warming',
  8: 'wetSnow',
  9: 'windSnow',
  14: 'cracks',
  15: 'glide',
  17: 'wetSnow', // blå-grå farge i snøen
  19: 'warming', // intens snøsmelting
};

/** Signs that the snowpack is unstable now: they move the danger level up one (Rule 19). */
export const INSTABILITY: SignKind[] = ['avalanche', 'whumpf', 'cracks'];

/** How far back signs count, hours. */
export const SIGNS_H = 48;
export const HEIGHT_NEAR_M = 200;
export const HEIGHT_MID_M = 500;
export const ON_SCORE = 1;

/**
 * SLF's four classes for the extended column test (Techel et al. 2020):
 * 1 poor, 2 poor to fair, 3 fair, 4 good. null when it isn't an ECT or lacks the taps.
 */
export function ectClass(t: RegobsTest): 1 | 2 | 3 | 4 | null {
  switch (t.PropagationTID) {
    case 21: // ECTPV: propagated while isolating the column
      return 1;
    case 22: {
      const n = t.TapsFracture ?? t.TapsFullPropagation;
      return n == null ? null : n <= 13 ? 1 : n <= 22 ? 2 : 3;
    }
    case 23: {
      const n = t.TapsFracture;
      return n == null ? null : n <= 10 ? 3 : 4;
    }
    case 24: // ECTX: no fracture
      return 4;
    default:
      return null;
  }
}

/** Where the signs are judged for: the point's height (m) and aspect sector (0–7, from north). */
export interface SignPoint {
  elev?: number | null;
  sector?: number | null;
}

export interface SignHit {
  kind: SignKind;
  obs: RegobsObs;
  /** 0.25–1, see the module comment. */
  weight: number;
  /** When it happened (the avalanche) or was seen, ms. */
  time: number;
}

const ms = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);

/** When the avalanche happened, if the report says; else when it was reported. */
function avalancheTime(o: RegobsObs): number {
  const times = [ms(o.AvalancheObs?.DtAvalancheTime), ...(o.AvalancheActivityObs2 ?? []).map((a) => ms(a.DtEnd))].filter(Number.isFinite);
  return times.length ? Math.max(...times) : ms(o.DtObsTime);
}

function exposition(o: RegobsObs): string | null {
  const all = [o.AvalancheObs?.ValidExposition, ...(o.AvalancheActivityObs2 ?? []).map((a) => a.ValidExposition)];
  return all.find((e): e is string => typeof e === 'string' && /^[01]{8}$/.test(e) && e.includes('1')) ?? null;
}

/** How much one report counts for the point (see the module comment). */
export function weightFor(o: RegobsObs, at: SignPoint): number {
  let w = 1;
  const start = o.AvalancheObs?.HeightStartZone;
  const h = start != null && start > 0 ? start : o.ObsLocation?.Height;
  if (h != null && h > 0 && at.elev != null) {
    const d = Math.abs(h - at.elev);
    w *= d <= HEIGHT_NEAR_M ? 1 : d <= HEIGHT_MID_M ? 0.5 : 0.25;
  }
  const exp = exposition(o);
  if (exp && at.sector != null) {
    const s = at.sector;
    const near = [s, (s + 1) % 8, (s + 7) % 8].some((k) => exp[k] === '1');
    if (!near) w *= 0.5;
  }
  return w;
}

/**
 * The signs in `obs` (filter it to the region first) from the `hours` before
 * `end` (ms), each with its weight for the point.
 */
export function signsAt(obs: RegobsObs[], end: number, at: SignPoint, hours = SIGNS_H): SignHit[] {
  const from = end - hours * 3_600_000;
  const out: SignHit[] = [];
  for (const o of obs) {
    const seen = ms(o.DtObsTime);
    const kinds = new Map<SignKind, number>();
    if (obsKind(o) === 'skred') kinds.set('avalanche', avalancheTime(o));
    for (const d of o.DangerObs ?? []) {
      const k = d.DangerSignTID ? DANGER_SIGN[d.DangerSignTID % 100] : undefined;
      if (k && !kinds.has(k)) kinds.set(k, seen);
    }
    if ((o.CompressionTest ?? []).some((t) => (ectClass(t) ?? 5) <= 2)) kinds.set('poorTest', seen);
    if (!kinds.size) continue;
    const weight = weightFor(o, at);
    for (const [kind, time] of kinds) if (time > from && time <= end) out.push({ kind, obs: o, weight, time });
  }
  return out;
}

export interface SignGroup {
  /** Reports with any of the kinds. */
  n: number;
  /** Their weights added up, each report once. */
  score: number;
  /** score ≥ ON_SCORE */
  on: boolean;
  /** The kinds that were reported, in the order asked for. */
  kinds: SignKind[];
  /** Their labels (SIGN_LABEL). */
  labels: string[];
}

/** Reports with any of `kinds` among `hits`, and their weighted score. */
export function signGroup(hits: SignHit[], kinds: SignKind[]): SignGroup {
  const best = new Map<number, number>();
  const found = new Set<SignKind>();
  for (const h of hits) {
    if (!kinds.includes(h.kind)) continue;
    found.add(h.kind);
    best.set(h.obs.RegId, Math.max(best.get(h.obs.RegId) ?? 0, h.weight));
  }
  let score = 0;
  for (const w of best.values()) score += w;
  const present = kinds.filter((k) => found.has(k));
  return { n: best.size, score, on: score >= ON_SCORE, kinds: present, labels: present.map((k) => SIGN_LABEL[k]) };
}
