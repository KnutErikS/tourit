import type { SurfSpot } from './surfSpots';

/*
 * Surf conditions at a spot from an offshore wave forecast and the local wind.
 * Pure logic, tested with node:test.
 *
 * The wave model (Open-Meteo marine, ~5–9 km cells) gives the sea a few km out,
 * not the waves on the sandbar: how much of the swell reaches a spot depends on
 * its direction (swellFactor), and the size it breaks at on its height and
 * period (breakerHeight). The wind decides whether it is clean or blown out.
 * Every cut-off marked "ours" is our own choice, not tested against observed surf.
 */

export interface SurfHour {
  /** ms */
  time: number;
  /** Primary swell: significant height (m), peak period (s), direction it comes from (°). */
  swellH: number | null;
  swellT: number | null;
  swellDir: number | null;
  /** All waves together (swell + wind sea), m and s. */
  waveH: number | null;
  waveT: number | null;
  waveDir: number | null;
  /** Wind sea alone (local chop), m. */
  windWaveH: number | null;
  /** 10 m wind, m/s and the direction it comes from (°). */
  windSpeed: number | null;
  windGust: number | null;
  windDir: number | null;
  /** Sea surface temperature, °C. */
  sst: number | null;
}

/* ---------- directions ---------- */

/** Smallest angle between two directions, 0–180°. */
export function angDiff(a: number, b: number): number {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

/* ---------- wind ---------- */

export type WindRel = 'glassy' | 'offshore' | 'cross-off' | 'cross' | 'cross-on' | 'onshore';

/** Under this the surface stays smooth whatever the direction (ours). */
export const GLASSY_MS = 2;
/** From here onshore and cross wind blows it out; offshore makes paddling in hard (ours). */
export const STRONG_MS = 9;
export const OFFSHORE_TOO_STRONG_MS = 14;

/** Wind relative to the beach: how far its direction is from the spot's offshore direction. */
export function windRel(speed: number, from: number, offshoreFrom: number): WindRel {
  if (speed < GLASSY_MS) return 'glassy';
  const d = angDiff(from, offshoreFrom);
  if (d <= 30) return 'offshore';
  if (d <= 67.5) return 'cross-off';
  if (d <= 112.5) return 'cross';
  if (d <= 150) return 'cross-on';
  return 'onshore';
}

export const WIND_NAME: Record<WindRel, string> = {
  glassy: 'stille',
  offshore: 'fralands',
  'cross-off': 'skrå fralands',
  cross: 'sideveis',
  'cross-on': 'skrå pålands',
  onshore: 'pålands',
};

/* ---------- swell ---------- */

/** Default half-width of a spot's swell window, degrees (ours). */
export const SWELL_WINDOW = 45;

/**
 * Share of the offshore swell height that reaches the spot, from the angle
 * between the swell and the spot's best direction: 1 inside the window, down to
 * 0.5 at 1.5 × the window, 0 at 2.5 × the window (ours; swell bends round
 * headlands, so a little gets in from the side).
 */
export function swellFactor(swellDir: number, spot: Pick<SurfSpot, 'swellFrom' | 'window'>): number {
  const w = spot.window ?? SWELL_WINDOW;
  const d = angDiff(swellDir, spot.swellFrom);
  if (d <= w) return 1;
  if (d <= 1.5 * w) return 1 - 0.5 * ((d - w) / (0.5 * w));
  if (d <= 2.5 * w) return 0.5 * (1 - (d - 1.5 * w) / w);
  return 0;
}

const G = 9.81;
/**
 * Breaking wave height (m) from deep-water height H0 (m) and period T (s):
 * Komar & Gaughan (1972), Hb = 0.39 g^(1/5) (T H0²)^(2/5). Long-period swell
 * grows more as it shoals, so 1 m at 12 s breaks bigger than 1 m at 6 s.
 */
export function breakerHeight(h0: number, t: number): number {
  if (!(h0 > 0) || !(t > 0)) return 0;
  return 0.39 * G ** 0.2 * (t * h0 * h0) ** 0.4;
}

/* ---------- rating ---------- */

export interface SurfRating {
  /** 0 (nothing to surf) to 5. */
  score: number;
  /** Estimated breaking height at the spot, m (null without wave data). */
  size: number | null;
  /** Share of the swell that gets in, 0–1. */
  exposure: number | null;
  /** Period used, s. */
  period: number | null;
  wind: WindRel | null;
  /** Big for the spot: for experienced surfers only. */
  big: boolean;
  /** Short reasons in Norwegian, biggest first. */
  notes: string[];
}

/** Size points from the breaking height (m), ours. */
const SIZE_STEPS: [number, number][] = [[0.3, 0], [0.6, 1], [0.9, 2], [1.5, 3], [Infinity, 4]];
/** Above this the waves are big for most surfers (ours). */
export const BIG_M = 2.5;
/** Swell this short is wind swell: weak and messy (ours). */
export const SHORT_T = 7;
/** Swell this long is clean groundswell (ours). */
export const LONG_T = 11;

/**
 * Score 0–5: size points (0–4) from the breaking height, +1 for long-period
 * groundswell, −1 for short period, and down for wind that isn't offshore:
 * cross −1, cross-onshore/onshore −2, another −1 when it is strong; offshore
 * that is very strong −1. All cut-offs ours.
 */
export function rateHour(spot: SurfSpot, h: SurfHour): SurfRating {
  const notes: string[] = [];
  // Prefer the swell partition; fall back to all waves when the model has none.
  const useSwell = h.swellH != null && h.swellH > 0 && h.swellDir != null;
  const h0 = useSwell ? h.swellH : h.waveH;
  const dir = useSwell ? h.swellDir : h.waveDir;
  const t = useSwell ? h.swellT : h.waveT;
  if (h0 == null || dir == null || t == null) {
    return { score: 0, size: null, exposure: null, period: null, wind: null, big: false, notes: ['Mangler bølgedata for denne timen.'] };
  }
  const exposure = swellFactor(dir, spot);
  const size = breakerHeight(h0 * exposure, t);
  let score = SIZE_STEPS.find(([max]) => size < max)![1];
  const big = size >= BIG_M;

  if (exposure < 0.5) notes.push('Dønningen kommer mye fra siden: bare en del når inn.');
  else if (exposure < 1) notes.push('Dønningen kommer litt fra siden.');
  if (score === 0) {
    notes.unshift(size < 0.3 && h0 >= 0.5 ? 'Lite av dønningen når inn hit.' : 'For små bølger.');
    return { score: 0, size, exposure, period: t, wind: windOf(spot, h), big, notes };
  }

  if (t >= LONG_T) {
    score += 1;
    notes.push(`Lang periode (${Math.round(t)} s): ren dønning med kraft.`);
  } else if (t < SHORT_T) {
    score -= 1;
    notes.push(`Kort periode (${Math.round(t)} s): svak og rotete vindsjø.`);
  }

  const wind = windOf(spot, h);
  const speed = h.windSpeed ?? 0;
  if (wind === 'cross') score -= 1;
  else if (wind === 'cross-on' || wind === 'onshore') score -= 2;
  if (wind && wind !== 'offshore' && wind !== 'glassy' && wind !== 'cross-off' && speed >= STRONG_MS) {
    score -= 1;
    notes.push(`Sterk ${WIND_NAME[wind]} vind blåser bølgene i stykker.`);
  } else if (wind === 'cross' || wind === 'cross-on' || wind === 'onshore') {
    notes.push(`${cap(WIND_NAME[wind])} vind gjør overflaten urolig.`);
  } else if (wind === 'offshore' && speed >= OFFSHORE_TOO_STRONG_MS) {
    score -= 1;
    notes.push('Svært sterk fralandsvind: tungt å padle inn på bølgene.');
  } else if (wind === 'offshore' || wind === 'glassy') {
    notes.push(wind === 'glassy' ? 'Nesten vindstille: blank overflate.' : 'Fralandsvind holder bølgene rene.');
  }
  if (big) notes.push('Store bølger: bare for erfarne.');

  return { score: Math.max(0, Math.min(5, score)), size, exposure, period: t, wind, big, notes };
}

const windOf = (spot: SurfSpot, h: SurfHour): WindRel | null =>
  h.windSpeed == null || h.windDir == null ? null : windRel(h.windSpeed, h.windDir, spot.offshoreFrom);

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const SCORE_NAME = ['Flatt', 'Lite', 'Brukbart', 'Bra', 'Veldig bra', 'Topp'] as const;
/** Label for a rating: 0 is "flat" when small, "dårlig" when there are waves but they don't work. */
export function scoreName(r: SurfRating): string {
  if (r.score === 0 && r.size != null && r.size >= 0.3) return 'Dårlig';
  return SCORE_NAME[r.score];
}

/* ---------- picking hours ---------- */

/** The hour nearest `t` (ms), if one is within 90 minutes. */
export function hourAt(hours: SurfHour[], t: number): SurfHour | null {
  let best: SurfHour | null = null;
  for (const h of hours) if (!best || Math.abs(h.time - t) < Math.abs(best.time - t)) best = h;
  return best && Math.abs(best.time - t) <= 90 * 60_000 ? best : null;
}

/** Daylight-ish surf hours of a day, local time (fixed; ignores polar night, ours). */
export const DAY_FROM_H = 7, DAY_TO_H = 19;

/** Local midnight of a YYYY-MM-DD date, ms. */
export const dayStart = (iso: string) => new Date(iso + 'T00:00:00').getTime();

/** The best-rated hour between DAY_FROM_H and DAY_TO_H of a day (earliest of equals), or null with no data. */
export function bestOfDay(spot: SurfSpot, hours: SurfHour[], iso: string): { hour: SurfHour; rating: SurfRating } | null {
  const from = dayStart(iso) + DAY_FROM_H * 3_600_000, to = dayStart(iso) + DAY_TO_H * 3_600_000;
  let best: { hour: SurfHour; rating: SurfRating } | null = null;
  for (const h of hours) {
    if (h.time < from || h.time > to) continue;
    const rating = rateHour(spot, h);
    if (rating.size == null) continue;
    if (!best || rating.score > best.rating.score) best = { hour: h, rating };
  }
  return best;
}

/* ---------- parsing Open-Meteo ---------- */

export type OmHourly = Record<string, (number | null)[] | undefined> & { time: number[] };
export interface OmLocation {
  hourly?: OmHourly;
}

/** Open-Meteo answers one object for one location and a list for several. */
export const asList = (raw: OmLocation | OmLocation[]): OmLocation[] => (Array.isArray(raw) ? raw : [raw]);

const num = (v: number | null | undefined): number | null => (v == null || !Number.isFinite(v) ? null : v);
/** A period of 0 s (NOAA GFS-Wave sends it where it finds no swell) means no data. */
const period = (v: number | null): number | null => (v != null && v > 0 ? v : null);

/**
 * One location's marine and wind answers merged into hours (marine times lead;
 * wind is matched by the same hour). Hours without any wave value are dropped.
 */
export function toSurfHours(marine: OmLocation, wind: OmLocation | null): SurfHour[] {
  const m = marine.hourly;
  if (!m?.time) return [];
  const w = wind?.hourly;
  const windAt = new Map<number, number>();
  w?.time?.forEach((t, i) => windAt.set(t, i));
  const out: SurfHour[] = [];
  m.time.forEach((t, i) => {
    const at = (k: string) => num(m[k]?.[i]);
    const j = windAt.get(t);
    const wv = (k: string) => (j === undefined ? null : num(w?.[k]?.[j]));
    const swellT = period(at('swell_wave_peak_period')) ?? period(at('swell_wave_period'));
    const hour: SurfHour = {
      time: t * 1000,
      // No period means no swell partition: a 0 m height with it is "no data", not flat sea.
      swellH: swellT == null && !at('swell_wave_height') ? null : at('swell_wave_height'),
      swellT,
      swellDir: at('swell_wave_direction'),
      waveH: at('wave_height'),
      waveT: period(at('wave_peak_period')) ?? period(at('wave_period')),
      waveDir: at('wave_direction'),
      windWaveH: at('wind_wave_height'),
      windSpeed: wv('wind_speed_10m'),
      windGust: wv('wind_gusts_10m'),
      windDir: wv('wind_direction_10m'),
      sst: at('sea_surface_temperature'),
    };
    if (hour.swellH == null && hour.waveH == null) return;
    out.push(hour);
  });
  return out;
}

/* ---------- wind through the day, for the Vær tab ---------- */

/** Wind sorted for a surfer: clean (offshore, light cross-offshore or calm), sideways, or blowing in. */
export type WindClass = 'clean' | 'side' | 'onshore';
export function windClass(rel: WindRel): WindClass {
  if (rel === 'glassy' || rel === 'offshore' || rel === 'cross-off') return 'clean';
  return rel === 'cross' ? 'side' : 'onshore';
}
export const WIND_CLASS_NAME: Record<WindClass, string> = { clean: 'fralands eller stille', side: 'sideveis', onshore: 'pålands' };

/** Consecutive hours with the same value, as [first, last] times; `step` is the spacing of the hours (ms). */
export function runs<T>(items: { time: number; v: T }[], step = 3_600_000): { v: T; from: number; to: number }[] {
  const out: { v: T; from: number; to: number }[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && last.v === it.v && it.time - last.to <= step) last.to = it.time;
    else out.push({ v: it.v, from: it.time, to: it.time });
  }
  return out;
}

/** Distance in km between two points (equirectangular: fine over a few km). */
export function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const x = ((b.lng - a.lng) * Math.PI) / 180 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const y = ((b.lat - a.lat) * Math.PI) / 180;
  return Math.hypot(x, y) * 6371;
}

/** The nearest spot within `maxKm`, or null. */
export function nearestSpot<S extends { lat: number; lng: number }>(spots: S[], at: { lat: number; lng: number }, maxKm = 5): S | null {
  let best: S | null = null, bestKm = maxKm;
  for (const s of spots) {
    const km = kmBetween(s, at);
    if (km <= bestKm) (best = s), (bestKm = km);
  }
  return best;
}
