/**
 * Sun position, daylight and sun on slopes, computed on the device (no network).
 *
 * Position: the usual low-precision solar formulas (Astronomical Almanac /
 * NOAA style), good to ~0.01°, far more than the minute steps used here need.
 * Sunrise/sunset use −0.833° (upper limb + refraction), daylight uses civil
 * twilight (−6°): light enough to travel without a headlamp.
 *
 * Sun on a slope: the angle between the sun and the slope's normal. Terrain
 * shadow (a ridge or valley side blocking a low sun) is NOT included, so the
 * times are when the sun *can* reach the slope; in narrow valleys and with a
 * low winter sun, the real sun window is shorter.
 */

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

/** Sun altitude for sunrise/sunset (upper limb, standard refraction). */
export const SUNRISE_ALT = -0.833;
/** Civil twilight: the end of usable daylight. */
export const CIVIL_ALT = -6;

export interface SunPos {
  /** Degrees above the horizon (geometric, no refraction). */
  alt: number;
  /** Degrees clockwise from north. */
  az: number;
}

/** Where the sun is at `ms` (epoch ms) seen from lat/lon (degrees). */
export function sunPosition(ms: number, lat: number, lon: number): SunPos {
  const d = ms / DAY_MS + 2440587.5 - 2451545.0; // days since J2000.0
  const g = (357.529 + 0.98560028 * d) * RAD; // mean anomaly
  const q = 280.459 + 0.98564736 * d; // mean longitude
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD; // ecliptic longitude
  const e = (23.439 - 0.00000036 * d) * RAD; // obliquity
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = 18.697374558 + 24.06570982441908 * d; // hours
  const H = (gmst * 15 + lon) * RAD - ra; // hour angle
  const phi = lat * RAD;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) / RAD + 180;
  return { alt: alt / RAD, az: ((az % 360) + 360) % 360 };
}

/**
 * Clear-sky direct beam on a surface facing the sun, W/m². Kasten–Young air
 * mass with a simple transmittance; only meant to compare times and aspects
 * (a low winter sun gives almost nothing, a March noon sun a lot).
 */
export function beam(alt: number): number {
  if (alt <= 0) return 0;
  const am = 1 / (Math.sin(alt * RAD) + 0.50572 * Math.pow(alt + 6.07995, -1.6364));
  return 1361 * Math.pow(0.7, Math.pow(am, 0.678));
}

/**
 * How directly the sun hits a slope: cos of the angle between the sun and the
 * slope's normal (≤ 0 = the sun is behind the slope). `aspect` is the
 * direction the slope faces, degrees clockwise from north.
 */
export function incidence(sun: SunPos, slope: number, aspect: number): number {
  const s = slope * RAD, a = aspect * RAD, h = sun.alt * RAD, z = sun.az * RAD;
  return Math.cos(s) * Math.sin(h) + Math.sin(s) * Math.cos(h) * Math.cos(z - a);
}

/** Direct sun on a slope, W/m² (0 when the sun is down or behind the slope). */
export function slopeSun(sun: SunPos, slope: number, aspect: number): number {
  const c = incidence(sun, slope, aspect);
  return c > 0 ? beam(sun.alt) * c : 0;
}

/** A time span, epoch ms. */
export interface Span {
  from: number;
  to: number;
}

/** One minute per sample over the day (local midnight to midnight). */
export interface SunDay {
  start: number;
  /** Sun position per minute. */
  pos: SunPos[];
}

/** Sample the sun over the local calendar day `iso` (YYYY-MM-DD) at lat/lon. */
export function sunDay(iso: string, lat: number, lon: number): SunDay {
  const start = new Date(iso + 'T00:00:00').getTime();
  const end = new Date(new Date(start).setDate(new Date(start).getDate() + 1)).getTime(); // 23 or 25 h on DST days
  const n = Math.round((end - start) / MIN_MS);
  const pos = new Array<SunPos>(n);
  for (let i = 0; i < n; i++) pos[i] = sunPosition(start + i * MIN_MS, lat, lon);
  return { start, pos };
}

/** The spans of the day where `test(minute)` holds. Open ends are clipped to the day. */
function spans(day: SunDay, test: (i: number) => boolean): Span[] {
  const out: Span[] = [];
  let from = -1;
  const n = day.pos.length;
  for (let i = 0; i <= n; i++) {
    const on = i < n && test(i);
    if (on && from < 0) from = i;
    if (!on && from >= 0) {
      out.push({ from: day.start + from * MIN_MS, to: day.start + i * MIN_MS });
      from = -1;
    }
  }
  return out;
}

export interface Daylight {
  /** Sun above the horizon. Empty = polar night; one span covering the day = midnight sun. */
  sun: Span[];
  /** Civil twilight or brighter. */
  light: Span[];
  /** Highest sun of the day, degrees. */
  maxAlt: number;
  /** When the sun is highest. */
  noon: number;
  /** Minutes of sun above the horizon. */
  sunMin: number;
  /** Minutes of daylight (civil). */
  lightMin: number;
  /** The sun never sets / never rises / is always below −6°. */
  midnightSun: boolean;
  polarNight: boolean;
}

const minutes = (s: Span[]) => s.reduce((m, x) => m + (x.to - x.from) / MIN_MS, 0);

export function daylight(day: SunDay): Daylight {
  let maxAlt = -90, iMax = 0;
  day.pos.forEach((p, i) => {
    if (p.alt > maxAlt) {
      maxAlt = p.alt;
      iMax = i;
    }
  });
  const sun = spans(day, (i) => day.pos[i].alt > SUNRISE_ALT);
  const light = spans(day, (i) => day.pos[i].alt > CIVIL_ALT);
  const sunMin = minutes(sun), lightMin = minutes(light);
  return {
    sun, light, maxAlt, noon: day.start + iMax * MIN_MS, sunMin, lightMin,
    midnightSun: sunMin >= day.pos.length - 1,
    polarNight: sunMin === 0,
  };
}

export interface SlopeSun {
  /** When direct sun reaches the slope (no terrain shadow). */
  spans: Span[];
  /** Strongest direct sun on the slope, W/m², and when. */
  peak: number;
  peakAt: number | null;
  /** Direct sun over the day, kWh/m². */
  total: number;
}

/** Sun on a slope of `slope`° facing `aspect`° through the day. */
export function sunOnSlope(day: SunDay, slope: number, aspect: number): SlopeSun {
  const w = day.pos.map((p) => slopeSun(p, slope, aspect));
  let peak = 0, peakAt: number | null = null, sum = 0;
  w.forEach((x, i) => {
    sum += x;
    if (x > peak) {
      peak = x;
      peakAt = day.start + i * MIN_MS;
    }
  });
  // Ignore a sliver of grazing sun: under ~1 % of a full sun does nothing.
  return { spans: spans(day, (i) => w[i] > 10), peak, peakAt, total: sum / 60 / 1000 };
}
