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
import { renderDetail } from './ui/detail';
import { roseSVG } from './ui/icons';
import { flyTo3D, focusObs3D, init3D, is3DOpen, resetNorth3D, setPick3D, update3D, update3DObs } from './three/view3d';
import { initCompass } from './ui/compass';
import { initCoords, showCoord } from './ui/coords';
import { initHeaderTools, setHeaderTool } from './ui/headerTools';
import { initSearch } from './ui/search';
import { initSheet, resetSheet } from './ui/sheet';
import { initLocate } from './ui/locate';
import { initOffline } from './ui/offlinePage';
import { reportDemError, setStatus } from './ui/status';
import { renderSummary } from './ui/summary';
import { $, fmtDate, isoDate } from './util';

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

async function loadWarnings(date: string): Promise<void> {
  setStatus(`Henter snøskredvarsler for ${fmtDate(date)}…`, 'busy');
  const byId = await fetchWarnings(date);
  if (state.date !== date) return; // user picked another date meanwhile
  state.regions.forEach((r) => (r.warn = byId.get(r.id) ?? null));
  restyleRegions();
  avalancheLayer.redraw();
  update3D();
  renderPanels();

  const warned = state.regions.filter((r) => r.warn && r.warn.level >= 1);
  $('season').hidden = warned.length > 0;
  if (warned.length) {
    const max = Math.max(...warned.map((r) => r.warn!.level));
    setStatus(`${warned.length} regioner varslet ${fmtDate(date)} · høyeste faregrad ${max} (${DNAME[max].toLowerCase()})`, 'ok');
  } else {
    setStatus(`Ingen regioner har varsel ${fmtDate(date)}.`, 'ok');
  }
}

async function loadObservations(date: string): Promise<void> {
  const el = $('obs-status');
  el.textContent = 'Henter observasjoner…';
  const obs = await fetchObservations(date);
  if (state.date !== date) return;
  state.obs = obs;
  drawObservations(obs);
  update3DObs();
  const nSkred = obs.filter((o) => obsKind(o) === 'skred').length;
  const nImg = obs.reduce((n, o) => n + images(o).length, 0);
  el.textContent = obs.length ? `${obs.length} observasjoner · ${nSkred} med skred · ${nImg} bilder` : 'Ingen snøobservasjoner i perioden.';
  renderPanels();
}

const warnFail = (e: unknown) =>
  setStatus(`Fikk ikke kontakt med NVE sitt varsel-API (${(e as Error)?.message || 'nettverksfeil'}). Prøv igjen om litt.`, 'err');
const obsFail = (e: unknown) => {
  $('obs-status').textContent = `Fikk ikke hentet observasjoner fra Regobs (${(e as Error)?.message || 'nettverksfeil'}).`;
};

const dateEl = $<HTMLInputElement>('date');
function go(date: string): void {
  state.date = date;
  dateEl.value = date;
  loadWarnings(date).catch(warnFail);
  loadObservations(date).catch(obsFail);
}

/* ---------- layer controls ---------- */

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

const today = new Date();
const tomorrow = new Date(Date.now() + 864e5);
dateEl.addEventListener('change', () => dateEl.value && go(dateEl.value));
$('today').addEventListener('click', () => go(isoDate(today)));
$('tomorrow').addEventListener('click', () => go(isoDate(tomorrow)));
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
  showCoord('pick', ll.lat, ll.lng);
  setPick3D(ll);
  restyleRegions();
  renderPanels();
  try {
    mine.terrain = await terrainAt(ll);
  } catch {
    mine.terrain = null;
  }
  if (state.picked === mine) renderPanels();
}
map.on('click', (e: L.LeafletMouseEvent) => void pickPoint(e.latlng));

/* ---------- start ---------- */

registerServiceWorker();
initOffline();
initLocate(pickPoint);
init3D(pickPoint);
initCompass(resetNorth3D, '.ctl3dbar');
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
state.date = isoDate(today);
dateEl.value = state.date;
setStatus('Henter varslingsregioner…', 'busy');
fetchRegions()
  .then((regions) => {
    state.regions = regions;
    drawRegions(regions);
    loadObservations(state.date).catch(obsFail);
    return loadWarnings(state.date);
  })
  .catch(warnFail);
