import { count } from '../analytics/count';
import { fetchCrags } from '../api/crags';
import { fetchIceObs } from '../api/ice';
import { fetchSurf, SURF_MODELS, type SurfModel } from '../api/surf';
import { SURF_SPOTS } from '../domain/surfSpots';
import { map } from '../map';
import { NotStoredError } from '../offline/dataCache';
import { state } from '../state';
import { $, storedNote } from '../util';
import { cragCount, renderClimb, setClimbStatus, setCrags } from './climb';
import { todayIso } from './format';
import { renderIce, setIceObs, setIceStatus } from './ice';
import { setSurfData, setSurfStatus } from './surf';

/**
 * Loading the data behind the Surf, Klatring and Skøyter tabs: the wave forecast
 * for the spots, the list of crags, and the ice observations. main.ts calls these when a sport is chosen, at
 * start-up and when the app comes back to the foreground; the tabs themselves
 * (ui/surf.ts, ui/climb.ts, ui/ice.ts) draw what they are handed.
 */

/**
 * Waves and wind for the surf spots, from both wave models (shown side by side,
 * ui/surf.ts): fetched when surfing is chosen, and again after SURF_MAX_AGE
 * (the wave models run every 6–12 hours; the wind hourly). One model failing
 * still shows the other.
 */
const SURF_MAX_AGE = 30 * 60_000;
let surfAt = 0;
let surfLoading = false;
export async function loadSurf(): Promise<void> {
  if (surfLoading || Date.now() - surfAt < SURF_MAX_AGE) return;
  surfLoading = true;
  const el = $('surf-layer-status');
  const show = (text: string) => {
    el.hidden = false;
    el.textContent = text;
  };
  show('Henter bølgevarsel…');
  const models = Object.keys(SURF_MODELS) as SurfModel[];
  const results = await Promise.allSettled(models.map((m) => fetchSurf(SURF_SPOTS, m)));
  const missing = models.filter((_, i) => results[i].status === 'rejected');
  let stored: number | null = null;
  results.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    if (r.value.savedAt !== null) stored = Math.min(stored ?? Infinity, r.value.savedAt);
    setSurfData(models[i], r.value.data, storedNote(r.value.savedAt), missing);
  });
  if (missing.length || stored !== null) count('fail-marine');
  if (missing.length === models.length) {
    const e = (results[0] as PromiseRejectedResult).reason;
    const text =
      e instanceof NotStoredError
        ? 'Uten nett, og bølgevarselet er ikke lagret på enheten ennå.'
        : `Fikk ikke hentet bølgevarsel fra Open-Meteo (${(e as Error)?.message || 'nettverksfeil'}). Prøv igjen om litt.`;
    setSurfStatus(text);
    show(text);
  } else {
    if (!missing.length && stored === null) surfAt = Date.now();
    show(`${storedNote(stored)}${SURF_SPOTS.length} surfespotter`);
  }
  surfLoading = false;
}

/**
 * Climbing crags from OpenStreetMap: fetched when climbing is chosen (kept on the
 * device for a week, api/crags.ts). Their weather is fetched by the Klatring tab
 * for the crags in view.
 */
let cragsLoading = false;
export async function loadCrags(): Promise<void> {
  if (cragsLoading || cragCount()) return;
  cragsLoading = true;
  const el = $('climb-layer-status');
  const show = (text: string) => {
    el.hidden = false;
    el.textContent = text;
  };
  show('Henter klatrefelt fra OpenStreetMap…');
  setClimbStatus('Henter klatrefelt fra OpenStreetMap…');
  try {
    const { data, savedAt } = await fetchCrags((fresh) => {
      setCrags(fresh, '');
      show(`${fresh.length} klatrefelt`);
    });
    if (savedAt !== null) count('fail-overpass');
    setCrags(data, storedNote(savedAt));
    show(`${storedNote(savedAt)}${data.length} klatrefelt`);
  } catch (e) {
    count('fail-overpass');
    // Nothing stored also ends up here when online but the server's crag list is missing.
    const text =
      e instanceof NotStoredError && !navigator.onLine
        ? 'Uten nett, og klatrefeltene er ikke lagret på enheten ennå.'
        : `Fikk ikke hentet klatrefeltene (${(e as Error)?.message || 'nettverksfeil'}). Prøv igjen senere.`;
    setClimbStatus(text);
    show(text);
  } finally {
    cragsLoading = false;
  }
}

/**
 * Fetch the crags in the background once the start-up data is in, whatever sport is
 * chosen, so Klatring opens with the list ready. Only the crags: their weather depends
 * on the map view and waits until climbing is chosen (renderClimb). Cheap after the
 * first time: the stored copy, refreshed at most weekly (api/crags.ts).
 */
export function preloadCrags(): void {
  const go = () => void loadCrags();
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 5_000 });
  else setTimeout(go, 1_000);
}

/** The Klatring tab lists the crags in view: follow the map (after it settles). */
let climbTimer: ReturnType<typeof setTimeout> | null = null;
map.on('moveend', () => {
  if (state.sport !== 'climb') return;
  if (climbTimer) clearTimeout(climbTimer);
  climbTimer = setTimeout(renderClimb, 250);
});


/**
 * Ice observations from Regobs for the chosen date and the days before: fetched
 * when skating is chosen or the date changes, and again after ICE_MAX_AGE
 * (people report through the day).
 */
const ICE_MAX_AGE = 15 * 60_000;
let iceFor = '';
let iceAt = 0;
let iceLoading = '';
export async function loadIce(): Promise<void> {
  const date = state.date || todayIso();
  if (iceLoading === date || (iceFor === date && Date.now() - iceAt < ICE_MAX_AGE)) return;
  iceLoading = date;
  const el = $('ice-layer-status');
  const show = (text: string) => {
    el.hidden = false;
    el.textContent = text;
  };
  if (iceFor !== date) {
    show('Henter isobservasjoner fra Regobs…');
    setIceStatus('Henter isobservasjoner fra Regobs…');
  }
  try {
    const { data, savedAt } = await fetchIceObs(date);
    if (state.date && state.date !== date) return; // another date was chosen meanwhile
    if (savedAt !== null) count('fail-regobs');
    else (iceFor = date), (iceAt = Date.now());
    setIceObs(data, date, storedNote(savedAt));
    show(`${storedNote(savedAt)}${data.length} isobservasjoner siste 7 døgn`);
  } catch (e) {
    count('fail-regobs');
    const text =
      e instanceof NotStoredError
        ? 'Uten nett, og isobservasjonene er ikke lagret på enheten ennå.'
        : `Fikk ikke hentet isobservasjoner fra Regobs (${(e as Error)?.message || 'nettverksfeil'}). Prøv igjen om litt.`;
    setIceStatus(text);
    show(text);
  } finally {
    if (iceLoading === date) iceLoading = '';
  }
}

/** The Skøyter tab lists what is in view: follow the map (after it settles). */
let iceTimer: ReturnType<typeof setTimeout> | null = null;
map.on('moveend', () => {
  if (state.sport !== 'ice') return;
  if (iceTimer) clearTimeout(iceTimer);
  iceTimer = setTimeout(renderIce, 250);
});
