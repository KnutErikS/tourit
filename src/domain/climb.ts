/*
 * Climbing conditions at a crag from the hourly weather: is the rock dry, and
 * is it pleasant to climb? Pure logic, tested with node:test.
 *
 * In Norway the deciding question is usually rain: how much fell over the last
 * day, and whether it is raining now. Temperature (friction, cold fingers),
 * wind and damp air come after. Every cut-off here is ours, from general
 * climbing experience (dry rock, 5–20 °C), not tested against observations;
 * seepage after heavy rain and walls under roofs aren't known.
 */

export interface ClimbHour {
  /** ms */
  time: number;
  /** Precipitation in the hour, mm. */
  precip: number;
  temp: number;
  /** Relative humidity, %. */
  rh: number | null;
  /** m/s */
  wind: number;
  gust: number | null;
  /** Degrees the wind comes from. */
  windDir: number | null;
  /** Cloud cover, %. */
  cloud: number | null;
}

export type Rock = 'dry' | 'drying' | 'wet' | 'raining';

export interface ClimbRating {
  /** 0 (forget it) to 5. */
  score: number;
  rock: Rock;
  /** Rain over the 24 and 6 hours up to this hour, mm. */
  rain24: number;
  rain6: number;
  temp: number;
  notes: string[];
}

const HOUR = 3_600_000;
/** Rain in the hour that counts as "raining" (ours). */
export const RAINING_MM = 0.2;

/** Rain from `t - h` hours up to (and including) the hour at `t`. */
export function rainBefore(hours: ClimbHour[], t: number, h: number): number {
  return hours.filter((x) => x.time > t - h * HOUR && x.time <= t).reduce((a, x) => a + x.precip, 0);
}

/**
 * Score 0–5 (all cut-offs ours):
 * - rock: raining now → 0. Rain the last 24 h: ≥ 10 mm −3 (seepage), ≥ 3 mm −2, ≥ 0.5 mm −1;
 *   ≥ 0.3 mm the last 6 h −1 more (still wet).
 * - temperature: under 0 °C −2, 0–5 °C −1, 22–27 °C −1, over 27 °C −2.
 * - wind: from 12 m/s −1, gusts from 20 m/s −1.
 * - damp: humidity ≥ 90 % with under 2 m/s of wind −1 (rock stays clammy).
 * - wet rock scores at most 1, damp (drying) rock at most 3, whatever else is good.
 */
export function rateClimb(hours: ClimbHour[], h: ClimbHour): ClimbRating {
  const notes: string[] = [];
  const rain24 = rainBefore(hours, h.time, 24);
  const rain6 = rainBefore(hours, h.time, 6);
  let score = 5;
  let rock: Rock = 'dry';
  if (h.precip >= RAINING_MM) {
    return { score: 0, rock: 'raining', rain24, rain6, temp: h.temp, notes: [`Regn (${fmt(h.precip)} mm denne timen).`] };
  }
  if (rain24 >= 10) {
    score -= 3;
    rock = 'wet';
    notes.push(`${fmt(rain24)} mm regn siste døgn: våt stein og sig i sprekker.`);
  } else if (rain24 >= 3) {
    score -= 2;
    rock = 'drying';
    notes.push(`${fmt(rain24)} mm regn siste døgn: fuktig stein flere steder.`);
  } else if (rain24 >= 0.5) {
    score -= 1;
    rock = 'drying';
    notes.push(`Litt regn siste døgn (${fmt(rain24)} mm): tørker fort i sol og vind.`);
  }
  if (rain6 >= 0.3) {
    score -= 1;
    if (rock !== 'wet') rock = rain6 >= 1 ? 'wet' : 'drying';
    notes.push('Regn de siste seks timene: steinen er trolig fortsatt våt.');
  }
  if (rock === 'dry') notes.push('Tørt siste døgn.');

  if (h.temp < 0) {
    score -= 2;
    notes.push('Kuldegrader: kalde fingre, mulig is i sprekker.');
  } else if (h.temp < 5) {
    score -= 1;
    notes.push('Kaldt (under 5 °C).');
  } else if (h.temp > 27) {
    score -= 2;
    notes.push('Svært varmt: dårlig friksjon.');
  } else if (h.temp > 22) {
    score -= 1;
    notes.push('Varmt: dårligere friksjon i sola.');
  }
  if (h.wind >= 12) {
    score -= 1;
    notes.push(`Sterk vind (${Math.round(h.wind)} m/s).`);
  }
  if (h.gust != null && h.gust >= 20) {
    score -= 1;
    notes.push(`Kraftige vindkast (${Math.round(h.gust)} m/s).`);
  }
  if (h.rh != null && h.rh >= 90 && h.wind < 2 && h.temp >= 0) {
    score -= 1;
    notes.push('Fuktig luft og lite vind: steinen kan bli klam.');
  }
  const cap = rock === 'wet' ? 1 : rock === 'drying' ? 3 : 5;
  return { score: Math.max(0, Math.min(cap, score)), rock, rain24, rain6, temp: h.temp, notes };
}

const fmt = (mm: number) => (mm < 10 ? mm.toFixed(1).replace('.', ',') : String(Math.round(mm)));

export const ROCK_NAME: Record<Rock, string> = { dry: 'Tørt', drying: 'Fuktig', wet: 'Vått', raining: 'Regn' };
export const CLIMB_SCORE_NAME = ['Dårlig', 'Lite egnet', 'Brukbart', 'Bra', 'Veldig bra', 'Topp'] as const;

/** Climbing hours of a day, local time (ours). */
export const CLIMB_FROM_H = 9, CLIMB_TO_H = 20;

/** The best-rated hour between CLIMB_FROM_H and CLIMB_TO_H of a day (earliest of equals), or null. */
export function bestClimbOfDay(hours: ClimbHour[], iso: string): { hour: ClimbHour; rating: ClimbRating } | null {
  const start = new Date(iso + 'T00:00:00').getTime();
  let best: { hour: ClimbHour; rating: ClimbRating } | null = null;
  for (const h of hours) {
    if (h.time < start + CLIMB_FROM_H * HOUR || h.time > start + CLIMB_TO_H * HOUR) continue;
    const rating = rateClimb(hours, h);
    if (!best || rating.score > best.rating.score) best = { hour: h, rating };
  }
  return best;
}

/** Open-Meteo forecast (hourly, unixtime, wind in m/s) → hours. */
export function toClimbHours(loc: { hourly?: Record<string, (number | null)[] | undefined> & { time: number[] } }): ClimbHour[] {
  const h = loc.hourly;
  if (!h?.time) return [];
  const out: ClimbHour[] = [];
  h.time.forEach((t, i) => {
    const v = (k: string) => {
      const x = h[k]?.[i];
      return x == null || !Number.isFinite(x) ? null : x;
    };
    const temp = v('temperature_2m');
    if (temp == null) return;
    out.push({
      time: t * 1000,
      precip: v('precipitation') ?? 0,
      temp,
      rh: v('relative_humidity_2m'),
      wind: v('wind_speed_10m') ?? 0,
      gust: v('wind_gusts_10m'),
      windDir: v('wind_direction_10m'),
      cloud: v('cloud_cover'),
    });
  });
  return out;
}

/** Weather is fetched per grid cell (~5 km), so nearby crags share one request. */
export const CELL_DEG = 0.05;
export const cellOf = (lat: number, lng: number) => `${(Math.round(lat / CELL_DEG) * CELL_DEG).toFixed(2)},${(Math.round(lng / CELL_DEG) * CELL_DEG).toFixed(2)}`;
