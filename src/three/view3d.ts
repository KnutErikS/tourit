import * as L from 'leaflet';
import type * as ML from 'maplibre-gl';
import {
  ASPECT_MIN_ZOOM, BASEMAP_MAX_NATIVE, BASEMAP_URL, BRATT_MAX_NATIVE, BRATT_TILE_URL, DANGER, DEM_MAX_NATIVE, DNAME, SKRED_MIN_ZOOM,
  TERRAIN_3D_MAX_ZOOM, TERRAIN_3D_URL,
} from '../config';
import { drawAspect } from '../layers/aspect';
import { avalancheOversample, drawAvalancheTerrain } from '../layers/avalancheTerrain';
import { KIND_LABEL, images, obsKind } from '../domain/observations';
import { getDem } from '../terrain/dem';
import { obsTime, popupHTML } from '../ui/obsHtml';
import type { ObsKind } from '../types';
import { map } from '../map';
import { state } from '../state';
import { setStatus } from '../ui/status';
import { $ } from '../util';

/**
 * 3D view (needs network). A MapLibre GL map shown on top of the Leaflet map,
 * with terrain from AWS Terrain Tiles (Kartverket DTM 10 over Norway) and the
 * Kartverket topo map, NVE steepness and danger-level regions draped over it.
 *
 * MapLibre is loaded on demand the first time 3D is opened, so the 2D app stays
 * light. The 3D map is kept (just hidden) after closing, for a fast reopen.
 *
 * Zoom: Leaflet uses 256 px tiles, MapLibre 512 px, so the same scale is
 * MapLibre zoom = Leaflet zoom − 1.
 */

let ml: typeof ML | null = null;
let m3: ML.Map | null = null;
let pickMarker3: ML.Marker | null = null;
let onPick: (ll: L.LatLng) => void = () => {};

const PITCH = 60;

/* ---------- app-drawn overlays (aspect, avalanche terrain) ---------- */

/**
 * The aspect and avalanche-terrain layers are computed in the browser from
 * Kartverket elevation data. In 3D they're served to MapLibre as raster tiles
 * through a custom `tourit://` protocol, drawn by the same functions as in 2D.
 * `overlayVersion` is part of the URL so a settings change refetches tiles.
 */
let overlayVersion = 0;
const overlayUrl = (kind: 'aspect' | 'skred') => `tourit://${kind}/{z}/{x}/{y}?v=${overlayVersion}`;

async function overlayTile(params: ML.RequestParameters, abort: AbortController): Promise<ML.GetResourceResponse<ArrayBuffer>> {
  const m = /^tourit:\/\/(aspect|skred)\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
  if (!m) throw new Error('Ukjent flis: ' + params.url);
  const kind = m[1], z = +m[2], x = +m[3], y = +m[4];
  const an = await getDem(x, y, z, kind === 'skred' ? avalancheOversample(z) : 1);
  if (abort.signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  if (kind === 'aspect') drawAspect(canvas, an);
  else drawAvalancheTerrain(canvas, an, { x, y, z });
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('Kunne ikke tegne flis');
  return { data: await blob.arrayBuffer() };
}

/** Redraw the app-drawn overlays (new warnings, threshold, aspect filter …). */
function refreshOverlays(): void {
  if (!m3) return;
  overlayVersion++;
  m3.getSource<ML.RasterTileSource>('aspect')?.setTiles([overlayUrl('aspect')]);
  m3.getSource<ML.RasterTileSource>('skred')?.setTiles([overlayUrl('skred')]);
}
const container = () => $('map3d');
export const is3DOpen = () => !container().hidden;

/* ---------- data ---------- */

function regionsGeoJSON(): ML.GeoJSONSourceSpecification['data'] {
  return {
    type: 'FeatureCollection',
    features: state.regions.map((r) => {
      const level = r.warn ? r.warn.level : 0;
      return {
        type: 'Feature',
        properties: { name: r.name, level, color: DANGER[level], label: level ? `${level} ${DNAME[level]}` : 'ikke vurdert' },
        geometry: {
          type: 'MultiPolygon',
          coordinates: r.rings.map((ring) => [ring.map(([lat, lng]) => [lng, lat])]),
        },
      };
    }),
  };
}

const checked = (id: string) => $<HTMLInputElement>(id).checked;
const vis = (on: boolean) => (on ? 'visible' : 'none');

function style(): ML.StyleSpecification {
  return {
    version: 8,
    sources: {
      topo: {
        type: 'raster',
        tiles: [BASEMAP_URL],
        tileSize: 256,
        maxzoom: BASEMAP_MAX_NATIVE,
        attribution: '© <a href="https://www.kartverket.no" target="_blank" rel="noopener">Kartverket</a>',
      },
      bratt: {
        type: 'raster',
        tiles: [BRATT_TILE_URL],
        tileSize: 256,
        maxzoom: BRATT_MAX_NATIVE,
        attribution: 'Bratthet © <a href="https://www.nve.no" target="_blank" rel="noopener">NVE</a>',
      },
      // Separate DEM sources for terrain and hillshade, as MapLibre recommends.
      terrain: {
        type: 'raster-dem',
        tiles: [TERRAIN_3D_URL],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: TERRAIN_3D_MAX_ZOOM,
        attribution:
          'Terreng: <a href="https://registry.opendata.aws/terrain-tiles" target="_blank" rel="noopener">AWS Terrain Tiles</a> (© Kartverket)',
      },
      shade: { type: 'raster-dem', tiles: [TERRAIN_3D_URL], encoding: 'terrarium', tileSize: 256, maxzoom: TERRAIN_3D_MAX_ZOOM },
      aspect: { type: 'raster', tiles: [overlayUrl('aspect')], tileSize: 256, minzoom: ASPECT_MIN_ZOOM, maxzoom: DEM_MAX_NATIVE },
      skred: { type: 'raster', tiles: [overlayUrl('skred')], tileSize: 256, minzoom: SKRED_MIN_ZOOM, maxzoom: DEM_MAX_NATIVE },
      regions: { type: 'geojson', data: regionsGeoJSON() },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#e9edf1' } },
      { id: 'topo', type: 'raster', source: 'topo' },
      { id: 'shade', type: 'hillshade', source: 'shade', paint: { 'hillshade-exaggeration': 0.25 } },
      {
        id: 'bratt',
        type: 'raster',
        source: 'bratt',
        layout: { visibility: vis(checked('l-bratt')) },
        paint: { 'raster-opacity': +$<HTMLInputElement>('o-bratt').value },
      },
      { id: 'aspect', type: 'raster', source: 'aspect', layout: { visibility: vis(checked('l-asp')) } },
      { id: 'skred', type: 'raster', source: 'skred', layout: { visibility: vis(checked('l-skred')) } },
      {
        id: 'regions-fill',
        type: 'fill',
        source: 'regions',
        layout: { visibility: vis(checked('l-skred')) },
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['>', ['get', 'level'], 0], 0.22, 0.04] },
      },
      {
        id: 'regions-line',
        type: 'line',
        source: 'regions',
        layout: { visibility: vis(checked('l-skred')) },
        paint: { 'line-color': ['case', ['>', ['get', 'level'], 0], ['get', 'color'], '#7d8894'], 'line-width': 1.5 },
      },
    ],
    terrain: { source: 'terrain', exaggeration: 1 },
  };
}

/* ---------- keep in sync with the 2D panel ---------- */

/** Call when warnings change (new date). */
export function update3D(): void {
  const src = m3?.getSource('regions') as ML.GeoJSONSource | undefined;
  src?.setData(regionsGeoJSON());
  refreshOverlays();
}

function syncLayers(): void {
  if (!m3) return;
  m3.setLayoutProperty('bratt', 'visibility', vis(checked('l-bratt')));
  m3.setPaintProperty('bratt', 'raster-opacity', +$<HTMLInputElement>('o-bratt').value);
  m3.setLayoutProperty('aspect', 'visibility', vis(checked('l-asp')));
  for (const id of ['skred', 'regions-fill', 'regions-line']) m3.setLayoutProperty(id, 'visibility', vis(checked('l-skred')));
  update3DObs();
}

/** Show the picked point in 3D too. */
export function setPick3D(ll: L.LatLng | null): void {
  if (!m3 || !ml) return;
  if (!ll) {
    pickMarker3?.remove();
    pickMarker3 = null;
    return;
  }
  if (!pickMarker3) {
    const el = document.createElement('div');
    el.className = 'pin';
    pickMarker3 = new ml.Marker({ element: el }).setLngLat([ll.lng, ll.lat]).addTo(m3);
  } else pickMarker3.setLngLat([ll.lng, ll.lat]);
}

/* ---------- Regobs observations ---------- */

const obsMarkers3 = new Map<number, ML.Marker>();
const Z_ORDER: Record<ObsKind, number> = { obs: 0, tegn: 1, skred: 2 };

/** (Re)draw observation markers in 3D. Markers follow the terrain surface. */
export function update3DObs(): void {
  if (!m3 || !ml) return;
  obsMarkers3.forEach((mk) => mk.remove());
  obsMarkers3.clear();
  if (!checked('l-obs')) return;
  state.obs
    .slice()
    .sort((a, b) => Z_ORDER[obsKind(a)] - Z_ORDER[obsKind(b)])
    .forEach((o) => {
      const loc = o.ObsLocation;
      if (!loc || !Number.isFinite(loc.Latitude) || !Number.isFinite(loc.Longitude)) return;
      const k = obsKind(o);
      const el = document.createElement('div');
      el.className = `om ${k}${images(o).length ? ' img' : ''}`;
      el.title = `${KIND_LABEL[k]} · ${obsTime(o)}`;
      el.style.zIndex = String(Z_ORDER[k]);
      const popup = new ml!.Popup({ maxWidth: '320px', offset: 10 }).setHTML(popupHTML(o));
      const mk = new ml!.Marker({ element: el }).setLngLat([loc.Longitude!, loc.Latitude!]).setPopup(popup).addTo(m3!);
      obsMarkers3.set(o.RegId, mk);
    });
}

/** Fly to an observation in 3D and open its popup (from the list in the warning tab). */
export function focusObs3D(regId: number): void {
  const mk = obsMarkers3.get(regId);
  if (!m3 || !mk) return;
  m3.flyTo({ center: mk.getLngLat(), zoom: Math.max(m3.getZoom(), 12) });
  if (!mk.getPopup()?.isOpen()) mk.togglePopup();
}

/* ---------- open / close ---------- */

class Back2DControl implements ML.IControl {
  private el?: HTMLElement;
  onAdd(): HTMLElement {
    this.el = document.createElement('div');
    this.el.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    this.el.innerHTML = '<button type="button" class="ctl3d" title="Tilbake til 2D" aria-label="Tilbake til 2D">2D</button>';
    this.el.querySelector('button')!.addEventListener('click', close3D);
    return this.el;
  }
  onRemove(): void {
    this.el?.remove();
  }
}

async function create(): Promise<ML.Map> {
  if (!ml) {
    const [mod, worker] = await Promise.all([
      import('maplibre-gl'),
      // MapLibre derives its worker URL from its own module URL at runtime, which
      // Vite (dev pre-bundling and production build) doesn't follow. Ship the
      // worker as an asset and point MapLibre at it explicitly.
      import('maplibre-gl/dist/maplibre-gl-worker.mjs?url'),
      import('maplibre-gl/dist/maplibre-gl.css'),
    ]);
    mod.setWorkerUrl(worker.default);
    mod.addProtocol('tourit', overlayTile);
    ml = mod;
  }
  const c = map.getCenter();
  const m = new ml.Map({
    container: container(),
    style: style(),
    center: [c.lng, c.lat],
    zoom: map.getZoom() - 1,
    pitch: PITCH,
    maxPitch: 80,
    attributionControl: { compact: true },
  });
  m.addControl(new Back2DControl(), 'top-right');
  m.addControl(new ml.NavigationControl({ visualizePitch: true }), 'top-right');
  m.addControl(
    new ml.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }),
    'top-right',
  );
  m.on('click', (e) => onPick(L.latLng(e.lngLat.lat, e.lngLat.lng)));
  m.on('error', (e) => console.warn('3D:', e.error?.message ?? e));
  // Attach right away: 'load' can fire before the caller gets the map back.
  m.once('load', () => setStatus('3D-kart: terreng fra Kartverket via AWS Terrain Tiles. Krever nett.', 'ok'));
  // Handy for debugging in the browser console during development: __map3d
  if (import.meta.env.DEV) (window as unknown as { __map3d: ML.Map }).__map3d = m;
  return m;
}

export async function open3D(): Promise<void> {
  container().hidden = false;
  document.body.classList.add('is3d');
  try {
    if (!m3) {
      setStatus('Laster 3D-kart…', 'busy');
      m3 = await create();
      update3DObs();
    } else {
      const c = map.getCenter();
      m3.resize();
      m3.jumpTo({ center: [c.lng, c.lat], zoom: map.getZoom() - 1, pitch: Math.max(m3.getPitch(), 45) });
      update3D();
      syncLayers();
    }
    setPick3D(state.picked ? state.picked.ll : null);
  } catch (e) {
    close3D();
    setStatus(`Kunne ikke åpne 3D-kartet (${(e as Error).message}). Krever nett og WebGL.`, 'err');
  }
}

export function close3D(): void {
  if (m3) {
    const c = m3.getCenter();
    map.setView([c.lat, c.lng], Math.round(m3.getZoom() + 1), { animate: false });
  }
  container().hidden = true;
  document.body.classList.remove('is3d');
}

/* ---------- setup ---------- */

const Toggle3DControl = L.Control.extend({
  onAdd(): HTMLElement {
    const bar = L.DomUtil.create('div', 'leaflet-bar ctl3dbar');
    bar.innerHTML = '<a href="#" role="button" class="ctl3d" title="Vis i 3D" aria-label="Vis i 3D">3D</a>';
    L.DomEvent.disableClickPropagation(bar);
    bar.querySelector('a')!.addEventListener('click', (e) => {
      e.preventDefault();
      void open3D();
    });
    return bar;
  },
});

export function init3D(pick: (ll: L.LatLng) => void): void {
  onPick = pick;
  new Toggle3DControl({ position: 'topright' }).addTo(map);
  for (const id of ['l-bratt', 'l-skred', 'l-asp', 'l-obs']) $(id).addEventListener('change', syncLayers);
  // main.ts updates state on these first (its listeners are registered earlier).
  for (const id of ['s-thr', 's-rest', 'a-min']) $(id).addEventListener('change', refreshOverlays);
  $('o-bratt').addEventListener('input', syncLayers);
}
