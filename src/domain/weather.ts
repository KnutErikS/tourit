/**
 * Weather for one point, independent of where it came from.
 *
 * MET Norway's Locationforecast (yr's data) gives the steps. An air profile
 * from another model (Open-Meteo / ICON, see `withProfile`) adds what MET
 * doesn't have: cloud cover per height, cloud layers in metres, the freezing
 * level and the snow line. Everything below works with or without it.
 */

/** One forecast time. Instant values (temperature, wind, cloud) are at `time`; precipitation is for the period after it. */
export interface WeatherStep {
  /** ms since epoch */
  time: number;
  /** Length of the precipitation period from `time`, in hours (1 or 6; 0 = no precipitation data for this step). */
  hours: number;
  /** °C at the forecast altitude */
  temp: number;
  dewPoint?: number;
  /** Relative humidity, % */
  humidity?: number;
  /** m/s */
  wind: number;
  gust?: number;
  /** Degrees the wind comes from (0 = from north). */
  windFrom: number;
  /** Cloud cover, %: total, and split in low/middle/high bands where the source has it. */
  cloud: number;
  cloudLow?: number;
  cloudMid?: number;
  cloudHigh?: number;
  fog?: number;
  /** Precipitation over the period, mm (expected, and the upper estimate). */
  precip: number;
  precipMax?: number;
  /** Probability of precipitation, % */
  precipProb?: number;
  /** Source's own weather symbol (MET/yr symbol code, e.g. "lightsnowshowers_day"). */
  symbol?: string;
  /** Air above the point at this time, when a profile source is merged in. */
  air?: AirProfile;
  /** Cloud layers worked out from `air`, bottom first. */
  cloudLayers?: CloudLayer[];
  /** Height where all precipitation is snow (wet-bulb ≤ 0.5 °C from here up), m. Worked out from `air`. */
  snowLine?: number;
  /**
   * Snowfall over the period in cm, if a source gives it in step with `precip`.
   * Not filled from ICON: its snowfall comes from a different model run than
   * MET's precipitation, so the two would disagree. Estimated otherwise.
   */
  snowCm?: number;
}

/** One pressure level of a profile. */
export interface AirLevel {
  /** Height above sea level, m */
  h: number;
  /** Cloud cover at this height, % */
  cover: number;
  temp?: number;
  rh?: number;
}

/** The air above a point at one time. */
export interface AirProfile {
  time: number;
  /** Bottom to top. */
  levels: AirLevel[];
  /** Height of 0 °C, m */
  freezingLevel?: number;
}

export interface CloudLayer {
  base: number;
  top: number;
  /** Highest cover inside the layer, % */
  cover: number;
  /** The layer starts at the lowest level we have, so the real base may be lower. */
  openBase: boolean;
  /** The layer reaches the highest level we have (~5 km), so the real top may be higher. */
  openTop: boolean;
}

export interface PointWeather {
  /** Attribution, e.g. "MET Norway". */
  source: string;
  /** Attribution for the merged air profile, if any. */
  profileSource?: string;
  lat: number;
  lon: number;
  /** Altitude the forecast is adjusted to (m), or undefined for the model's own terrain. */
  altitude?: number;
  /** When the forecast was made (ms). */
  updated: number;
  steps: WeatherStep[];
}

/* ---------- rain or snow ---------- */

/**
 * Wet-bulb temperature (Stull 2011) from air temperature (°C) and relative humidity (%).
 * Falling snow melts by the wet-bulb temperature, not the air temperature: in dry
 * air it stays snow a degree or two above zero.
 */
export function wetBulb(t: number, rh: number): number {
  const h = Math.min(99, Math.max(5, rh));
  return (
    t * Math.atan(0.151977 * Math.sqrt(h + 8.313659)) +
    Math.atan(t + h) -
    Math.atan(h - 1.676331) +
    0.00391838 * Math.pow(h, 1.5) * Math.atan(0.023101 * h) -
    4.686035
  );
}

/** Share of the precipitation that falls as snow (0–1). */
export function snowFraction(s: Pick<WeatherStep, 'temp' | 'humidity'>): number {
  if (s.temp <= -1) return 1;
  // Wet-bulb: all snow at ≤ 0.5 °C, all rain at ≥ 1.5 °C. Without humidity, air temperature 0.5–2.5 °C.
  const [x, lo, hi] = s.humidity != null ? [wetBulb(s.temp, s.humidity), 0.5, 1.5] : [s.temp, 0.5, 2.5];
  return Math.min(1, Math.max(0, (hi - x) / (hi - lo)));
}

export type Phase = 'snow' | 'sleet' | 'rain';
export const phaseOf = (frac: number): Phase => (frac >= 0.9 ? 'snow' : frac <= 0.1 ? 'rain' : 'sleet');
export const PHASE_NAME: Record<Phase, string> = { snow: 'snø', sleet: 'sludd', rain: 'regn' };

/** Centimetres of new snow per mm of water: colder snow is lighter and fluffier. */
export function snowRatio(temp: number): number {
  if (temp <= -10) return 1.5;
  if (temp <= -4) return 1.2;
  if (temp <= -1) return 1.0;
  return 0.8; // near zero: wet, dense snow
}

/** Snow for one step: mm of water and cm of snow (from the source if given, else estimated). */
export function stepSnow(s: WeatherStep): { mm: number; cm: number } {
  const mm = s.precip * snowFraction(s);
  return { mm, cm: s.snowCm ?? mm * snowRatio(s.temp) };
}

/* ---------- summaries ---------- */

export interface WeatherSummary {
  from: number;
  to: number;
  /** The forecast covers only part of the window (ends before `to`). */
  partial: boolean;
  tempMin: number;
  tempMax: number;
  windMax: number;
  gustMax?: number;
  /** Direction of the strongest wind. */
  windFrom: number;
  cloudAvg: number;
  cloudLowAvg?: number;
  cloudMidAvg?: number;
  cloudHighAvg?: number;
  fogMax?: number;
  precip: number;
  precipMax?: number;
  snowMm: number;
  snowCm: number;
  /** Highest probability of precipitation in the window. */
  precipProb?: number;
}

const HOUR = 3_600_000;
const avg = (xs: (number | undefined)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
};

/** Sum up the steps that fall in [from, to). Precipitation periods that stick out of the window count in part. */
export function summarize(steps: WeatherStep[], from: number, to: number): WeatherSummary | null {
  const inside = steps.filter((s) => s.time >= from && s.time < to);
  // A 6-hour period starting before the window can still reach into it.
  const wet = steps.filter((s) => s.hours > 0 && s.time < to && s.time + s.hours * HOUR > from);
  if (!inside.length && !wet.length) return null;
  const inst = inside.length ? inside : [wet[wet.length - 1]];

  let precip = 0, precipMax = 0, snowMm = 0, snowCm = 0, hasMax = false;
  for (const s of wet) {
    const start = Math.max(s.time, from), end = Math.min(s.time + s.hours * HOUR, to);
    const part = (end - start) / (s.hours * HOUR);
    const snow = stepSnow(s);
    precip += s.precip * part;
    snowMm += snow.mm * part;
    snowCm += snow.cm * part;
    if (s.precipMax != null) hasMax = true;
    precipMax += (s.precipMax ?? s.precip) * part;
  }
  const covered = Math.max(...steps.map((s) => s.time + Math.max(s.hours, 1) * HOUR));
  const windiest = inst.reduce((a, b) => (b.wind > a.wind ? b : a));
  const gusts = inst.map((s) => s.gust).filter((g): g is number => g != null);
  const probs = wet.map((s) => s.precipProb).filter((p): p is number => p != null);
  const fogs = inst.map((s) => s.fog).filter((f): f is number => f != null);
  return {
    from,
    to,
    partial: covered < to,
    tempMin: Math.min(...inst.map((s) => s.temp)),
    tempMax: Math.max(...inst.map((s) => s.temp)),
    windMax: windiest.wind,
    gustMax: gusts.length ? Math.max(...gusts) : undefined,
    windFrom: windiest.windFrom,
    cloudAvg: avg(inst.map((s) => s.cloud)) ?? 0,
    cloudLowAvg: avg(inst.map((s) => s.cloudLow)),
    cloudMidAvg: avg(inst.map((s) => s.cloudMid)),
    cloudHighAvg: avg(inst.map((s) => s.cloudHigh)),
    fogMax: fogs.length ? Math.max(...fogs) : undefined,
    precip,
    precipMax: hasMax ? precipMax : undefined,
    snowMm,
    snowCm,
    precipProb: probs.length ? Math.max(...probs) : undefined,
  };
}

/** "klart", "lettskyet" … from cloud cover in %. */
export function skyText(cloud: number, fog?: number): string {
  if (fog != null && fog >= 50) return 'tåke';
  if (cloud < 15) return 'klart';
  if (cloud < 40) return 'lettskyet';
  if (cloud < 70) return 'delvis skyet';
  if (cloud < 90) return 'skyet';
  return 'overskyet';
}

/** Steps spread at least `gapH` hours apart, for a compact timeline. */
export function spread(steps: WeatherStep[], from: number, to: number, gapH = 3): WeatherStep[] {
  const out: WeatherStep[] = [];
  for (const s of steps) {
    if (s.time < from || s.time >= to) continue;
    if (!out.length || s.time - out[out.length - 1].time >= gapH * HOUR) out.push(s);
  }
  return out;
}

/** Total precipitation from `s` up to the next shown step (so a 3-hourly timeline shows 3 hours of it). */
export function precipUntil(steps: WeatherStep[], from: number, to: number): { mm: number; snowFrac: number } {
  let mm = 0, snow = 0;
  for (const s of steps) {
    if (s.hours <= 0 || s.time >= to || s.time + s.hours * HOUR <= from) continue;
    const part = (Math.min(s.time + s.hours * HOUR, to) - Math.max(s.time, from)) / (s.hours * HOUR);
    mm += s.precip * part;
    snow += stepSnow(s).mm * part;
  }
  return { mm, snowFrac: mm > 0 ? snow / mm : 0 };
}

/* ---------- air profile: cloud layers, snow line ---------- */

/** Cloud cover (%) at which a level counts as inside a cloud layer. */
export const CLOUD_COVER_MIN = 50;

/** Height between two levels where `value` crosses `at`, by linear interpolation. */
const cross = (a: AirLevel, b: AirLevel, va: number, vb: number, at: number) => a.h + ((at - va) / (vb - va)) * (b.h - a.h);

/** Contiguous runs of levels with cloud cover ≥ `min`, with base/top interpolated between levels. */
export function cloudLayers(levels: AirLevel[], min = CLOUD_COVER_MIN): CloudLayer[] {
  const out: CloudLayer[] = [];
  let cur: CloudLayer | null = null;
  levels.forEach((l, i) => {
    const cloudy = l.cover >= min, prev = levels[i - 1];
    if (cloudy && !cur) {
      cur = { base: prev ? cross(prev, l, prev.cover, l.cover, min) : l.h, top: l.h, cover: l.cover, openBase: !prev, openTop: false };
      out.push(cur);
    } else if (cloudy && cur) {
      cur.top = l.h;
      cur.cover = Math.max(cur.cover, l.cover);
    } else if (!cloudy && cur) {
      cur.top = cross(prev, l, prev.cover, l.cover, min);
      cur = null;
    }
  });
  if (cur) (cur as CloudLayer).openTop = true;
  return out;
}

/**
 * Lowest height with all snow from there up (wet-bulb ≤ 0.5 °C, the same rule as `snowFraction`).
 * 0 when even the lowest level is cold enough: snow all the way down.
 */
export function snowLine(levels: AirLevel[]): number | undefined {
  const tw = levels.map((l) => (l.temp == null ? undefined : l.rh == null ? l.temp : wetBulb(l.temp, l.rh)));
  if (tw.some((t) => t == null)) return undefined;
  const t = tw as number[], LIMIT = 0.5;
  let i = t.length - 1;
  if (t[i] > LIMIT) return undefined; // warm all the way up
  while (i > 0 && t[i - 1] <= LIMIT) i--;
  return i === 0 ? 0 : cross(levels[i - 1], levels[i], t[i - 1], t[i], LIMIT);
}

/** Merge hourly air profiles into the steps at the same time. */
export function withProfile(w: PointWeather, profiles: AirProfile[], source: string): PointWeather {
  const byTime = new Map(profiles.map((p) => [p.time, p]));
  const steps = w.steps.map((s) => {
    const air = byTime.get(s.time);
    return air ? { ...s, air, cloudLayers: cloudLayers(air.levels), snowLine: snowLine(air.levels) } : s;
  });
  return { ...w, steps, profileSource: source };
}

/** Where the point is relative to the cloud at one time. */
export type CloudPlace = 'in' | 'above' | 'below' | 'between' | 'clear';

export function cloudPlace(layers: CloudLayer[], alt: number): CloudPlace {
  if (!layers.length) return 'clear';
  if (layers.some((l) => l.base <= alt && alt <= l.top)) return 'in';
  const under = layers.some((l) => l.top < alt), over = layers.some((l) => l.base > alt);
  return under && over ? 'between' : under ? 'above' : 'below';
}

const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
};

export interface AirSummary {
  /** Number of steps with a profile in the window. */
  n: number;
  /** How many of those steps the point is in / above / below / between / clear of cloud. */
  places: Record<CloudPlace, number>;
  /** Typical (median) lowest layer, among steps that have one. */
  low?: { base: number; top: number; openBase: boolean; openTop: boolean };
  freezing?: { min: number; max: number };
  snowLine?: { min: number; max: number };
}

export function summarizeAir(steps: WeatherStep[], from: number, to: number, alt: number): AirSummary | null {
  const inside = steps.filter((s) => s.air && s.time >= from && s.time < to);
  if (!inside.length) return null;
  const places: Record<CloudPlace, number> = { in: 0, above: 0, below: 0, between: 0, clear: 0 };
  for (const s of inside) places[cloudPlace(s.cloudLayers ?? [], alt)]++;
  const lows = inside.map((s) => s.cloudLayers?.[0]).filter((l): l is CloudLayer => !!l);
  const range = (xs: (number | undefined)[]) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? { min: Math.min(...v), max: Math.max(...v) } : undefined;
  };
  return {
    n: inside.length,
    places,
    low: lows.length
      ? { base: median(lows.map((l) => l.base)), top: median(lows.map((l) => l.top)), openBase: lows.some((l) => l.openBase), openTop: lows.some((l) => l.openTop) }
      : undefined,
    freezing: range(inside.map((s) => s.air!.freezingLevel)),
    snowLine: range(inside.map((s) => s.snowLine)),
  };
}
