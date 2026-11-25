// Fonts are bundled with the app (no Google Fonts: no third-party request, works offline).
// Only the Latin sets: latin has æøå, latin-ext the Sámi letters in place names (Č, Š, Ŋ, Ŧ, Đ, Ž).
// Skipping Cyrillic/Vietnamese keeps them out of the files stored for offline use.
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-ext-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-ext-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow/latin-ext-600.css';
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-ext-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-ext-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-ext-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-ext-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-ext-500.css';
import 'leaflet/dist/leaflet.css';
import './styles/app.css';
// Before ./map: the page must have its full height when Leaflet first measures it.
import './ui/viewport';

import * as L from 'leaflet';
import { fetchRegions, fetchWarnings } from './api/nve';
import { fetchObservations } from './api/regobs';
import { fetchWebcams } from './api/vegvesen';
import { fetchSurf } from './api/surf';
import { fetchPointWeather } from './api/met';
import { fetchAirProfile, fetchWindHistory } from './api/openMeteo';
import { FETCH_H, windLoading, windowEnd } from './domain/wind';
import { withProfile } from './domain/weather';
import { ASP_RGB, ASPECT_MIN_ZOOM, DEMO, DIRS, DNAME, SKRED_MIN_ZOOM, WEBCAM_MIN_ZOOM } from './config';
import { images, obsKind } from './domain/observations';
import { regionAt } from './domain/geo';
import { createAspectLayer } from './layers/aspect';
import { createAvalancheTerrainLayer } from './layers/avalancheTerrain';
import { drawObservations, focusObservation, obsGroup } from './layers/observations';
import { drawRegions, regionGroup, restyleRegions } from './layers/regions';
import { renderSteepnessLegend, steepnessLayer } from './layers/steepness';
import { renderRunoutLegend, setRunout } from './layers/runout';
import { isSnowKind, renderSnowLegend, setSnow, snowLayer, type SnowKind } from './layers/snow';
import { drawWebcams, webcamLayer } from './layers/webcams';
import { surfLayer } from './layers/surf';
import { SURF_SPOTS } from './domain/surfSpots';
import { siteOk, type WebcamSite } from './domain/webcams';
import { EXTRA_WEBCAMS } from './domain/extraWebcams';
import { map } from './map';
import { state, type Sport } from './state';
import { terrainAt } from './terrain/dem';
import type { Picked } from './types';
import { registerServiceWorker } from './offline/download';
import { NotStoredError, storedKeys } from './offline/dataCache';
import { renderDetail } from './ui/detail';
import { roseSVG } from './ui/icons';
import { flyTo3D, focusObs3D, init3D, is3DOpen, resetNorth3D, setPick3D, syncSnow3D, update3D, update3DObs } from './three/view3d';
import { initCompass } from './ui/compass';
import { clearCoord, coordSource, initCoords, setCoordInfo, showCoord } from './ui/coords';
import { pointFacts } from './ui/point';
import { refreshPointChip } from './ui/pointChip';
import { initHeaderTools, setHeaderTool } from './ui/headerTools';
import { initSearch } from './ui/search';
import { expandSheet, halfSheet, initSheet, PHONE, resetSheet } from './ui/sheet';
import { initLocate, showPositionCoord } from './ui/locate';
import { initOffline } from './ui/offlinePage';
import { reportDemError, setStatus } from './ui/status';
import { renderSummary } from './ui/summary';
import { renderWeather } from './ui/weather';
import { initSun } from './ui/sun';
import { initShare } from './ui/share';
import { initMoreMenu } from './ui/moreMenu';
import { initLayerInfo } from './ui/layerInfo';
import { initAbout } from './ui/about';
import { initToolInfo } from './ui/toolInfo';
import { initTools, renderTools, setToolsActive } from './ui/tools';
import { initSurf, openSpot, renderSurf, setSurfData, setSurfStatus } from './ui/surf';
import { initSport } from './ui/sport';
import { initInfos } from './tools/infos';
import { initRoute, isDrawing, refreshRouteRisk } from './ui/routePage';
import { $, fmtDate, fmtTime, isoDate } from './util';
import { restoreView, saveView, trackView } from './viewState';
import { count, initCounting, type EventName } from './analytics/count';

// First, so the visit is counted before the events that the restored layers send below.
initCounting();

/* ---------- layers ---------- */

const avalancheLayer = createAvalancheTerrainLayer(reportDemError);
const aspectLayer = createAspectLayer(reportDemError);

/** The sport each layer toggle belongs to; toggles not listed (webcams) show for both. */
const LAYER_SPORT: Record<string, Sport> = { 'l-skred': 'ski', 'l-bratt': 'ski', 'l-snow': 'ski', 'l-asp': 'ski', 'l-obs': 'ski' };
/** A layer is on the map when its box is ticked and it belongs to the sport shown. */
function layerOn(id: string): boolean {
  return $<HTMLInputElement>(id).checked && (LAYER_SPORT[id] ?? state.sport) === state.sport;
}

/* ---------- rendering ---------- */

function renderPanels(): void {
  // The warning, its summary and the tools are ski only (and would fetch the point's weather history).
  if (state.sport === 'ski') {
    renderDetail(openObservation);
    renderSummary(() => setTab('warn'));
    renderTools();
  }
  renderWeather();
  refreshPointChip();
}

function openObservation(regId: number): void {
  if (is3DOpen()) {
    const obsBox = $<HTMLInputElement>('l-obs');
    if (!obsBox.checked) {
      obsBox.checked = true;
      obsGroup.addTo(map);
      update3DObs();
    }
    return focusObs3D(regId);
  }
  focusObservation(regId, () => {
    if (!map.hasLayer(obsGroup)) {
      $<HTMLInputElement>('l-obs').checked = true;
      obsGroup.addTo(map);
    }
  });
}

/* ---------- data loading ---------- */

/** "Uten nett · lagret tor. 19. nov. kl. 17:02" when data came from the device, else ''. */
const storedNote = (savedAt: number | null) => (savedAt === null ? '' : `Uten nett · lagret ${fmtTime(new Date(savedAt).toISOString())} · `);
/** Something on screen is a stored copy: fetch again as soon as the network is back. */
let showingStored = false;

async function loadWarnings(date: string): Promise<void> {
  setStatus(`Henter snøskredvarsler for ${fmtDate(date)}…`, 'busy');
  const { data: byId, savedAt } = await fetchWarnings(date);
  if (state.date !== date) return; // user picked another date meanwhile
  if (savedAt !== null) {
    showingStored = true;
    count('fail-nve');
  }
  state.regions.forEach((r) => (r.warn = byId.get(r.id) ?? null));
  restyleRegions();
  avalancheLayer.redraw();
  update3D();
  renderPanels();
  refreshRouteRisk(); // SLABS and Munter follow the day's warning

  const warned = state.regions.filter((r) => r.warn && r.warn.level >= 1);
  $('season').hidden = warned.length > 0;
  const note = storedNote(savedAt);
  const kind = savedAt === null ? 'ok' : 'stale';
  if (warned.length) {
    const max = Math.max(...warned.map((r) => r.warn!.level));
    setStatus(`${note}${warned.length} regioner varslet ${fmtDate(date)} · høyeste faregrad ${max} (${DNAME[max].toLowerCase()})${tomorrowHint()}`, kind);
  } else {
    setStatus(`${note}Ingen regioner har varsel ${fmtDate(date)}.${tomorrowHint()}`, kind);
  }
  // Tomorrow's warning is out: store it too, so it's there on the trip tomorrow without signal.
  if (savedAt === null && tomorrowIsOut()) fetchWarnings(tomorrowIso()).catch(() => {});
}

/**
 * Weather over the five days before the warning date, one point per region
 * (the middle of its bounds; the 850 hPa wind varies slowly): the last 72 h
 * of wind, and the snow and temperature before it to tell whether there was
 * loose snow to move. Turned into lee aspects for the hatch in the aspect and
 * avalanche layers.
 */
async function loadWind(date: string): Promise<void> {
  const regions = state.regions;
  if (!regions.length) return;
  const end = windowEnd(date), start = end - FETCH_H * 3_600_000;
  const points = regions.map((r) => {
    const c = r.bounds.getCenter();
    return { lat: c.lat, lon: c.lng };
  });
  const { data, savedAt } = await fetchWindHistory(points, start, end, date);
  if (state.date !== date || state.regions !== regions) return;
  if (savedAt !== null) {
    showingStored = true;
    count('fail-openmeteo');
  }
  regions.forEach((r, i) => {
    const ok = data.length === regions.length;
    r.wind = ok ? windLoading(data[i], end) : null;
    r.hours = ok ? data[i] : null; // also used by the Verktøy tab (new snow, thaw)
  });
  redrawLee();
}
const windFail = () => {
  count('fail-openmeteo');
  state.regions.forEach((r) => ((r.wind = null), (r.hours = null)));
};

function redrawLee(): void {
  aspectLayer.redraw();
  avalancheLayer.redraw();
  update3D();
  renderPanels();
}

async function loadObservations(date: string): Promise<void> {
  const el = $('obs-status');
  el.textContent = 'Henter observasjoner…';
  const { data: obs, savedAt } = await fetchObservations(date);
  if (state.date !== date) return;
  if (savedAt !== null) {
    showingStored = true;
    count('fail-regobs');
  }
  state.obs = obs;
  state.obsDate = date;
  drawObservations(obs);
  update3DObs();
  const nSkred = obs.filter((o) => obsKind(o) === 'skred').length;
  const nImg = obs.reduce((n, o) => n + images(o).length, 0);
  el.textContent =
    storedNote(savedAt) +
    (obs.length ? `${obs.length} observasjoner · ${nSkred} med skred · ${nImg} bilder` : 'Ingen snøobservasjoner i perioden.');
  renderPanels();
}

/** "fre. 20. nov." etc. for the dates that have a stored warning, soonest first. */
async function storedDates(): Promise<string> {
  const dates = (await storedKeys('warnings')).filter((d) => d >= todayIso()).sort();
  return dates.map((d) => new Date(d + 'T12:00:00').toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' })).join(', ');
}

const warnFail = async (e: unknown) => {
  showingStored = true;
  count('fail-nve');
  if (e instanceof NotStoredError && e.kind === 'warnings') {
    const other = await storedDates();
    setStatus(`Uten nett, og varselet for ${fmtDate(e.key)} er ikke lagret på enheten.${other ? ` Lagret: ${other.replace(/\.$/, '')}.` : ''}`, 'err');
  } else if (e instanceof NotStoredError) {
    setStatus('Uten nett, og varslingsregionene er ikke lagret på enheten ennå. Åpne appen med nett én gang først.', 'err');
  } else {
    setStatus(`Fikk ikke kontakt med NVE sitt varsel-API (${(e as Error)?.message || 'nettverksfeil'}). Prøv igjen om litt.`, 'err');
  }
};
const obsFail = (e: unknown) => {
  showingStored = true;
  count('fail-regobs');
  $('obs-status').textContent =
    e instanceof NotStoredError
      ? 'Uten nett, og observasjonene for denne dagen er ikke lagret på enheten.'
      : `Fikk ikke hentet observasjoner fra Regobs (${(e as Error)?.message || 'nettverksfeil'}).`;
};

/**
 * Webcams: only fetched while the layer is on (most visits don't need ~400 kB
 * of camera list), and again when it is turned on after WEBCAM_MAX_AGE, since
 * cameras go in and out of service.
 */
const WEBCAM_MAX_AGE = 30 * 60_000;
let webcamsAt = 0;
let webcamsLoading = false;
async function loadWebcams(): Promise<void> {
  if (webcamsLoading || Date.now() - webcamsAt < WEBCAM_MAX_AGE) return;
  webcamsLoading = true;
  const el = $('cam-status');
  el.hidden = false;
  el.textContent = 'Henter webkamera…';
  const summary = (sites: WebcamSite[]) => {
    const cams = sites.reduce((n, s) => n + s.views.length, 0);
    const down = sites.filter((s) => !siteOk(s)).length;
    return `${cams} kamera på ${sites.length} steder${down ? ` · ${down} steder ute av drift` : ''}`;
  };
  // The hand-picked cameras need no fetch: show them straight away.
  drawWebcams(EXTRA_WEBCAMS);
  try {
    const { data: vegvesen, savedAt } = await fetchWebcams();
    if (savedAt !== null) count('fail-vegvesen');
    else webcamsAt = Date.now();
    const sites = [...vegvesen, ...EXTRA_WEBCAMS];
    drawWebcams(sites);
    el.textContent = storedNote(savedAt) + summary(sites);
  } catch (e) {
    count('fail-vegvesen');
    el.textContent =
      (e instanceof NotStoredError
        ? 'Uten nett, og Vegvesens webkamera er ikke lagret på enheten ennå. '
        : `Fikk ikke hentet webkamera fra Vegvesen (${(e as Error)?.message || 'nettverksfeil'}). `) + `Viser ${summary(EXTRA_WEBCAMS)}.`;
  } finally {
    webcamsLoading = false;
  }
}
webcamLayer.on('add', () => void loadWebcams());

/**
 * Waves and wind for the surf spots: fetched when surfing is chosen, and again
 * after SURF_MAX_AGE (the wave models run every 6–12 hours; the wind hourly).
 */
const SURF_MAX_AGE = 30 * 60_000;
let surfAt = 0;
let surfLoading = false;
async function loadSurf(): Promise<void> {
  if (surfLoading || Date.now() - surfAt < SURF_MAX_AGE) return;
  surfLoading = true;
  const el = $('surf-layer-status');
  const show = (text: string) => {
    el.hidden = false;
    el.textContent = text;
  };
  show('Henter bølgevarsel…');
  try {
    const { data, savedAt } = await fetchSurf(SURF_SPOTS);
    if (savedAt !== null) count('fail-marine');
    else surfAt = Date.now();
    setSurfData(data, storedNote(savedAt));
    show(`${storedNote(savedAt)}${SURF_SPOTS.length} surfespotter`);
  } catch (e) {
    count('fail-marine');
    const text =
      e instanceof NotStoredError
        ? 'Uten nett, og bølgevarselet er ikke lagret på enheten ennå.'
        : `Fikk ikke hentet bølgevarsel fra Open-Meteo (${(e as Error)?.message || 'nettverksfeil'}). Prøv igjen om litt.`;
    setSurfStatus(text);
    show(text);
  } finally {
    surfLoading = false;
  }
}

/* ---------- dates ---------- */

/** NVE publishes the next day's warning around 16:00. */
const TOMORROW_FROM_HOUR = 16;
/** Coming back to the app refetches when the data is older than this. */
const STALE_MS = 5 * 60_000;

/** Worked out when asked, never at startup: the app may stay open past midnight. */
const todayIso = () => isoDate(new Date());
function tomorrowIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1); // calendar day, so DST changes don't matter
  return isoDate(d);
}
const tomorrowIsOut = () => state.date === todayIso() && new Date().getHours() >= TOMORROW_FROM_HOUR;
const tomorrowHint = () => (tomorrowIsOut() ? ' Varselet for i morgen er ute.' : '');

/** Point the user at tomorrow's warning once it is out (the button, and the date icon on phones). */
function suggestTomorrow(): void {
  const on = tomorrowIsOut();
  const btn = $('tomorrow');
  btn.classList.toggle('primary', on);
  btn.title = on ? 'Varselet for i morgen er publisert' : '';
  $('tool-date').classList.toggle('suggest', on);
}

const dateEl = $<HTMLInputElement>('date');
/** True while the user is on "today", so the date moves along after midnight. */
let followToday = false;
let loadedAt = 0;
function go(date: string): void {
  state.date = date;
  showingStored = false;
  followToday = date === todayIso();
  loadedAt = Date.now();
  dateEl.value = date;
  saveView();
  suggestTomorrow();
  loadWarnings(date).catch(warnFail);
  loadObservations(date).catch(obsFail);
  state.regions.forEach((r) => ((r.wind = undefined), (r.hours = undefined)));
  loadWind(date).catch(windFail);
  applySnow();
  renderSurf(); // the Surf tab and its markers follow the date
  // Weather follows the date shown, and gets refreshed along with the warning.
  if (state.picked && state.picked.terrain !== undefined) void loadWeather(state.picked);
}

/** Catch up with the clock: a new day, or tomorrow's warning coming out. */
function syncClock(): boolean {
  if (followToday && state.date !== todayIso()) {
    go(todayIso());
    return true;
  }
  suggestTomorrow();
  return false;
}

/** Back in the foreground (phone unlocked, tab switched back): new day or stale data → fetch again. */
function onForeground(): void {
  if (document.visibilityState !== 'visible') return;
  if (state.sport === 'surf') void loadSurf(); // refetches only once the data is old
  if (!state.regions.length) return;
  if (!syncClock() && (showingStored || Date.now() - loadedAt > STALE_MS)) go(state.date);
}
document.addEventListener('visibilitychange', onForeground);
window.addEventListener('pageshow', (e) => e.persisted && onForeground());
// Signal is back: replace stored copies with fresh data.
window.addEventListener('online', () => showingStored && state.regions.length && go(state.date));
// While open and visible, notice midnight and 16:00 without waiting for a reload.
setInterval(() => document.visibilityState === 'visible' && state.regions.length && syncClock(), 60_000);

/* ---------- layer controls ---------- */

// Map view, layer checkboxes and settings from the link or the last visit.
const { date: startDate, point: startPoint } = restoreView();
// Before the layers are bound: only the chosen sport's layers go on the map.
initSport(onSport);
const thrSelect = $<HTMLSelectElement>('s-thr');
const aspMinSelect = $<HTMLSelectElement>('a-min');
const restBox = $<HTMLInputElement>('s-rest');
const steepOpacityInput = $<HTMLInputElement>('o-bratt');
const snowOpacityInput = $<HTMLInputElement>('o-snow');
state.thr = +thrSelect.value;
state.aspMin = +aspMinSelect.value;
state.showRest = restBox.checked;
state.showLee = $<HTMLInputElement>('s-lee').checked;
steepnessLayer.setOpacity(+steepOpacityInput.value);
snowLayer.setOpacity(+snowOpacityInput.value);

/** seNorge snow map: the chosen kind for the warning date shown. */
function snowKind(): SnowKind {
  const k = $<HTMLSelectElement>('n-kind').value;
  return isSnowKind(k) ? k : 'sdfsw3d';
}
function applySnow(): void {
  const kind = snowKind();
  setSnow(kind, state.date || startDate);
  renderSnowLegend($('snow-legend'), kind);
  syncMapLegend();
  syncSnow3D();
}
applySnow();

/** Layers counted when shown (the avalanche layer is on by default, so it tells nothing). */
const LAYER_EVENTS: Record<string, EventName> = { 'l-bratt': 'layer-bratt', 'l-snow': 'layer-snow', 'l-asp': 'layer-asp', 'l-obs': 'layer-obs', 'l-cam': 'layer-cam' };
/** Every toggle's apply, run again when the sport changes. */
const toggles: (() => void)[] = [];
function bindToggle(id: string, ...layers: L.Layer[]): void {
  const box = $<HTMLInputElement>(id);
  const event = LAYER_EVENTS[id];
  const apply = () => {
    const on = layerOn(id);
    layers.forEach((l) => (on ? l.addTo(map) : map.removeLayer(l)));
    if (on && event) count(event); // also when restored from the last visit: "visits that showed it"
  };
  box.addEventListener('change', apply);
  toggles.push(apply);
  apply();
}
bindToggle('l-skred', avalancheLayer, regionGroup);
bindToggle('l-bratt', steepnessLayer);
// Runout areas: an option on the steepness layer (swaps its tiles).
{
  const box = $<HTMLInputElement>('b-runout');
  const apply = () => {
    setRunout(box.checked);
    $('runout-legend').hidden = !box.checked;
    if (box.checked) count('layer-runout');
  };
  box.addEventListener('change', apply);
  apply();
  renderRunoutLegend($('runout-legend'));
}
bindToggle('l-snow', snowLayer);
bindToggle('l-asp', aspectLayer);
bindToggle('l-obs', obsGroup);
bindToggle('l-cam', webcamLayer);
// Surf spots: no checkbox, always on the map while surf is chosen.
function syncSurfLayer(): void {
  if (state.sport === 'surf') surfLayer.addTo(map);
  else map.removeLayer(surfLayer);
}
syncSurfLayer();
for (const id of ['l-bratt', 'l-snow', 'l-asp']) $(id).addEventListener('change', syncMapLegend);

steepOpacityInput.addEventListener('input', () => steepnessLayer.setOpacity(+steepOpacityInput.value));
snowOpacityInput.addEventListener('input', () => snowLayer.setOpacity(+snowOpacityInput.value));
$<HTMLSelectElement>('n-kind').addEventListener('change', applySnow);
aspMinSelect.addEventListener('change', () => {
  state.aspMin = +aspMinSelect.value;
  aspectLayer.redraw();
});
thrSelect.addEventListener('change', () => {
  state.thr = +thrSelect.value;
  avalancheLayer.redraw();
  renderPanels();
});
restBox.addEventListener('change', () => {
  state.showRest = restBox.checked;
  avalancheLayer.redraw();
});

// One setting, shown under both layers it affects.
for (const id of ['s-lee', 'a-lee']) {
  $<HTMLInputElement>(id).addEventListener('change', (e) => {
    state.showLee = (e.target as HTMLInputElement).checked;
    $<HTMLInputElement>('s-lee').checked = $<HTMLInputElement>('a-lee').checked = state.showLee;
    redrawLee();
  });
}

/* ---------- legends ---------- */

$('asp-rose').innerHTML = roseSVG(null, ASP_RGB, 64);
$('asp-legend').innerHTML = DIRS.map((d, k) => `<span><i class="sw" style="background:rgb(${ASP_RGB[k].join(',')})"></i>${d}</span>`).join('');
void renderSteepnessLegend($('bratt-legend')).then(syncMapLegend);

/**
 * The scales for steepness, snow and aspect, copied over the map so they can be read while
 * the panel is hidden (CSS shows the box only then). One block per layer that is on.
 */
function syncMapLegend(): void {
  const on = layerOn;
  const parts: string[] = [];
  if (on('l-bratt')) parts.push(`<div class="legend">${$('bratt-legend').innerHTML}</div>`);
  if (on('l-snow')) parts.push(`<div class="legend">${$('snow-legend').innerHTML}</div>`);
  if (on('l-asp')) parts.push(`<div class="ml-rose">${roseSVG(null, ASP_RGB, 64)}</div>`);
  const el = $('map-legend');
  el.innerHTML = parts.join('');
  el.hidden = !parts.length;
}

/* ---------- zoom hint ---------- */

/**
 * Only when a layer that is on can't show yet: "Zoom inn for å se terrengtreff".
 * Otherwise the box is hidden. The "fra zoom 10" tags in the panel likewise
 * only show while the map is zoomed out too far for their layer.
 */
function onZoom(): void {
  const z = map.getZoom();
  const on = layerOn;
  const msg =
    on('l-skred') && z < SKRED_MIN_ZOOM
      ? 'Zoom inn for å se terrengtreff'
      : on('l-asp') && z < ASPECT_MIN_ZOOM
        ? 'Zoom inn for å se himmelretning'
        : on('l-cam') && z < WEBCAM_MIN_ZOOM
          ? 'Zoom inn for å se webkamera'
          : '';
  const hint = $('hint');
  hint.textContent = msg;
  hint.hidden = !msg;
  $('z-skred').classList.toggle('live', z >= SKRED_MIN_ZOOM);
  $('z-asp').classList.toggle('live', z >= ASPECT_MIN_ZOOM);
  $('z-cam').classList.toggle('live', z >= WEBCAM_MIN_ZOOM);
  restyleRegions();
}
for (const id of ['l-skred', 'l-asp', 'l-cam']) $(id).addEventListener('change', onZoom);
map.on('zoomend', onZoom);

/* ---------- date controls ---------- */

dateEl.addEventListener('change', () => dateEl.value && go(dateEl.value));
$('today').addEventListener('click', () => go(todayIso()));
$('tomorrow').addEventListener('click', () => {
  count('date-tomorrow');
  go(tomorrowIso());
});
$('demo').addEventListener('click', () => {
  count('date-demo');
  go(DEMO.date);
  map.flyTo(DEMO.center, DEMO.zoom);
});

/* ---------- tabs + panel ---------- */

const TABS = ['layers', 'surf', 'warn', 'wx', 'tools'] as const;
type Tab = (typeof TABS)[number];
function setTab(t: Tab): void {
  for (const k of TABS) {
    $(`tab-${k}`).hidden = k !== t;
    $(`tab-btn-${k}`).setAttribute('aria-selected', String(k === t));
  }
  setToolsActive(t === 'tools'); // the tools only work things out while their tab is open
  expandPanel();
}
for (const k of TABS)
  $(`tab-btn-${k}`).addEventListener('click', () => {
    if (k !== 'layers') count(`tab-${k}`);
    setTab(k);
  });

/*
 * Burger: hides/shows the whole side panel (remembered between visits).
 * Panel open → the burger sits first in the panel header (#burger-in).
 * Panel hidden → a floating burger (#burger): top-left on PC, bottom-left on phones.
 */
/** Remembered apart for phones and larger screens: hiding the sheet on the phone shouldn't hide the panel on PC. */
const panelHiddenKey = () => (PHONE.matches ? 'tourit.panelHidden.phone' : 'tourit.panelHidden');
function setPanelHidden(hidden: boolean): void {
  $('panel').hidden = hidden;
  $('burger').hidden = !hidden;
  if (hidden) halfSheet(); // the burger reopens it at half
  document.body.classList.toggle('panel-hidden', hidden);
  try {
    localStorage.setItem(panelHiddenKey(), hidden ? '1' : '0');
  } catch {
    /* storage unavailable: just don't remember */
  }
  // Keep keyboard focus on the visible burger.
  if (document.activeElement?.closest('#burger, #burger-in')) $(hidden ? 'burger' : 'burger-in').focus();
}
$('burger').addEventListener('click', () => setPanelHidden(false));
$('burger-in').addEventListener('click', () => setPanelHidden(true));
initSheet(() => setPanelHidden(true));
function restorePanelHidden(): void {
  let hidden = false;
  try {
    hidden = localStorage.getItem(panelHiddenKey()) === '1';
  } catch {
    /* ignore */
  }
  if (hidden !== $('panel').hidden) setPanelHidden(hidden);
}
restorePanelHidden();
PHONE.addEventListener('change', restorePanelHidden);

function expandPanel(): void {
  if ($('panel').hidden) setPanelHidden(false);
  expandSheet();
}

/* ---------- sport ---------- */

/** Ski ↔ surf: swap the layers on the map and move off a tab the other sport doesn't have. */
function onSport(s: Sport): void {
  toggles.forEach((apply) => apply());
  syncSurfLayer();
  // A point picked while surfing has no terrain: look it up now. Otherwise redraw for the sport.
  if (s === 'ski' && state.picked?.noTerrain) void pickPoint(state.picked.ll);
  else renderPanels();
  if (state.picked && coordSource() === 'pick') setCoordInfo(pointFacts());
  syncMapLegend();
  onZoom();
  if (s === 'surf') {
    count('sport-surf');
    setTab('surf');
    void loadSurf();
  } else if (!$('tab-surf').hidden) {
    setTab('layers');
  }
}

/* ---------- picking a point ---------- */

let pickMarker: L.Marker | null = null;
/** Tap area around the pin, px: big enough for a finger, though the pin itself is small. */
const PIN_HIT = 44;
/** Pick a point: marker, region lookup, terrain at the point. Used by map clicks and the position dot. */
async function pickPoint(ll: L.LatLng): Promise<void> {
  if (!pickMarker) {
    pickMarker = L.marker(ll, {
      icon: L.divIcon({
        className: 'pin-hit',
        html: '<div class="pin"></div>',
        iconSize: [PIN_HIT, PIN_HIT],
        iconAnchor: [PIN_HIT / 2, PIN_HIT / 2],
      }),
      keyboard: false,
      title: 'Trykk for å fjerne punktet',
      bubblingMouseEvents: false,
    }).addTo(map);
    // Tapping the pin again removes it (tools then follow your position, if it is shown).
    // While drawing a route the tap is a route point like any other, where you tapped
    // (Leaflet puts a marker's own position in e.latlng, which would snap it to the pin).
    pickMarker.on('click', (e: L.LeafletMouseEvent) =>
      isDrawing() ? map.fire('click', { latlng: map.mouseEventToLatLng(e.originalEvent), originalEvent: e.originalEvent }) : clearPick(),
    );
  } else {
    pickMarker.setLatLng(ll);
  }
  // Surf: no terrain lookup, the point is mostly on water.
  const surf = state.sport === 'surf';
  const mine: Picked = surf ? { ll, terrain: null, noTerrain: true } : { ll, terrain: undefined };
  state.picked = mine;
  state.selected = regionAt(state.regions, ll);
  showCoord('pick', ll.lat, ll.lng, undefined, pointFacts());
  setPick3D(ll);
  restyleRegions();
  renderPanels();
  if (!surf) {
    try {
      mine.terrain = await terrainAt(ll);
    } catch {
      mine.terrain = null;
    }
    if (state.picked !== mine) return;
    renderPanels();
    if (coordSource() === 'pick') setCoordInfo(pointFacts());
  }
  void loadWeather(mine);
}

/**
 * Remove the picked point. The region stays selected, so the warning stays on screen;
 * the coordinate chip goes back to your position, if it is shown.
 */
function clearPick(): void {
  pickMarker?.remove();
  pickMarker = null;
  state.picked = null;
  clearCoord('pick');
  showPositionCoord();
  setPick3D(null);
  restyleRegions();
  renderPanels();
}

/**
 * Tap on your position dot: pick that point, or, if the pin is already under the
 * dot (so the pin itself can't be tapped), remove it.
 */
function pickFromPosition(ll: L.LatLng): void {
  const underDot =
    pickMarker && map.latLngToContainerPoint(pickMarker.getLatLng()).distanceTo(map.latLngToContainerPoint(ll)) < PIN_HIT / 2;
  if (underDot && !isDrawing()) clearPick();
  else void pickPoint(ll);
}

/**
 * Weather for the picked point: MET's forecast at the point's terrain height,
 * plus the air above it from Open-Meteo (cloud heights, freezing level) when
 * that answers. Cheap to repeat: both API modules cache in memory.
 */
async function loadWeather(p: Picked): Promise<void> {
  const air = fetchAirProfile(p.ll.lat, p.ll.lng).catch(() => {
    count('fail-openmeteo');
    return null; // optional extra
  });
  try {
    const got = await fetchPointWeather(p.ll.lat, p.ll.lng, p.terrain?.elev);
    if (got.savedAt !== null) count('fail-met');
    const prof = await air;
    if (prof && prof.savedAt !== null) count('fail-openmeteo');
    p.weather = prof ? { data: withProfile(got.data, prof.data, 'Open-Meteo (ICON)'), savedAt: got.savedAt ?? prof.savedAt } : got;
    if (p.weather.savedAt !== null) showingStored = true;
  } catch (e) {
    count('fail-met');
    if (p.weather) return; // keep what we had
    p.weather = null;
    p.weatherErr = e instanceof NotStoredError ? 'uten nett, og ikke lagret for dette punktet' : (e as Error)?.message || 'nettverksfeil';
  }
  if (state.picked === p) renderPanels();
}
map.on('click', (e: L.LeafletMouseEvent) => {
  if (isDrawing()) return; // while drawing a route, taps add route points
  count('point-pick');
  void pickPoint(e.latlng);
});

/* ---------- start ---------- */

registerServiceWorker();
initOffline();
initRoute();
initLocate(pickFromPosition);
init3D(pickPoint);
initCompass(resetNorth3D, '.leaflet-top.leaflet-right > .leaflet-control');
initCoords(() => setTab('warn'));

/* Place search: fly there and select the place like a map tap. */
const SEARCH_ZOOM = 13;
/** Pixels of the map covered by the panel: on the left (PC) or at the bottom (phone sheet). */
function panelInsets(): { left: number; bottom: number } {
  const p = $('panel');
  if (p.hidden) return { left: 0, bottom: 0 };
  const box = map.getContainer().getBoundingClientRect(), r = p.getBoundingClientRect();
  return r.width < box.width * 0.9 ? { left: Math.max(0, r.right - box.left), bottom: 0 } : { left: 0, bottom: Math.max(0, box.bottom - r.top) };
}

initHeaderTools();
initShare();
initMoreMenu(); // after every map button: it gathers some of them into a menu
initLayerInfo();
initAbout();
initToolInfo();
initTools();
initInfos(renderPanels); // the point's info chips appear once worked out
initSun(renderPanels); // the sun card redraws once the terrain horizon is worked out
initSearch((place) => {
  count('search');
  const ll = L.latLng(place.lat, place.lng);
  const z = Math.max(map.getZoom(), SEARCH_ZOOM);
  resetSheet(); // phones: back to half height so the map is visible
  setHeaderTool(null); // phones: fold the search away again
  flyIntoView(ll, z);
  void pickPoint(ll);
});

/** Fly to a place, centred in the part of the map that isn't covered by the panel. */
function flyIntoView(ll: L.LatLng, z: number): void {
  const inset = panelInsets();
  if (is3DOpen()) flyTo3D(ll.lat, ll.lng, z, inset);
  else map.flyTo(map.unproject(map.project(ll, z).add([-inset.left / 2, inset.bottom / 2]), z), z);
}

/** Zoom a surf spot is shown at from the list. */
const SPOT_ZOOM = 12;
initSurf({
  onDate: (iso) => go(iso),
  onDetails: (id) => {
    setTab('surf');
    openSpot(id);
  },
  onShowOnMap: (spot) => {
    resetSheet(); // phones: back to half height so the map is visible
    flyIntoView(L.latLng(spot.lat, spot.lng), Math.max(map.getZoom(), SPOT_ZOOM));
  },
  onWeather: (spot) => {
    void pickPoint(L.latLng(spot.lat, spot.lng));
    setTab('wx');
  },
});

/**
 * A shared link with a point (`/@lat,lng`): select it, show its warning, and keep it
 * in view beside the panel (PC) or above the bottom sheet (phone).
 */
function openSharedPoint([lat, lng]: [number, number]): void {
  count('shared-link'); // the event only: the point stays on the device
  const ll = L.latLng(lat, lng);
  setTab('warn');
  const z = map.getZoom(), inset = panelInsets();
  map.setView(map.unproject(map.project(ll, z).add([-inset.left / 2, inset.bottom / 2]), z), z, { animate: false });
  void pickPoint(ll);
}

onZoom();
state.date = startDate;
followToday = startDate === todayIso();
loadedAt = Date.now();
dateEl.value = state.date;
suggestTomorrow();
trackView(go, openSharedPoint);
if (state.sport === 'surf') {
  count('sport-surf');
  void loadSurf();
}
setStatus('Henter varslingsregioner…', 'busy');
fetchRegions()
  .then((regions) => {
    state.regions = regions;
    drawRegions(regions);
    if (startPoint) openSharedPoint(startPoint); // needs the regions to find the warning
    loadObservations(state.date).catch(obsFail);
    loadWind(state.date).catch(windFail);
    return loadWarnings(state.date);
  })
  .catch(warnFail);
