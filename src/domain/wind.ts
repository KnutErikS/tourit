/**
 * Wind-loaded slopes from the wind over the last few days.
 *
 * Wind picks snow up on the windward side and drops it on the lee side, so
 * slopes facing *downwind* collect wind slabs. We sum the hourly wind for a
 * region and, per aspect sector, how much of it blew towards that sector.
 *
 * - Wind is taken at 850 hPa (~1300–1500 m): free air at about ridge height,
 *   which is what moves snow in the mountains. A model's 10 m wind is smoothed
 *   over valleys and comes out too weak.
 * - Snow transport grows roughly with the cube of the wind speed above a
 *   threshold, so a few stormy hours count far more than a long breeze.
 * - The last 24 h count fully, older hours less, down to LOOKBACK_H.
 * - Cross-loading: a slope at 45° to the wind still gets cos(45°) ≈ 0.7.
 *
 * This is a rule of thumb, not a snowpack model: it doesn't know whether
 * there was loose snow to move. The warning's own wind-slab problem wins.
 */

import { isoDate } from '../util';

/** One hour of wind. */
export interface WindHour {
  /** ms since epoch */
  time: number;
  /** m/s */
  speed: number;
  /** Degrees the wind comes from (0 = from north). */
  from: number;
}

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
  /** Window used, ms. */
  start: number;
  end: number;
}

export const LOOKBACK_H = 72;
/** Hours that count in full; older hours fade linearly to OLDEST_WEIGHT at LOOKBACK_H. */
const RECENT_H = 24;
const OLDEST_WEIGHT = 0.3;
/** Below this (m/s at 850 hPa) the wind moves next to no snow. */
export const TRANSPORT_MIN = 5;
/** Sectors with at least this share of the top sector's loading count as lee too. */
const SHARE = 0.6;
/** Minimum and "strong" loading, in hours of 10 m/s wind. */
const MIN_HOURS10 = 3;
const STRONG_HOURS10 = 12;

const HOUR = 3_600_000;
const RAD = Math.PI / 180;
const transport = (v: number) => (v > TRANSPORT_MIN ? v ** 3 - TRANSPORT_MIN ** 3 : 0);
const UNIT = transport(10);

function ageWeight(ageH: number): number {
  if (ageH < 0 || ageH > LOOKBACK_H) return 0;
  if (ageH <= RECENT_H) return 1;
  return 1 - ((1 - OLDEST_WEIGHT) * (ageH - RECENT_H)) / (LOOKBACK_H - RECENT_H);
}

/** Lee sectors for the wind before `end` (ms). Null when there are no hours in the window. */
export function windLoading(hours: WindHour[], end: number): WindLoading | null {
  const start = end - LOOKBACK_H * HOUR;
  const inside = hours.filter((h) => h.time > start && h.time <= end && Number.isFinite(h.speed) && Number.isFinite(h.from));
  if (!inside.length) return null;

  const load = new Array<number>(8).fill(0);
  let ux = 0, uy = 0, max = 0, maxFrom = inside[0].from;
  for (const h of inside) {
    if (h.speed > max) [max, maxFrom] = [h.speed, h.from];
    const w = transport(h.speed) * ageWeight((end - h.time) / HOUR);
    if (!w) continue;
    const to = (h.from + 180) * RAD; // downwind direction
    ux += w * Math.sin(to);
    uy += w * Math.cos(to);
    // A sector's slopes face s·45°; they load when the wind blows towards them.
    for (let s = 0; s < 8; s++) load[s] += w * Math.max(0, Math.cos(to - s * 45 * RAD));
  }
  const top = Math.max(...load);
  const hours10 = top / UNIT;
  const on = hours10 >= MIN_HOURS10;
  return {
    lee: load.map((l) => on && l >= top * SHARE),
    strong: hours10 >= STRONG_HOURS10,
    // No transporting wind: say where the strongest breeze came from instead.
    from: ux || uy ? (Math.atan2(ux, uy) / RAD + 180 + 360) % 360 : maxFrom,
    max,
    hours10,
    start,
    end,
  };
}

/** End of the window for a warning date: now for today, otherwise 10:00 local on that day. */
export function windowEnd(date: string, now = Date.now()): number {
  return date === isoDate(new Date(now)) ? now : new Date(date + 'T10:00:00').getTime();
}
