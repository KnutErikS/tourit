import type * as L from 'leaflet';
import { alptruth, type Alptruth, type AlptruthInput } from '../domain/alptruth';
import { regionAt } from '../domain/geo';
import { loadingBefore, mergeSteps, thaw, type PrecipStep } from '../domain/precip';
import { signGroup } from '../domain/signs';
import { snowFraction, type PointWeather } from '../domain/weather';
import { snowShare, windowEnd, type WindHour } from '../domain/wind';
import { zoneAt } from '../route/runout';
import { state } from '../state';
import { slopeAround } from '../terrain/window';
import type { TerrainPoint } from '../types';
import { pointHistory } from './history';
import { regionSigns } from './signs';
import { loadTicks } from './ticks';

export interface AlptruthAssessment extends Alptruth {
  /** Region the point is in. */
  regionName: string | null;
  /** Danger level in the warning (0 = none). */
  level: number;
}

const HOUR = 3_600_000;
/** The hours of the day that count for thaw: a normal touring day (our own choice). */
const DAY_FROM = 'T08:00:00';
const DAY_TO = 'T16:00:00';

/**
 * Weather steps at the point: MET's forecast for the point (adjusted to the
 * point's height, rain/snow by wet-bulb) from where it starts, and before
 * that the history: the point's own (`history`, Open-Meteo at the point's
 * height, see tools/history.ts) when we have it, else the region's ICON hours
 * (850 hPa, ~1400 m, the middle of the region) as a fallback.
 */
export function pointSteps(hours: WindHour[] | null | undefined, weather: PointWeather | null | undefined, history?: PrecipStep[] | null): PrecipStep[] {
  const met: PrecipStep[] = (weather?.steps ?? []).map((s) => ({
    time: s.time,
    hours: s.hours,
    temp: s.temp,
    precip: s.precip,
    snowMm: s.precip * snowFraction(s),
    cloud: s.cloud,
  }));
  if (history?.length) return mergeSteps(history, met);
  const icon: PrecipStep[] = [];
  for (const h of hours ?? []) {
    // Open-Meteo's precipitation is for the hour ending at `time`.
    if (h.temp == null || h.precip == null) continue;
    icon.push({ time: h.time - HOUR, hours: 1, temp: h.temp, precip: h.precip, snowMm: h.precip * snowShare(h.temp), cloud: h.cloud });
  }
  return mergeSteps(icon, met);
}

/**
 * ALPTRUTh for one point (the tapped point, or your position) on the chosen
 * day, with your own ticks. `weather` is MET's forecast for the point, if
 * loaded; without it the region's ICON hours are used throughout.
 */
export async function assessAlptruth(
  ll: L.LatLng,
  terrain: TerrainPoint | null | undefined,
  weather: PointWeather | null | undefined,
): Promise<AlptruthAssessment> {
  const region = regionAt(state.regions, ll);
  const level = region?.warn?.level ?? 0;
  const hits = regionSigns(region, terrain);

  const history = pointHistory(ll, terrain, state.date); // in parallel with the terrain
  const [win, zone] = await Promise.all([slopeAround(ll).catch(() => null), zoneAt(ll).catch(() => undefined)]);

  const steps = pointSteps(region?.hours, weather, await history);
  const input: AlptruthInput = {
    level,
    signs: hits && {
      avalanche: signGroup(hits, ['avalanche']),
      loading: signGroup(hits, ['windSnow', 'heavySnow']),
      unstable: signGroup(hits, ['whumpf', 'cracks', 'poorTest']),
      thaw: signGroup(hits, ['warming', 'wetSnow']),
    },
    steep: win?.track ?? terrain?.slope ?? null,
    zone,
    loading: loadingBefore(steps, windowEnd(state.date)),
    lee: region?.wind && terrain ? region.wind.lee[terrain.sector] : null,
    thaw: thaw(steps, new Date(state.date + DAY_FROM).getTime(), new Date(state.date + DAY_TO).getTime()),
  };
  return { ...alptruth(input, loadTicks(state.date, ll)), regionName: region?.name ?? null, level };
}
