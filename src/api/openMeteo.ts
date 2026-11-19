import { OPEN_METEO_API } from '../config';
import { withStored, type Fetched } from '../offline/dataCache';
import type { AirLevel, AirProfile } from '../domain/weather';

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
