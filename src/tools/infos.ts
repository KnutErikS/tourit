import type * as L from 'leaflet';
import { regionAt } from '../domain/geo';
import { hitsOf, infoRows, type Info, type InfoRow } from '../domain/infos';
import { CRIT_SHOW, criticalNewSnow, firstFineDay, firstThaw, rainAround, refreeze, thaw } from '../domain/precip';
import { signGroup } from '../domain/signs';
import { daylight, sunDay } from '../domain/sun';
import type { PointWeather } from '../domain/weather';
import { surfaces, windowEnd } from '../domain/wind';
import { snowCoverAt } from '../layers/snow';
import { state } from '../state';
import type { Picked, TerrainPoint } from '../types';
import { isoDate } from '../util';
import { pointSteps } from './alptruth';
import { regionSigns } from './signs';

const HOUR = 3_600_000;
/** Fallback night when the sun doesn't set or rise (polar night, midnight sun): our own. */
const NIGHT_FROM = 'T21:00:00';
const NIGHT_TO = 'T06:00:00';

/** The night before `date`: sunset the day before to sunrise on the day, at the point. */
function nightBefore(date: string, ll: L.LatLng): [number, number] {
  const day = new Date(date + 'T12:00:00');
  const prev = isoDate(new Date(day.getTime() - 24 * HOUR));
  const a = daylight(sunDay(prev, ll.lat, ll.lng)), b = daylight(sunDay(date, ll.lat, ll.lng));
  const sunset = a.sun.length && !a.midnightSun ? a.sun[a.sun.length - 1].to : NaN;
  const sunrise = b.sun.length && !b.midnightSun ? b.sun[0].from : NaN;
  if (Number.isFinite(sunset) && Number.isFinite(sunrise) && sunrise > sunset) return [sunset, sunrise];
  return [new Date(prev + NIGHT_FROM).getTime(), new Date(date + NIGHT_TO).getTime()];
}

/**
 * Every info for one point on the chosen day, hit or not, with the reasoning
 * (domain/infos.ts): weather at the point (pointSteps), seNorge snow cover,
 * and Regobs in the region.
 */
export async function assessInfoRows(ll: L.LatLng, terrain: TerrainPoint | null | undefined, weather: PointWeather | null | undefined): Promise<InfoRow[]> {
  const date = state.date;
  const region = regionAt(state.regions, ll);
  const hours = region?.hours ?? [];
  const steps = pointSteps(hours, weather);
  const at = (t: string) => new Date(date + t).getTime();
  const dayStart = at('T00:00:00'), dayFrom = at('T08:00:00'), dayTo = at('T16:00:00');
  const end = windowEnd(date);

  const surf = surfaces(hours).map((s, i) => ({ time: hours[i].time, surface: s.surface }));
  const dayT = thaw(steps, dayFrom, dayTo), prevT = thaw(steps, dayFrom - 24 * HOUR, dayTo - 24 * HOUR);
  const dayMild = !!dayT && dayT.maxTemp >= 0;
  const hits = regionSigns(region, terrain);
  const [nightFrom, nightTo] = nightBefore(date, ll);

  return infoRows({
    cover: await snowCoverAt(ll, date),
    critical: criticalNewSnow(steps, end, hours, surf),
    criticalShow: CRIT_SHOW,
    rain: rainAround(steps, end),
    rainNow: date === isoDate(new Date()),
    firstThaw: firstThaw(steps, dayStart, dayFrom, dayTo),
    firstFine: firstFineDay(steps, dayStart, dayFrom, dayTo),
    refreeze: refreeze(steps, nightFrom, nightTo),
    dayMild,
    meltFreeze: dayMild || (!!prevT && prevT.maxTemp >= 0),
    poorTest: hits && signGroup(hits, ['poorTest']),
  });
}

/** Only the infos that hit, red flags first. */
export async function assessInfos(ll: L.LatLng, terrain: TerrainPoint | null | undefined, weather: PointWeather | null | undefined): Promise<Info[]> {
  return hitsOf(await assessInfoRows(ll, terrain, weather));
}

/* ---------- the tapped point's infos, for the chips in its line ---------- */

let cached: { key: string; list: Info[] | null } | null = null;
let onReady: () => void = () => {};

/** What the infos depend on: when this changes, they are worked out again. */
function keyOf(p: Picked): string {
  const r = regionAt(state.regions, p.ll);
  const h = r?.hours;
  return [
    p.ll.lat.toFixed(5), p.ll.lng.toFixed(5), state.date, state.obsDate,
    h === undefined ? 'u' : h === null ? 'n' : h.length,
    p.terrain === undefined ? 'u' : p.terrain ? Math.round(p.terrain.elev) : 'n',
    p.weather?.data.updated ?? (p.weather === null ? 'n' : 'u'),
  ].join('|');
}

/**
 * The tapped point's infos, or undefined while they are worked out (then
 * `ready` is called, so the caller can draw again). Cheap to call on every draw.
 */
export function pickedInfos(): Info[] | undefined {
  const p = state.picked;
  if (!p) return undefined;
  const key = keyOf(p);
  if (cached?.key === key) return cached.list ?? undefined;
  const mine: { key: string; list: Info[] | null } = { key, list: null };
  cached = mine;
  assessInfos(p.ll, p.terrain, p.weather?.data)
    .then((list) => {
      if (cached !== mine) return;
      mine.list = list;
      onReady();
    })
    .catch(() => {});
  return undefined;
}

/** Called when the tapped point's infos are ready (draw the panels again). */
export function initInfos(ready: () => void): void {
  onReady = ready;
}
