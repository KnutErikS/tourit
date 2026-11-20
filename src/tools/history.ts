import type * as L from 'leaflet';
import { fetchPointHistory } from '../api/openMeteo';
import type { PrecipStep } from '../domain/precip';
import { snowFraction } from '../domain/weather';
import type { TerrainPoint } from '../types';

const HOUR = 3_600_000;

/**
 * Give up waiting after this long, ms. A little past dataCache's 10 s, so a
 * stored copy gets its turn first; with bad signal and nothing stored the
 * request can otherwise hang for minutes. It keeps running and is stored when
 * it arrives, so the next tap has it.
 */
export const HISTORY_WAIT_MS = 12_000;

/**
 * The point's own weather history as steps (Open-Meteo at the point's DEM
 * height, 2 m above the ground), for loading, thaw, refreeze and the infos.
 * Rain/snow by wet-bulb at 2 m, as for MET's forecast. null when it can't be
 * had (no network and nothing stored, or no answer within HISTORY_WAIT_MS):
 * callers then fall back to the region's ICON hours at 850 hPa.
 *
 * Without terrain (still loading, or your position) Open-Meteo's own 90 m
 * terrain height is used: still the point, a little less exact in steep terrain.
 */
export async function pointHistory(
  ll: Pick<L.LatLng, 'lat' | 'lng'>,
  terrain: TerrainPoint | null | undefined,
  date: string,
  waitMs = HISTORY_WAIT_MS,
): Promise<PrecipStep[] | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), waitMs)));
  try {
    const got = await Promise.race([fetchPointHistory(ll.lat, ll.lng, terrain?.elev, date), late]);
    if (!got) return null;
    return got.data.map((h) => ({
      time: h.time - HOUR, // the hour ending at `time`
      hours: 1,
      temp: h.temp,
      precip: h.precip,
      snowMm: h.precip * snowFraction({ temp: h.temp, humidity: h.rh }),
      cloud: h.cloud,
    }));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
