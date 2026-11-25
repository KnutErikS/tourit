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

export interface SpotForecast {
  id: string;
  hours: SurfHour[];
}

let memory: { data: SpotForecast[]; expires: number; key: string } | null = null;

const coords = (spots: SurfSpot[]) =>
  `latitude=${spots.map((s) => s.lat).join(',')}&longitude=${spots.map((s) => s.lng).join(',')}`;

export async function fetchSurf(spots: SurfSpot[]): Promise<Fetched<SpotForecast[]>> {
  const key = spots.map((s) => s.id).join(',');
  if (memory && memory.key === key && memory.expires > Date.now()) return { data: memory.data, savedAt: null };
  return withStored('surf', 'all', async () => {
    const q = `${coords(spots)}&forecast_days=${DAYS}&timeformat=unixtime`;
    const [marine, wind] = await Promise.all([
      getJson<OmLocation | OmLocation[]>(`${OPEN_METEO_MARINE_API}/marine?${q}&hourly=${MARINE_VARS.join(',')}&cell_selection=sea`),
      // Waves without wind are still worth showing: the rating then leaves the wind out.
      getJson<OmLocation | OmLocation[]>(`${OPEN_METEO_API}/forecast?${q}&hourly=${WIND_VARS.join(',')}&wind_speed_unit=ms`).catch(() => null),
    ]);
    const m = asList(marine), w = wind ? asList(wind) : [];
    if (m.length !== spots.length) throw new Error('uventet svar fra Open-Meteo');
    const data = spots.map((s, i) => ({ id: s.id, hours: toSurfHours(m[i], w.length === spots.length ? w[i] : null) }));
    memory = { data, expires: Date.now() + TTL_MS, key };
    return data;
  });
}
