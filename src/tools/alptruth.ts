import type * as L from 'leaflet';
import { alptruth, type Alptruth, type AlptruthInput } from '../domain/alptruth';
import { regionAt } from '../domain/geo';
import { loadingBefore, thaw, type PrecipStep } from '../domain/precip';
import { signGroup } from '../domain/signs';
import { snowFraction, type PointWeather } from '../domain/weather';
import { snowShare, windowEnd, type WindHour } from '../domain/wind';
import { zoneAt } from '../route/runout';
import { state } from '../state';
import { slopeAround } from '../terrain/window';
import type { TerrainPoint } from '../types';
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
 * Weather steps at the point: Open-Meteo's hourly ICON history for the region
 * (850 hPa, ~1400 m) up to where MET's forecast for the point starts, then
 * MET (adjusted to the point's height, rain/snow by wet-bulb).
 */
export function pointSteps(hours: WindHour[] | null | undefined, weather: PointWeather | null | undefined): PrecipStep[] {
  const met: PrecipStep[] = (weather?.steps ?? []).map((s) => ({
    time: s.time,
    hours: s.hours,
    temp: s.temp,
    precip: s.precip,
    snowMm: s.precip * snowFraction(s),
  }));
  const metStart = met.length ? met[0].time : Infinity;
  const icon: PrecipStep[] = [];
  for (const h of hours ?? []) {
    // Open-Meteo's precipitation is for the hour ending at `time`.
    if (h.temp == null || h.precip == null || h.time > metStart) continue;
    icon.push({ time: h.time - HOUR, hours: 1, temp: h.temp, precip: h.precip, snowMm: h.precip * snowShare(h.temp) });
  }
  return [...icon, ...met];
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

  const [win, zone] = await Promise.all([slopeAround(ll).catch(() => null), zoneAt(ll).catch(() => undefined)]);

  const steps = pointSteps(region?.hours, weather);
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
