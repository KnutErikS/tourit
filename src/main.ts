// Fonts are bundled with the app (no Google Fonts: no third-party request, works offline).
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import 'leaflet/dist/leaflet.css';
import './styles/app.css';

import * as L from 'leaflet';
import { fetchRegions, fetchWarnings } from './api/nve';
import { fetchObservations } from './api/regobs';
import { ASP_RGB, ASPECT_MIN_ZOOM, DEMO, DIRS, DNAME, SKRED_MIN_ZOOM } from './config';
import { images, obsKind } from './domain/observations';
import { regionAt } from './domain/geo';
import { createAspectLayer } from './layers/aspect';
import { createAvalancheTerrainLayer } from './layers/avalancheTerrain';
import { drawObservations, focusObservation, obsGroup } from './layers/observations';
import { drawRegions, regionGroup, restyleRegions } from './layers/regions';
import { renderSteepnessLegend, steepnessLayer } from './layers/steepness';
import { map } from './map';
import { state } from './state';
import { terrainAt } from './terrain/dem';
import type { Picked } from './types';
import { registerServiceWorker } from './offline/download';
import { NotStoredError, storedKeys } from './offline/dataCache';
import { renderDetail } from './ui/detail';
import { roseSVG } from './ui/icons';
import { flyTo3D, focusObs3D, init3D, is3DOpen, resetNorth3D, setPick3D, update3D, update3DObs } from './three/view3d';
import { initCompass } from './ui/compass';
import { coordSource, initCoords, setCoordInfo, showCoord } from './ui/coords';
import { pointFacts } from './ui/point';
import { initHeaderTools, setHeaderTool } from './ui/headerTools';
import { initSearch } from './ui/search';
import { initSheet, resetSheet } from './ui/sheet';
import { initLocate } from './ui/locate';
import { initOffline } from './ui/offlinePage';
import { reportDemError, setStatus } from './ui/status';
import { renderSummary } from './ui/summary';
import { initShare } from './ui/share';
import { initRoute, isDrawing } from './ui/routePage';
import { $, fmtDate, fmtTime, isoDate } from './util';
import { restoreView, saveView, trackView } from './viewState';

/* ---------- layers ---------- */

const avalancheLayer = createAvalancheTerrainLayer(reportDemError);
const aspectLayer = createAspectLayer(reportDemError);

/* ---------- rendering ---------- */

function renderPanels(): void {
  renderDetail(openObservation);
  renderSummary(() => setTab('warn'));
}

function openObservation(regId: number): void {
  if (is3DOpen()) {
    if (!$<HTMLInputElement>('l-obs').checked) {
      $<HTMLInputElement>('l-obs').checked = true;
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
  if (savedAt !== null) showingStored = true;
  state.regions.forEach((r) => (r.warn = byId.get(r.id) ?? null));
  restyleRegions();
  avalancheLayer.redraw();
  update3D();
  renderPanels();

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

async function loadObservations(date: string): Promise<void> {
  const el = $('obs-status');
  el.textContent = 'Henter observasjoner…';
  const { data: obs, savedAt } = await fetchObservations(date);
  if (state.date !== date) return;
  if (savedAt !== null) showingStored = true;
  state.obs = obs;
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
  $('obs-status').textContent =
    e instanceof NotStoredError
      ? 'Uten nett, og observasjonene for denne dagen er ikke lagret på enheten.'
      : `Fikk ikke hentet observasjoner fra Regobs (${(e as Error)?.message || 'nettverksfeil'}).`;
};

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
  if (document.visibilityState !== 'visible' || !state.regions.length) return;
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
const startDate = restoreView();
state.thr = +$<HTMLSelectElement>('s-thr').value;
state.aspMin = +$<HTMLSelectElement>('a-min').value;
state.showRest = $<HTMLInputElement>('s-rest').checked;
steepnessLayer.setOpacity(+$<HTMLInputElement>('o-bratt').value);

function bindToggle(id: string, ...layers: L.Layer[]): void {
  const box = $<HTMLInputElement>(id);
  const apply = () => layers.forEach((l) => (box.checked ? l.addTo(map) : map.removeLayer(l)));
  box.addEventListener('change', apply);
  apply();
}
bindToggle('l-skred', avalancheLayer, regionGroup);
bindToggle('l-bratt', steepnessLayer);
bindToggle('l-asp', aspectLayer);
bindToggle('l-obs', obsGroup);

$<HTMLInputElement>('o-bratt').addEventListener('input', (e) => steepnessLayer.setOpacity(+(e.target as HTMLInputElement).value));
$<HTMLSelectElement>('a-min').addEventListener('change', (e) => {
  state.aspMin = +(e.target as HTMLSelectElement).value;
  aspectLayer.redraw();
});
$<HTMLSelectElement>('s-thr').addEventListener('change', (e) => {
  state.thr = +(e.target as HTMLSelectElement).value;
  avalancheLayer.redraw();
  renderPanels();
});
$<HTMLInputElement>('s-rest').addEventListener('change', (e) => {
  state.showRest = (e.target as HTMLInputElement).checked;
  avalancheLayer.redraw();
});

/* ---------- legends ---------- */

$('asp-rose').innerHTML = roseSVG(null, ASP_RGB, 64);
$('asp-legend').innerHTML = DIRS.map((d, k) => `<span><i class="sw" style="background:rgb(${ASP_RGB[k].join(',')})"></i>${d}</span>`).join('');
void renderSteepnessLegend($('bratt-legend'));

/* ---------- zoom hint ---------- */

function onZoom(): void {
  const z = map.getZoom();
  const skredOn = $<HTMLInputElement>('l-skred').checked;
  $('hint').textContent = `zoom ${z}` + (z < SKRED_MIN_ZOOM && skredOn ? ' · zoom inn for terrengtreff' : '');
  $('z-skred').classList.toggle('live', z >= SKRED_MIN_ZOOM);
  $('z-asp').classList.toggle('live', z >= ASPECT_MIN_ZOOM);
  restyleRegions();
}
map.on('zoomend', onZoom);

/* ---------- date controls ---------- */

dateEl.addEventListener('change', () => dateEl.value && go(dateEl.value));
$('today').addEventListener('click', () => go(todayIso()));
$('tomorrow').addEventListener('click', () => go(tomorrowIso()));
$('demo').addEventListener('click', () => {
  go(DEMO.date);
  map.flyTo(DEMO.center, DEMO.zoom);
});

/* ---------- tabs + panel ---------- */

type Tab = 'layers' | 'warn';
function setTab(t: Tab): void {
  $('tab-layers').hidden = t !== 'layers';
  $('tab-warn').hidden = t !== 'warn';
  $('tab-btn-layers').setAttribute('aria-selected', String(t === 'layers'));
  $('tab-btn-warn').setAttribute('aria-selected', String(t === 'warn'));
  expandPanel();
}
$('tab-btn-layers').addEventListener('click', () => setTab('layers'));
$('tab-btn-warn').addEventListener('click', () => setTab('warn'));

/*
 * Burger: hides/shows the whole side panel (remembered between visits).
 * Panel open → the burger sits first in the panel header (#burger-in).
 * Panel hidden → a floating burger (#burger): top-left on PC, bottom-left on phones.
 */
const PANEL_HIDDEN_KEY = 'tourit.panelHidden';
function setPanelHidden(hidden: boolean): void {
  $('panel').hidden = hidden;
  $('burger').hidden = !hidden;
  if (hidden) resetSheet(); // reopen at the normal size
  document.body.classList.toggle('panel-hidden', hidden);
  try {
    localStorage.setItem(PANEL_HIDDEN_KEY, hidden ? '1' : '0');
  } catch {
    /* storage unavailable: just don't remember */
  }
  // Keep keyboard focus on the visible burger.
  if (document.activeElement?.closest('#burger, #burger-in')) $(hidden ? 'burger' : 'burger-in').focus();
}
$('burger').addEventListener('click', () => setPanelHidden(false));
$('burger-in').addEventListener('click', () => setPanelHidden(true));
initSheet(() => setPanelHidden(true));
try {
  if (localStorage.getItem(PANEL_HIDDEN_KEY) === '1') setPanelHidden(true);
} catch {
  /* ignore */
}

function expandPanel(): void {
  if ($('panel').hidden) setPanelHidden(false);
}

/* ---------- picking a point ---------- */

let pickMarker: L.Marker | null = null;
/** Pick a point: marker, region lookup, terrain at the point. Used by map clicks and the position dot. */
async function pickPoint(ll: L.LatLng): Promise<void> {
  if (!pickMarker) {
    pickMarker = L.marker(ll, {
      icon: L.divIcon({ className: '', html: '<div class="pin"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }),
      keyboard: false,
      interactive: false,
    }).addTo(map);
  } else {
    pickMarker.setLatLng(ll);
  }
  const mine: Picked = { ll, terrain: undefined };
  state.picked = mine;
  state.selected = regionAt(state.regions, ll);
  showCoord('pick', ll.lat, ll.lng, undefined, pointFacts());
  setPick3D(ll);
  restyleRegions();
  renderPanels();
  try {
    mine.terrain = await terrainAt(ll);
  } catch {
    mine.terrain = null;
  }
  if (state.picked !== mine) return;
  renderPanels();
  if (coordSource() === 'pick') setCoordInfo(pointFacts());
}
map.on('click', (e: L.LeafletMouseEvent) => {
  if (!isDrawing()) void pickPoint(e.latlng); // while drawing a route, taps add route points
});

/* ---------- start ---------- */

registerServiceWorker();
initOffline();
initRoute();
initLocate(pickPoint);
init3D(pickPoint);
initCompass(resetNorth3D, '.leaflet-top.leaflet-right > .leaflet-control');
initCoords();

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
initSearch((place) => {
  const ll = L.latLng(place.lat, place.lng);
  const z = Math.max(map.getZoom(), SEARCH_ZOOM);
  resetSheet(); // phones: back to half height so the map is visible
  setHeaderTool(null); // phones: fold the search away again
  const inset = panelInsets();
  if (is3DOpen()) flyTo3D(place.lat, place.lng, z, inset);
  else {
    // Centre the place in the part of the map that isn't covered by the panel.
    const centre = map.unproject(map.project(ll, z).add([-inset.left / 2, inset.bottom / 2]), z);
    map.flyTo(centre, z);
  }
  void pickPoint(ll);
});

onZoom();
state.date = startDate;
followToday = startDate === todayIso();
loadedAt = Date.now();
dateEl.value = state.date;
suggestTomorrow();
trackView(go);
setStatus('Henter varslingsregioner…', 'busy');
fetchRegions()
  .then((regions) => {
    state.regions = regions;
    drawRegions(regions);
    loadObservations(state.date).catch(obsFail);
    return loadWarnings(state.date);
  })
  .catch(warnFail);
