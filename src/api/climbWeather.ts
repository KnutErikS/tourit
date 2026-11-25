import { OPEN_METEO_API } from '../config';
import { toClimbHours, type ClimbHour } from '../domain/climb';
import { getJson } from '../util';

/*
 * Hourly weather for climbing: rain (also the last two days, to know whether
 * the rock has dried), temperature, humidity, wind and cloud, per ~5 km grid
 * cell (domain/climb.ts cellOf), so neighbouring crags share one point. Only
 * the cells of the crags being shown are asked for, in batches: Open-Meteo
 * counts each location as one call, and the free tier allows 600 a minute.
 * Kept in memory for an hour; not stored (it needs to be fresh to be of use).
 * Open-Meteo, free for non-commercial use, CC BY 4.0.
 */

const VARS = ['temperature_2m', 'precipitation', 'relative_humidity_2m', 'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'cloud_cover'];
const BATCH = 50;
const TTL_MS = 60 * 60_000;

const memory = new Map<string, { hours: ClimbHour[]; expires: number }>();

/** Cells with fresh weather in memory. */
export function climbWeatherCached(cell: string): ClimbHour[] | null {
  const hit = memory.get(cell);
  return hit && hit.expires > Date.now() ? hit.hours : null;
}

/** Fetch the cells that aren't in memory ("lat,lng" strings). Resolves when all batches are in. */
export async function fetchClimbWeather(cells: string[]): Promise<void> {
  const want = [...new Set(cells)].filter((c) => !climbWeatherCached(c));
  for (let i = 0; i < want.length; i += BATCH) {
    const batch = want.slice(i, i + BATCH);
    const lat = batch.map((c) => c.split(',')[0]).join(','), lng = batch.map((c) => c.split(',')[1]).join(',');
    type Loc = Parameters<typeof toClimbHours>[0];
    const raw = await getJson<Loc | Loc[]>(
      `${OPEN_METEO_API}/forecast?latitude=${lat}&longitude=${lng}&hourly=${VARS.join(',')}&past_days=2&forecast_days=7&wind_speed_unit=ms&timeformat=unixtime`,
    );
    const list = Array.isArray(raw) ? raw : [raw];
    if (list.length !== batch.length) throw new Error('uventet svar fra Open-Meteo');
    batch.forEach((c, k) => memory.set(c, { hours: toClimbHours(list[k]), expires: Date.now() + TTL_MS }));
  }
}
