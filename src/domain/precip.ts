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
function inside(s: PrecipStep, from: number, to: number): number {
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
