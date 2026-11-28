import { OPEN_METEO_API, OPEN_METEO_MARINE_API } from '../config';
import { asList, toSurfHours, type OmLocation, type SurfHour } from '../domain/surf';
import type { SurfSpot } from '../domain/surfSpots';
import { type Fetched, withStored } from '../offline/dataCache';
import { getJson } from '../util';

/*
 * Waves and wind for every surf spot in two requests (Open-Meteo takes a list of
 * coordinates): the marine API for swell and wind sea, the forecast API for the
 * 10 m wind at the beach. About 7 days ahead, hourly. Stored on the device, so
 * the list still shows the last forecast without network.
 *
 * Free for non-commercial use, no key, CC BY 4.0 ("Weather data by Open-Meteo.com").
 * https://open-meteo.com/en/docs/marine-weather-api
 */

const MARINE_VARS = [
  'wave_height', 'wave_direction', 'wave_period', 'wave_peak_period',
  'swell_wave_height', 'swell_wave_direction', 'swell_wave_period', 'swell_wave_peak_period',
  'wind_wave_height', 'sea_surface_temperature',
];
const WIND_VARS = ['wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m'];
const DAYS = 7;
/** Open-Meteo sends no Expires; the wave models run every 6–12 hours, so an hour is plenty. */
const TTL_MS = 60 * 60_000;

/**
 * Which wave model: Open-Meteo's best match (DWD EWAM ~5 km for ~3 days, then
 * ECMWF WAM), or NOAA's GFS-Wave (WAVEWATCH III driven by GFS winds, 0.25°),
 * the model family surf-forecast.com uses, to compare the two.
 */
export type SurfModel = 'best_match' | 'ncep_gfswave025';
export const SURF_MODELS: Record<SurfModel, { label: string; short: string; source: string }> = {
  best_match: { label: 'DWD/ECMWF', short: 'DWD/ECMWF', source: 'DWD EWAM (ca. 5 km, ca. 3 døgn), deretter ECMWF WAM (9 km)' },
  ncep_gfswave025: { label: 'NOAA GFS-Wave', short: 'NOAA', source: 'NOAA GFS-Wave (WAVEWATCH III med GFS-vind, ca. 25 km), samme modellfamilie som surf-forecast.com' },
};
export const isSurfModel = (v: unknown): v is SurfModel => v === 'best_match' || v === 'ncep_gfswave025';

export interface SpotForecast {
  id: string;
  hours: SurfHour[];
}

/** One answer per model, kept for TTL_MS. */
const memory = new Map<string, { data: SpotForecast[]; expires: number }>();

const coords = (spots: SurfSpot[]) =>
  `latitude=${spots.map((s) => s.lat).join(',')}&longitude=${spots.map((s) => s.lng).join(',')}`;

export async function fetchSurf(spots: SurfSpot[], model: SurfModel = 'best_match'): Promise<Fetched<SpotForecast[]>> {
  const key = `${model}|${spots.map((s) => s.id).join(',')}`;
  const hit = memory.get(key);
  if (hit && hit.expires > Date.now()) return { data: hit.data, savedAt: null };
  // Stored per model: the default keeps its old key, so a copy stored before the choice existed still counts.
  return withStored('surf', model === 'best_match' ? 'all' : model, async () => {
    const q = `${coords(spots)}&forecast_days=${DAYS}&timeformat=unixtime`;
    const [marine, wind] = await Promise.all([
      getJson<OmLocation | OmLocation[]>(
        `${OPEN_METEO_MARINE_API}/marine?${q}&hourly=${MARINE_VARS.join(',')}&cell_selection=sea${model === 'best_match' ? '' : `&models=${model}`}`,
      ),
      // Waves without wind are still worth showing: the rating then leaves the wind out.
      getJson<OmLocation | OmLocation[]>(`${OPEN_METEO_API}/forecast?${q}&hourly=${WIND_VARS.join(',')}&wind_speed_unit=ms`).catch(() => null),
    ]);
    const m = asList(marine), w = wind ? asList(wind) : [];
    if (m.length !== spots.length) throw new Error('uventet svar fra Open-Meteo');
    const data = spots.map((s, i) => ({ id: s.id, hours: toSurfHours(m[i], w.length === spots.length ? w[i] : null) }));
    memory.set(key, { data, expires: Date.now() + TTL_MS });
    return data;
  });
}
