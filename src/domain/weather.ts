/**
 * Weather for one point, independent of where it came from.
 *
 * MET Norway's Locationforecast (yr's data) fills it today. Other sources can
 * add what MET doesn't have: `cloudLayers` (cloud base/top in metres) and
 * `snowCm` (snowfall given directly) are there for that, and everything below
 * uses them when present and falls back to estimates otherwise.
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
  /** Cloud layers, metres above sea level, when a source gives them. */
  cloudLayers?: { base: number; top: number }[];
  /** Snowfall over the period in cm, when a source gives it (otherwise estimated from precip + temperature). */
  snowCm?: number;
}

export interface PointWeather {
  /** Attribution, e.g. "MET Norway". */
  source: string;
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
