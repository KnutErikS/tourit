/**
 * Precipitation and temperature at a point, step by step, and what they say
 * about loading and thaw (Rules 4, 6 and 7 in the tourit rules note).
 *
 * - Rask oppbygging (Rule 6): at least RAPID_MM_H mm/h falling as snow for
 *   RAPID_RUN_H hours in a row, or at least RAPID_24H_MM mm of water in the
 *   last 24 h. Above ~2.5 mm/h loading outpaces settlement (Utah, 1960s);
 *   ~25 mm in 24 h is a red flag (avalanche.org).
 * - Ny last (Rule 4, "recent loading"): more than NEW_SNOW_CM of new snow in
 *   the last LOADING_H hours (McCammon 2004).
 * - Mildvær (Rule 4, "thaw"): above 0 °C or rain (at least THAW_RAIN_MM) in
 *   the hours that matter. THAW_RAIN_MM is our own.
 *
 * And the weather infos for the Verktøy tab (texts in domain/infos.ts):
 * - Kritisk nysnømengde (Rule 5): new snow over CRIT_H hours against the
 *   critical amount for the conditions (SLF, Alpenverein).
 * - Regn på snø, Første mildvær, Første fine dag (Rule 7: Varsom, SLF).
 * - Nattefrost (Rule 13): did it refreeze last night? Cut-offs from the rules
 *   note, our own starting values.
 *
 * Steps can be of any length (MET gives 1 h, later 6 h); a step that is only
 * partly inside a window counts by the part inside.
 *
 * Pure: no runtime imports.
 */

/** One step of weather at the point. */
export interface PrecipStep {
  /** Start, ms. */
  time: number;
  /** Length, hours (0 = no precipitation data, temperature only). */
  hours: number;
  /** °C */
  temp: number;
  /** Precipitation over the step, mm water. */
  precip: number;
  /** The part of it that fell as snow, mm water. */
  snowMm: number;
  /** Total cloud cover, % (at the start of the step), if known. */
  cloud?: number;
}

/**
 * History up to where the forecast starts, then the forecast: a history step
 * counts only if it ends by the forecast's first step (the forecast wins
 * where both have the hour). Without a forecast, all of the history counts.
 */
export function mergeSteps(history: PrecipStep[], forecast: PrecipStep[]): PrecipStep[] {
  const start = forecast.length ? Math.min(...forecast.map((s) => s.time)) : Infinity;
  const before = history.filter((s) => s.time + Math.max(s.hours, 0) * 3_600_000 <= start);
  return [...before, ...forecast].sort((a, b) => a.time - b.time);
}

export const LOADING_H = 48;
export const NEW_SNOW_CM = 15;
export const RAPID_MM_H = 2.5;
export const RAPID_RUN_H = 3;
export const RAPID_24H_MM = 25;
export const THAW_RAIN_MM = 0.5;

const HOUR = 3_600_000;

/** Centimetres of snow per mm of water: colder snow is lighter. */
export const cmPerMm = (t: number) => (t <= -10 ? 1.5 : t <= -4 ? 1.2 : t <= -1 ? 1.0 : 0.8);

/** Share (0–1) of a step that lies inside [from, to). */
export function inside(s: PrecipStep, from: number, to: number): number {
  if (s.hours <= 0) return 0;
  const a = Math.max(s.time, from), b = Math.min(s.time + s.hours * HOUR, to);
  return b > a ? (b - a) / (s.hours * HOUR) : 0;
}

/** Share (0–1) of [from, to) that steps with precipitation data cover (steps don't overlap). */
export function coverage(steps: PrecipStep[], from: number, to: number): number {
  return steps.reduce((a, s) => a + inside(s, from, to) * s.hours * HOUR, 0) / (to - from);
}
/** Coverage needed to judge a window: a few missing hours are fine, a missing day is not. */
const MIN_COVERAGE = 0.9;

/** New snow in [from, to), cm. */
export function newSnowCm(steps: PrecipStep[], from: number, to: number): number {
  return steps.reduce((a, s) => a + inside(s, from, to) * s.snowMm * cmPerMm(s.temp), 0);
}

export interface RapidLoading {
  on: boolean;
  /** Longest run at ≥ RAPID_MM_H mm/h as snow in the LOADING_H hours before the end, hours. */
  runH: number;
  /** runH ≥ RAPID_RUN_H */
  byRun: boolean;
  /** Precipitation in the last 24 h, mm water. */
  water24: number;
  /** water24 ≥ RAPID_24H_MM */
  byWater: boolean;
}

/** "Rask oppbygging" in the LOADING_H hours before `end` (ms). */
export function rapidLoading(steps: PrecipStep[], end: number): RapidLoading {
  const from = end - LOADING_H * HOUR;
  let run = 0, runH = 0, prevEnd = NaN;
  for (const s of [...steps].sort((a, b) => a.time - b.time)) {
    if (inside(s, from, end) <= 0) continue;
    const heavy = s.snowMm / s.hours >= RAPID_MM_H;
    run = heavy ? (Math.abs(s.time - prevEnd) < 60_000 ? run : 0) + s.hours : 0;
    runH = Math.max(runH, run);
    prevEnd = s.time + s.hours * HOUR;
  }
  const water24 = steps.reduce((a, s) => a + inside(s, end - 24 * HOUR, end) * s.precip, 0);
  const byRun = runH >= RAPID_RUN_H, byWater = water24 >= RAPID_24H_MM;
  return { on: byRun || byWater, runH, byRun, water24, byWater };
}

export interface Loading {
  /** New snow in the LOADING_H hours before the end, cm. */
  newSnowCm: number;
  /** newSnowCm > NEW_SNOW_CM */
  heavySnow: boolean;
  rapid: RapidLoading;
}

/** New snow and rask oppbygging in the LOADING_H hours before `end`; null when the steps don't cover them. */
export function loadingBefore(steps: PrecipStep[], end: number): Loading | null {
  const from = end - LOADING_H * HOUR;
  if (coverage(steps, from, end) < MIN_COVERAGE) return null;
  const cm = newSnowCm(steps, from, end);
  return { newSnowCm: cm, heavySnow: cm > NEW_SNOW_CM, rapid: rapidLoading(steps, end) };
}

export interface Thaw {
  on: boolean;
  /** Some step was above 0 °C. */
  warm: boolean;
  /** Warmest step, °C. */
  maxTemp: number;
  /** Rain (precipitation not falling as snow), mm. */
  rainMm: number;
  /** rainMm ≥ THAW_RAIN_MM */
  rain: boolean;
}

/** Mild weather or rain in [from, to); null when no step falls inside it. */
export function thaw(steps: PrecipStep[], from: number, to: number): Thaw | null {
  // Temperatures are instants: use every step that starts inside, or overlaps it.
  const temps = steps.filter((s) => (s.time >= from && s.time < to) || inside(s, from, to) > 0).map((s) => s.temp);
  if (!temps.length) return null;
  const maxTemp = Math.max(...temps);
  const rainMm = steps.reduce((a, s) => a + inside(s, from, to) * Math.max(0, s.precip - s.snowMm), 0);
  const warm = maxTemp > 0, rain = rainMm >= THAW_RAIN_MM;
  return { on: warm || rain, warm, maxTemp, rainMm, rain };
}

/* ---------- infos (Rules 5, 7, 13) ---------- */

/** Steps that start inside [from, to): for instants (temperature, cloud). */
const startingIn = (steps: PrecipStep[], from: number, to: number) => steps.filter((s) => s.time >= from && s.time < to);
/** Snowing: at least this many mm/h as snow. */
const SNOWING_MM_H = 0.1;
const snowing = (s: PrecipStep) => s.hours > 0 && s.snowMm / s.hours >= SNOWING_MM_H;
const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;

export const CRIT_H = 72;
/** Wind you can hear, ~40 km/h (SLF); here the 850 hPa wind. */
export const CRIT_WIND_MS = 11;
/** Cold snowfall: mean temperature below this, °C. */
export const CRIT_COLD_C = -8;
/** Show the new-snow info from this share of the critical amount; a warning from 1. */
export const CRIT_SHOW = 0.7;
export type CritClass = 'favourable' | 'average' | 'unfavourable';
/** Critical new snow, cm, by conditions (SLF "Achtung Lawinen", Alpenverein Stop or Go). */
export const CRIT_CM: Record<CritClass, [number, number]> = { favourable: [30, 50], average: [20, 30], unfavourable: [10, 20] };

/** The snow surface before the snowfall started (domain/wind.ts `surfaces`). */
export type SurfaceKind = 'fresh' | 'old' | 'crust' | 'wet';

export interface Critical {
  /** New snow over CRIT_H hours, cm. */
  cm: number;
  cls: CritClass;
  /** CRIT_CM[cls] */
  range: [number, number];
  /** cm / the low end of the range: cautious. */
  ratio: number;
  /** The unfavourable conditions found, in Norwegian. */
  factors: string[];
}

/**
 * New snow over the CRIT_H hours before `end` against the critical amount.
 * Unfavourable conditions (SLF): strong wind during the snowfall, a cold
 * snowfall, and an old surface underneath (old snow or a crust). 0 of them →
 * favourable, 1 → average, 2 or more → unfavourable. `wind` is the 850 hPa
 * wind by hour; `surfaces` the snow surface by hour (both for the region).
 * null when the steps don't cover the window.
 */
export function criticalNewSnow(
  steps: PrecipStep[],
  end: number,
  wind: { time: number; speed: number }[],
  surfaces: { time: number; surface: SurfaceKind }[],
): Critical | null {
  const from = end - CRIT_H * HOUR;
  if (coverage(steps, from, end) < MIN_COVERAGE) return null;
  const cm = newSnowCm(steps, from, end);
  const snowy = steps.filter((s) => snowing(s) && inside(s, from, end) > 0);
  const factors: string[] = [];
  if (snowy.length) {
    const first = Math.min(...snowy.map((s) => s.time)), last = Math.max(...snowy.map((s) => s.time + s.hours * HOUR));
    const during = wind.filter((w) => w.time >= first && w.time <= last).map((w) => w.speed);
    const maxWind = during.length ? Math.max(...during) : 0;
    if (maxWind >= CRIT_WIND_MS) factors.push(`sterk vind ${Math.round(maxWind)} m/s`);
    const t = mean(snowy.map((s) => s.temp));
    if (t < CRIT_COLD_C) factors.push(`kaldt snøfall ${Math.round(t)} °C`);
    const before = surfaces.filter((s) => s.time < first).at(-1)?.surface;
    if (before === 'crust') factors.push('skare under');
    else if (before === 'old') factors.push('gammel snø under');
  }
  const cls: CritClass = factors.length === 0 ? 'favourable' : factors.length === 1 ? 'average' : 'unfavourable';
  const range = CRIT_CM[cls];
  return { cm, cls, range, ratio: cm / range[0], factors };
}

/** Rain: a step where at most this share falls as snow (Rule 7). */
export const RAIN_SNOW_SHARE = 0.1;
/** At least this much rain counts, mm (our own: ignore a few drops). */
export const RAIN_MIN_MM = 0.5;
export const RAIN_H = 12;

export interface RainAround {
  /** Rain in the RAIN_H hours before / after the reference time, mm. */
  before: number;
  after: number;
  on: boolean;
}

/** Rain (not sleet or snow) in the RAIN_H hours before and after `ref`. null when no steps cover them. */
export function rainAround(steps: PrecipStep[], ref: number): RainAround | null {
  const from = ref - RAIN_H * HOUR, to = ref + RAIN_H * HOUR;
  if (!steps.some((s) => inside(s, from, to) > 0)) return null;
  const rain = (a: number, b: number) =>
    steps.reduce((sum, s) => (s.precip > 0 && s.snowMm / s.precip <= RAIN_SNOW_SHARE ? sum + inside(s, a, b) * s.precip : sum), 0);
  const before = rain(from, ref), after = rain(ref, to);
  return { before, after, on: before >= RAIN_MIN_MM || after >= RAIN_MIN_MM };
}

/** First mild day (Rule 7): this much new snow in the FIRST_THAW_H hours before the day. */
export const FIRST_THAW_CM = 10;
export const FIRST_THAW_H = 48;

export interface FirstThaw {
  hit: boolean;
  /** Why not, when it doesn't hit. */
  why: 'hit' | 'littleSnow' | 'noDay' | 'cold' | 'mildBefore';
  /** New snow in the FIRST_THAW_H hours before the day, cm. */
  cm: number;
  /** Warmest during the day, °C (null without steps for the day). */
  maxTemp: number | null;
}

/**
 * Første mildvær: on the day (`dayFrom`–`dayTo`) the temperature reaches 0 °C,
 * after at least FIRST_THAW_CM of new snow in the FIRST_THAW_H hours before
 * `dayStart`, and it hasn't been 0 °C since that snow fell. null when the
 * steps don't cover the snow window.
 */
export function firstThaw(steps: PrecipStep[], dayStart: number, dayFrom: number, dayTo: number): FirstThaw | null {
  const from = dayStart - FIRST_THAW_H * HOUR;
  if (coverage(steps, from, dayStart) < MIN_COVERAGE) return null;
  const cm = newSnowCm(steps, from, dayStart);
  const day = startingIn(steps, dayFrom, dayTo);
  const maxTemp = day.length ? Math.max(...day.map((s) => s.temp)) : null;
  const out = (why: FirstThaw['why']): FirstThaw => ({ hit: why === 'hit', why, cm, maxTemp });
  if (cm < FIRST_THAW_CM) return out('littleSnow');
  if (maxTemp == null) return out('noDay');
  if (maxTemp < 0) return out('cold');
  const snowEnd = Math.max(...steps.filter((s) => snowing(s) && inside(s, from, dayStart) > 0).map((s) => s.time + s.hours * HOUR));
  if (startingIn(steps, snowEnd, dayStart).some((s) => s.temp >= 0)) return out('mildBefore');
  return out('hit');
}

/** First fine day (Rule 7): this much new snow in the FIRST_FINE_H hours before the day … */
export const FIRST_FINE_CM = 20;
export const FIRST_FINE_H = 72;
/** … and the day's mean cloud cover below this, % (our own). */
export const FINE_CLOUD = 30;

export interface FirstFine {
  hit: boolean;
  why: 'hit' | 'littleSnow' | 'snowing' | 'noCloud' | 'cloudy' | 'notFirst';
  /** New snow in the FIRST_FINE_H hours before the day, cm. */
  cm: number;
  /** Mean cloud cover during the day, % (null without cloud data). */
  cloud: number | null;
}

/**
 * Første fine dag: little cloud on the day (`dayFrom`–`dayTo`, mean below
 * FINE_CLOUD) after at least FIRST_FINE_CM of new snow in the FIRST_FINE_H
 * hours before `dayStart`, with no new snow on the day itself, and the day
 * before not fine already (when known). null when the steps don't cover the snow window.
 */
export function firstFineDay(steps: PrecipStep[], dayStart: number, dayFrom: number, dayTo: number): FirstFine | null {
  const from = dayStart - FIRST_FINE_H * HOUR;
  if (coverage(steps, from, dayStart) < MIN_COVERAGE) return null;
  const cm = newSnowCm(steps, from, dayStart);
  const clouds = (a: number, b: number) => startingIn(steps, a, b).flatMap((s) => (s.cloud == null ? [] : [s.cloud]));
  const today = clouds(dayFrom, dayTo);
  const cloud = today.length ? mean(today) : null;
  const out = (why: FirstFine['why']): FirstFine => ({ hit: why === 'hit', why, cm, cloud });
  if (cm < FIRST_FINE_CM) return out('littleSnow');
  if (newSnowCm(steps, dayFrom, dayTo) >= 1) return out('snowing');
  if (cloud == null) return out('noCloud');
  if (cloud >= FINE_CLOUD) return out('cloudy');
  const yesterday = clouds(dayFrom - 24 * HOUR, dayTo - 24 * HOUR);
  if (yesterday.length && mean(yesterday) < FINE_CLOUD) return out('notFirst');
  return out('hit');
}

export type Refreeze = 'good' | 'weak' | 'none';
export const HARD_FREEZE_C = -5;

/**
 * Did it refreeze in the night [from, to)? (Rule 13; cut-offs are the rules
 * note's starting values.)
 * - none: lowest temperature above 0 °C, or cloud ≥ 80 % and above −1 °C;
 * - good: cloud below 50 % and down to −2 °C or colder, or down to
 *   HARD_FREEZE_C whatever the cloud (our own: that cold, the crust freezes anyway);
 * - weak: anything else.
 * Without cloud data it goes by temperature alone. null without steps.
 */
export function refreeze(steps: PrecipStep[], from: number, to: number): { state: Refreeze; min: number; cloud: number | null } | null {
  const night = startingIn(steps, from, to);
  if (!night.length) return null;
  const min = Math.min(...night.map((s) => s.temp));
  const cs = night.flatMap((s) => (s.cloud == null ? [] : [s.cloud]));
  const cloud = cs.length ? mean(cs) : null;
  const state: Refreeze =
    min > 0 || (cloud != null && cloud >= 80 && min > -1)
      ? 'none'
      : min <= HARD_FREEZE_C || (min <= -2 && (cloud == null || cloud < 50))
        ? 'good'
        : 'weak';
  return { state, min, cloud };
}
