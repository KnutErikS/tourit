import { OPEN_METEO_API } from '../config';
import { withStored, type Fetched } from '../offline/dataCache';
import type { AirLevel, AirProfile } from '../domain/weather';
import type { WindHour } from '../domain/wind';

/*
 * Open-Meteo: the atmosphere above the point, which MET's point forecast doesn't
 * give. We take DWD's ICON model (ICON-EU 7 km for ~5 days, then global ICON):
 * it is the one with cloud cover on every pressure level up to 500 hPa (~5 km)
 * plus the freezing level, for about 7.5 days. ECMWF and MET Nordic only have
 * 1000/850/700 hPa here, too coarse to place a cloud layer.
 *
 * Free for non-commercial use, no key, CC BY 4.0 ("Weather data by Open-Meteo.com").
 * https://open-meteo.com/en/docs
 */

/** Pressure levels (hPa) ICON has on Open-Meteo, bottom to top. */
const LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500];
const MODEL = 'icon_seamless';
/** Open-Meteo sends no Expires; ICON runs every 3 hours, so an hour is plenty. */
const TTL_MS = 60 * 60_000;

interface OmResponse {
  hourly: Record<string, (number | null)[]> & { time: number[] };
}

const vars = ['freezing_level_height', ...LEVELS.flatMap((l) => [`cloud_cover_${l}hPa`, `geopotential_height_${l}hPa`, `temperature_${l}hPa`, `relative_humidity_${l}hPa`])];

export function fromOpenMeteo(raw: OmResponse): AirProfile[] {
  const h = raw.hourly;
  const out: AirProfile[] = [];
  h.time.forEach((t, i) => {
    const levels: AirLevel[] = [];
    for (const l of LEVELS) {
      const height = h[`geopotential_height_${l}hPa`]?.[i], cover = h[`cloud_cover_${l}hPa`]?.[i];
      // Levels under sea level are extrapolated below the ground: no use.
      if (height == null || cover == null || height < 0) continue;
      levels.push({ h: height, cover, temp: h[`temperature_${l}hPa`]?.[i] ?? undefined, rh: h[`relative_humidity_${l}hPa`]?.[i] ?? undefined });
    }
    if (levels.length < 2) return; // past the end of ICON's range
    out.push({ time: t * 1000, levels, freezingLevel: h.freezing_level_height?.[i] ?? undefined });
  });
  return out;
}

const memory = new Map<string, { data: AirProfile[]; expires: number }>();

/** Hourly air profiles above the point. Rounded to ~1 km: the model grid is 7 km, so nearby taps share one answer. */
export async function fetchAirProfile(lat: number, lon: number): Promise<Fetched<AirProfile[]>> {
  const la = +lat.toFixed(2), lo = +lon.toFixed(2);
  const key = `${la},${lo}`;
  const hit = memory.get(key);
  if (hit && hit.expires > Date.now()) return { data: hit.data, savedAt: null };

  return withStored('profile', key, async () => {
    const url = `${OPEN_METEO_API}/forecast?latitude=${la}&longitude=${lo}&hourly=${vars.join(',')}&models=${MODEL}&forecast_days=8&timeformat=unixtime`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = fromOpenMeteo((await res.json()) as OmResponse);
    memory.set(key, { data, expires: Date.now() + TTL_MS });
    return data;
  });
}

/* ---------- wind history, for wind-loaded slopes ---------- */

/** The forecast API keeps about three months of past hours; older dates go to the archive of past forecasts. */
const OPEN_METEO_HISTORY_API = 'https://historical-forecast-api.open-meteo.com/v1';
const RECENT_DAYS = 80;
const DAY = 86_400_000;

interface OmPoint {
  hourly: {
    time: number[];
    wind_speed_850hPa: (number | null)[];
    wind_direction_850hPa: (number | null)[];
    temperature_850hPa?: (number | null)[];
    precipitation?: (number | null)[];
    cloud_cover?: (number | null)[];
  };
}

export interface WindPoint {
  lat: number;
  lon: number;
}

/** UTC date, YYYY-MM-DD (Open-Meteo's start/end dates are in GMT unless a timezone is given). */
const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Hourly 850 hPa wind and temperature, precipitation and cloud cover, for many points in one request, from `start` to `end` (ms).
 * `key` names the stored copy (one per warning date), for use without network.
 */
export async function fetchWindHistory(points: WindPoint[], start: number, end: number, key: string): Promise<Fetched<WindHour[][]>> {
  // v3: hours carry cloud cover too (Verktøy: night refreeze, first fine day); older stored copies lack it.
  return withStored('wind', `v3:${key}`, async () => {
    const api = start < Date.now() - RECENT_DAYS * DAY ? OPEN_METEO_HISTORY_API : OPEN_METEO_API;
    const url =
      `${api}/forecast?latitude=${points.map((p) => p.lat.toFixed(2)).join(',')}` +
      `&longitude=${points.map((p) => p.lon.toFixed(2)).join(',')}` +
      `&hourly=wind_speed_850hPa,wind_direction_850hPa,temperature_850hPa,precipitation,cloud_cover&models=${MODEL}&wind_speed_unit=ms&timeformat=unixtime` +
      `&start_date=${utcDate(start)}&end_date=${utcDate(end)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = (await res.json()) as OmPoint | OmPoint[];
    // One point gives an object, several give an array.
    return (Array.isArray(raw) ? raw : [raw]).map(({ hourly: h }) =>
      h.time.flatMap((t, i) => {
        const speed = h.wind_speed_850hPa[i], from = h.wind_direction_850hPa[i];
        if (speed == null || from == null) return [];
        return [{
          time: t * 1000,
          speed,
          from,
          temp: h.temperature_850hPa?.[i] ?? undefined,
          precip: h.precipitation?.[i] ?? undefined,
          cloud: h.cloud_cover?.[i] ?? undefined,
        }];
      }),
    );
  });
}

/* ---------- weather history at a point, for loading, thaw and the infos ---------- */

/** One hour at the point, 2 m above the ground at the point's height. */
export interface PointHour {
  /** End of the hour, ms (Open-Meteo's precipitation is for the hour ending here). */
  time: number;
  /** °C */
  temp: number;
  /** Relative humidity, % */
  rh?: number;
  /** mm water in the hour */
  precip: number;
  /** Total cloud cover, % */
  cloud?: number;
}

interface OmHistory {
  hourly: {
    time: number[];
    temperature_2m: (number | null)[];
    relative_humidity_2m?: (number | null)[];
    precipitation?: (number | null)[];
    cloud_cover?: (number | null)[];
  };
}

/** Days before the chosen day to fetch: covers 72 h before its start, with a day to spare for UTC dates. */
const HISTORY_DAYS = 4;
/** Heights are rounded to this, m, so nearby taps on the same slope share one answer. */
const HEIGHT_STEP = 50;
const historyMemory = new Map<string, { data: Promise<Fetched<PointHour[]>>; expires: number }>();

/**
 * Hourly weather at the point from HISTORY_DAYS before `date` (YYYY-MM-DD,
 * local) to the end of it: past hours are ICON's own forecasts, the rest the
 * current forecast. `elev` (m, from the DEM) is passed as Open-Meteo's
 * `elevation`, which downscales to that height; without it Open-Meteo uses
 * its own 90 m terrain model at the point.
 * Rounded to ~1 km and HEIGHT_STEP m; kept in memory for an hour and stored
 * on the device for use without network.
 */
export function fetchPointHistory(lat: number, lon: number, elev: number | null | undefined, date: string): Promise<Fetched<PointHour[]>> {
  const la = +lat.toFixed(2), lo = +lon.toFixed(2);
  const h = elev != null && Number.isFinite(elev) ? Math.round(elev / HEIGHT_STEP) * HEIGHT_STEP : null;
  const key = `${la},${lo},${h ?? 'dem'}:${date}`;
  const hit = historyMemory.get(key);
  if (hit && hit.expires > Date.now()) return hit.data;

  const dayStart = new Date(date + 'T00:00:00').getTime();
  const start = dayStart - HISTORY_DAYS * DAY;
  const data = withStored('history', key, async () => {
    const api = start < Date.now() - RECENT_DAYS * DAY ? OPEN_METEO_HISTORY_API : OPEN_METEO_API;
    const url =
      `${api}/forecast?latitude=${la}&longitude=${lo}` +
      (h != null ? `&elevation=${h}` : '') +
      `&hourly=temperature_2m,relative_humidity_2m,precipitation,cloud_cover&models=${MODEL}&timeformat=unixtime` +
      `&start_date=${utcDate(start)}&end_date=${utcDate(dayStart + DAY - 1)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { hourly: x } = (await res.json()) as OmHistory;
    return x.time.flatMap((t, i): PointHour[] => {
      const temp = x.temperature_2m[i];
      if (temp == null) return [];
      return [{
        time: t * 1000,
        temp,
        rh: x.relative_humidity_2m?.[i] ?? undefined,
        precip: x.precipitation?.[i] ?? 0,
        cloud: x.cloud_cover?.[i] ?? undefined,
      }];
    });
  });
  historyMemory.set(key, { data, expires: Date.now() + TTL_MS });
  // A stored copy (no network) is not kept in memory, so the next call tries the network again.
  data.then((r) => r.savedAt !== null && historyMemory.delete(key), () => historyMemory.delete(key));
  return data;
}
