import { MET_API } from '../config';
import { withStored, type Fetched } from '../offline/dataCache';
import type { PointWeather, WeatherStep } from '../domain/weather';

/*
 * MET Norway Locationforecast 2.0 (the data behind yr.no). Open data, CC BY 4.0.
 * https://api.met.no/weatherapi/locationforecast/2.0/documentation
 *
 * Terms we follow (https://api.met.no/doc/TermsOfService):
 * - Identification: browsers can't set User-Agent, so MET identifies us by the
 *   Origin header the browser sends.
 * - No custom request headers: MET doesn't answer CORS preflights, so we can't
 *   send If-Modified-Since ourselves. The browser's HTTP cache does it for us
 *   (it honours Expires and revalidates with Last-Modified), and the memory
 *   cache below doesn't even ask before Expires.
 * - At most 4 decimals. We round to 3 (~100 m, finer than the model grid) so
 *   nearby taps share one answer.
 */

interface MetDetails {
  air_temperature?: number;
  dew_point_temperature?: number;
  relative_humidity?: number;
  wind_speed?: number;
  wind_speed_of_gust?: number;
  wind_from_direction?: number;
  cloud_area_fraction?: number;
  cloud_area_fraction_low?: number;
  cloud_area_fraction_medium?: number;
  cloud_area_fraction_high?: number;
  fog_area_fraction?: number;
}
interface MetPeriod {
  summary?: { symbol_code?: string };
  details?: { precipitation_amount?: number; precipitation_amount_max?: number; probability_of_precipitation?: number };
}
interface MetResponse {
  properties: {
    meta: { updated_at: string };
    timeseries: {
      time: string;
      data: { instant: { details: MetDetails }; next_1_hours?: MetPeriod; next_6_hours?: MetPeriod; next_12_hours?: MetPeriod };
    }[];
  };
}

const HOUR = 3_600_000;

/** MET's answer → our steps. Uses the 1-hour periods while there are any, then non-overlapping 6-hour ones. */
export function fromMet(raw: MetResponse, lat: number, lon: number, altitude?: number): PointWeather {
  let coveredUntil = -Infinity;
  const steps: WeatherStep[] = [];
  for (const t of raw.properties.timeseries) {
    const d = t.data.instant.details;
    if (d.air_temperature == null) continue;
    const time = Date.parse(t.time);
    let period: MetPeriod | undefined, hours = 0;
    if (t.data.next_1_hours) [period, hours] = [t.data.next_1_hours, 1];
    else if (t.data.next_6_hours && time >= coveredUntil) [period, hours] = [t.data.next_6_hours, 6];
    if (hours) coveredUntil = time + hours * HOUR;
    const p = period?.details;
    steps.push({
      time,
      hours,
      temp: d.air_temperature,
      dewPoint: d.dew_point_temperature,
      humidity: d.relative_humidity,
      wind: d.wind_speed ?? 0,
      gust: d.wind_speed_of_gust,
      windFrom: d.wind_from_direction ?? 0,
      cloud: d.cloud_area_fraction ?? 0,
      cloudLow: d.cloud_area_fraction_low,
      cloudMid: d.cloud_area_fraction_medium,
      cloudHigh: d.cloud_area_fraction_high,
      fog: d.fog_area_fraction,
      precip: p?.precipitation_amount ?? 0,
      precipMax: p?.precipitation_amount_max,
      precipProb: p?.probability_of_precipitation,
      symbol: (period ?? t.data.next_6_hours ?? t.data.next_12_hours)?.summary?.symbol_code,
    });
  }
  return { source: 'MET Norway', lat, lon, altitude, updated: Date.parse(raw.properties.meta.updated_at), steps };
}

const memory = new Map<string, { data: PointWeather; expires: number }>();

/**
 * Forecast for a point, adjusted to `altitude` (m) when given: MET corrects the
 * temperature to that height, so rain/snow is judged for the summit, not the valley.
 * Falls back to the copy stored on the device when there's no network.
 */
export async function fetchPointWeather(lat: number, lon: number, altitude?: number): Promise<Fetched<PointWeather>> {
  const la = +lat.toFixed(3), lo = +lon.toFixed(3);
  const alt = altitude == null ? undefined : Math.round(altitude);
  const key = `${la},${lo},${alt ?? ''}`;
  const hit = memory.get(key);
  if (hit && hit.expires > Date.now()) return { data: hit.data, savedAt: null };

  return withStored('weather', key, async () => {
    const url = `${MET_API}/locationforecast/2.0/complete?lat=${la}&lon=${lo}${alt == null ? '' : `&altitude=${alt}`}`;
    const res = await fetch(url); // no custom headers: they would trigger a CORS preflight, which MET doesn't allow
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = fromMet((await res.json()) as MetResponse, la, lo, alt);
    const expires = Date.parse(res.headers.get('Expires') ?? '') || Date.now() + 30 * 60_000;
    memory.set(key, { data, expires });
    return data;
  });
}
