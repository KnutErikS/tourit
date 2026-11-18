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

function expandPanel(): void {
  $('panel').classList.remove('collapsed');
  $('toggle').textContent = 'Skjul';
  $('toggle').setAttribute('aria-expanded', 'true');
}
$('toggle').addEventListener('click', () => {
  const collapsed = $('panel').classList.toggle('collapsed');
  $('toggle').textContent = collapsed ? 'Vis' : 'Skjul';
  $('toggle').setAttribute('aria-expanded', String(!collapsed));
});

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
