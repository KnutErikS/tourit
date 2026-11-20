/**
 * Wind-loaded slopes from the wind over the last few days.
 *
 * Wind picks snow up on the windward side and drops it on the lee side, so
 * slopes facing *downwind* collect wind slabs. We sum the hourly wind for a
 * region and, per aspect sector, how much of it blew towards that sector.
 *
 * - Wind and temperature are taken at 850 hPa (~1300–1500 m): free air at
 *   about ridge height, which is what moves snow in the mountains. A model's
 *   10 m wind is smoothed over valleys and comes out too weak.
 * - Snow transport grows roughly with the cube of the wind speed above a
 *   threshold, so a few stormy hours count far more than a long breeze.
 * - The last 24 h count fully, older hours less, down to LOOKBACK_H.
 * - Cross-loading: a slope at 45° to the wind still gets cos(45°) ≈ 0.7.
 *
 * Only snow that can move counts (see `surfaceAt`). The threshold wind is
 * lowest for fresh dry snow and rises for older snow and near 0 °C, and older
 * snow gives less of it (OLD_SUPPLY); wet snow,
 * and a crust from rain or mild weather with no new snow on top, don't drift.
 * Field thresholds: ~7.7 m/s dry, ~9.9 m/s wet at 10 m (Li & Pomeroy 1997);
 * ours are lower because the 850 hPa wind is ridge-top wind.
 *
 * This is a rule of thumb, not a snowpack model. The warning's own wind-slab
 * problem wins.
 */

import { isoDate } from '../util';
import { cmPerMm } from './precip';

/** One hour of weather at ridge height. */
export interface WindHour {
  /** ms since epoch */
  time: number;
  /** m/s */
  speed: number;
  /** Degrees the wind comes from (0 = from north). */
  from: number;
  /** Air temperature at 850 hPa, °C. */
  temp?: number;
  /** Precipitation in the hour ending at `time`, mm. */
  precip?: number;
}

/** What the snow surface is like for the wind to work on. */
export type Surface = 'fresh' | 'old' | 'crust' | 'wet';

export interface WindLoading {
  /** Lee (loaded) aspect sectors, index as DIRS. */
  lee: boolean[];
  /** Heavy loading: a lot of transport into the most-loaded sector. */
  strong: boolean;
  /** Typical direction the transporting wind came from, degrees. */
  from: number;
  /** Strongest hourly wind in the window, m/s. */
  max: number;
  /** Loading of the most-loaded sector, in hours of 10 m/s wind. */
  hours10: number;
  /** New snow at ridge height over the window and the SNOW_MEMORY_H before it, cm. */
  snowCm: number;
  /**
   * Why windy hours (≥ WINDY m/s) in the window moved little or no snow, if most of them didn't:
   * the surface they met. Undefined when the wind had snow to work on, or wasn't windy.
   */
  stuck?: Exclude<Surface, 'fresh' | 'old'>;
  /** Window used, ms. */
  start: number;
  end: number;
}

export const LOOKBACK_H = 72;
/** Snow that fell this long before an hour still counts as loose. */
export const SNOW_MEMORY_H = 48;
/** Hours of weather needed before the window's end. */
export const FETCH_H = LOOKBACK_H + SNOW_MEMORY_H;
/** Hours that count in full; older hours fade linearly to OLDEST_WEIGHT at LOOKBACK_H. */
const RECENT_H = 24;
const OLDEST_WEIGHT = 0.3;

/** Threshold wind (m/s at 850 hPa): fresh dry snow, and older dry snow that has bonded. */
const MIN_FRESH = 5;
const MIN_OLD = 8;
/**
 * Older snow drifts at a third of the rate: the wind soon packs the surface
 * hard and runs out of loose grains, while new snow keeps feeding it.
 */
const OLD_SUPPLY = 1 / 3;
/** Between MILD_T and 0 °C the snow is sticky: the threshold goes up by this much. */
const MILD_T = -2;
const MILD_EXTRA = 3;
/** At least this much new snow (mm water, ≈ cm) in the last SNOW_MEMORY_H counts as fresh. */
const FRESH_MM = 2;
/** Precipitation is snow at or below SNOW_T, rain at or above RAIN_T (850 hPa, °C). */
const SNOW_T = 0.5;
const RAIN_T = 1.5;
/** This much rain, or this warm, makes a crust on the old snow once it freezes again. */
const CRUST_RAIN_MM = 0.5;
const CRUST_T = 1;
/** Wind this strong would move dry snow; used to say why it didn't. */
const WINDY = 8;

/** Sectors with at least this share of the top sector's loading count as lee too. */
const SHARE = 0.6;
/** Minimum and "strong" loading, in hours of 10 m/s wind. */
const MIN_HOURS10 = 3;
const STRONG_HOURS10 = 12;

const HOUR = 3_600_000;
const RAD = Math.PI / 180;
const flux = (v: number, min: number) => (v > min ? v ** 3 - min ** 3 : 0);
const UNIT = flux(10, MIN_FRESH);

function ageWeight(ageH: number): number {
  if (ageH < 0 || ageH > LOOKBACK_H) return 0;
  if (ageH <= RECENT_H) return 1;
  return 1 - ((1 - OLDEST_WEIGHT) * (ageH - RECENT_H)) / (LOOKBACK_H - RECENT_H);
}

/** Share of the precipitation that falls as snow at ridge height, from the 850 hPa temperature. */
export const snowShare = (t: number) => Math.min(1, Math.max(0, (RAIN_T - t) / (RAIN_T - SNOW_T)));

/**
 * The snow surface hour by hour, from the precipitation and temperature so far.
 * Before the first hour we know nothing, so it starts as 'old' (dry, bonded snow).
 */
export function surfaces(hours: WindHour[]): { surface: Surface; snowMm: number; snowCm: number }[] {
  const recent: { time: number; mm: number }[] = [];
  let crust = false;
  return hours.map((h) => {
    const t = h.temp, p = h.precip ?? 0;
    const snowMm = t == null ? 0 : p * snowShare(t), rainMm = p - snowMm;
    if (rainMm >= CRUST_RAIN_MM || (t != null && t > CRUST_T)) {
      crust = true; // wet now, refreezes to a crust; the new snow so far is part of it
      recent.length = 0;
    }
    if (snowMm > 0) {
      recent.push({ time: h.time, mm: snowMm });
      crust = false; // new snow on top of a crust is loose again
    }
    while (recent.length && recent[0].time <= h.time - SNOW_MEMORY_H * HOUR) recent.shift();
    const fresh = recent.reduce((a, r) => a + r.mm, 0) >= FRESH_MM;
    const surface: Surface = t != null && t > 0 ? 'wet' : fresh ? 'fresh' : crust ? 'crust' : 'old';
    return { surface, snowMm, snowCm: t == null ? 0 : snowMm * cmPerMm(t) };
  });
}

/** Threshold wind for this surface and temperature; Infinity when the snow can't drift. */
export function threshold(surface: Surface, temp: number | undefined): number {
  if (surface === 'wet' || surface === 'crust') return Infinity;
  const base = surface === 'fresh' ? MIN_FRESH : MIN_OLD;
  return temp != null && temp > MILD_T ? base + MILD_EXTRA : base;
}

/** Lee sectors for the weather before `end` (ms). Null when there are no hours in the window. */
export function windLoading(all: WindHour[], end: number): WindLoading | null {
  const start = end - LOOKBACK_H * HOUR;
  const hours = all
    .filter((h) => h.time > end - FETCH_H * HOUR && h.time <= end && Number.isFinite(h.speed) && Number.isFinite(h.from))
    .sort((a, b) => a.time - b.time);
  const surf = surfaces(hours);
  const inside = hours.map((h, i) => ({ h, s: surf[i].surface })).filter(({ h }) => h.time > start);
  if (!inside.length) return null;

  const load = new Array<number>(8).fill(0);
  let ux = 0, uy = 0, max = 0, maxFrom = inside[0].h.from;
  const stuckBy: Record<Surface, number> = { fresh: 0, old: 0, crust: 0, wet: 0 };
  let windy = 0;
  for (const { h, s } of inside) {
    if (h.speed > max) [max, maxFrom] = [h.speed, h.from];
    const f = flux(h.speed, threshold(s, h.temp)) * (s === 'old' ? OLD_SUPPLY : 1);
    if (h.speed >= WINDY) {
      windy++;
      if (!f) stuckBy[s]++;
    }
    const w = f * ageWeight((end - h.time) / HOUR);
    if (!w) continue;
    const to = (h.from + 180) * RAD; // downwind direction
    ux += w * Math.sin(to);
    uy += w * Math.cos(to);
    // A sector's slopes face s·45°; they load when the wind blows towards them.
    for (let k = 0; k < 8; k++) load[k] += w * Math.max(0, Math.cos(to - k * 45 * RAD));
  }
  const top = Math.max(...load);
  const hours10 = top / UNIT;
  const on = hours10 >= MIN_HOURS10;
  const stuck = stuckBy.crust + stuckBy.wet > windy / 2 ? (stuckBy.wet > stuckBy.crust ? 'wet' : 'crust') : undefined;
  return {
    lee: load.map((l) => on && l >= top * SHARE),
    strong: hours10 >= STRONG_HOURS10,
    // No transporting wind: say where the strongest breeze came from instead.
    from: ux || uy ? (Math.atan2(ux, uy) / RAD + 180 + 360) % 360 : maxFrom,
    max,
    hours10,
    snowCm: surf.reduce((a, s) => a + s.snowCm, 0),
    stuck,
    start,
    end,
  };
}

/** End of the window for a warning date: now for today, otherwise 10:00 local on that day. */
export function windowEnd(date: string, now = Date.now()): number {
  return date === isoDate(new Date(now)) ? now : new Date(date + 'T10:00:00').getTime();
}
