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
  hourly: { time: number[]; wind_speed_850hPa: (number | null)[]; wind_direction_850hPa: (number | null)[] };
}

export interface WindPoint {
  lat: number;
  lon: number;
}

/** UTC date, YYYY-MM-DD (Open-Meteo's start/end dates are in GMT unless a timezone is given). */
const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Hourly 850 hPa wind for many points in one request, from `start` to `end` (ms).
 * `key` names the stored copy (one per warning date), for use without network.
 */
export async function fetchWindHistory(points: WindPoint[], start: number, end: number, key: string): Promise<Fetched<WindHour[][]>> {
  return withStored('wind', key, async () => {
    const api = start < Date.now() - RECENT_DAYS * DAY ? OPEN_METEO_HISTORY_API : OPEN_METEO_API;
    const url =
      `${api}/forecast?latitude=${points.map((p) => p.lat.toFixed(2)).join(',')}` +
      `&longitude=${points.map((p) => p.lon.toFixed(2)).join(',')}` +
      `&hourly=wind_speed_850hPa,wind_direction_850hPa&models=${MODEL}&wind_speed_unit=ms&timeformat=unixtime` +
      `&start_date=${utcDate(start)}&end_date=${utcDate(end)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = (await res.json()) as OmPoint | OmPoint[];
    // One point gives an object, several give an array.
    return (Array.isArray(raw) ? raw : [raw]).map(({ hourly: h }) =>
      h.time.flatMap((t, i) => {
        const speed = h.wind_speed_850hPa[i], from = h.wind_direction_850hPa[i];
        return speed == null || from == null ? [] : [{ time: t * 1000, speed, from }];
      }),
    );
  });
}
