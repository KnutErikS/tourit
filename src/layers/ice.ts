import * as L from 'leaflet';
import type { IceObs } from '../domain/ice';
import { map } from '../map';
import { cluster, type Cluster } from './cluster';
import { placePopupClearOfPanel } from './popupPlacement';

/**
 * The Skøyter map: Regobs ice observations as round markers, coloured by the
 * skateability the observer gave (grey without), with the ice thickness in cm
 * inside and a red ring when they reported a risk of going through, danger
 * signs or an incident; observations older than three days are faded.
 * Always on the map while Skøyter is chosen (main.ts adds and removes the layer).
 *
 * As for the crags (layers/climb.ts): below CLUSTER_UNTIL_ZOOM markers closer
 * than CLUSTER_PX share a numbered badge (tap to zoom in), only what is in view
 * is on the map, markers are reused, and one with its popup open is kept.
 */
export const iceLayer = L.layerGroup();

export interface IceItem {
  obs: IceObs;
  /** Show the red ring (domain/ice.ts iceWarnings). */
  warn: boolean;
  /** Fade it. */
  old: boolean;
}

export const itemId = (i: IceItem) => `o${i.obs.id}`;
const posOf = (i: IceItem) => i.obs;
const scoreOf = (i: IceItem) => i.obs.skate;

export const CLUSTER_UNTIL_ZOOM = 12;
const CLUSTER_PX = 40;
const VIEW_PAD = 0.3;

const markers = new Map<string, { marker: L.Marker; html: string }>();
const icon = (html: string, size: number) => L.divIcon({ className: 'ic-hit', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });

let items: IceItem[] = [];
let selected: string | null = null;
let popupFn: (item: IceItem) => HTMLElement = () => document.createElement('div');

export function drawIceMarkers(list: IceItem[], sel: string | null, popup: (item: IceItem) => HTMLElement): void {
  items = list;
  selected = sel;
  popupFn = popup;
  cached = null;
  refresh();
}

map.on('zoomend moveend', () => map.hasLayer(iceLayer) && refresh());
iceLayer.on('add', () => refresh());

let cached: { key: string; clusters: Cluster<IceItem>[] } | null = null;
function clustersAt(zoom: number): Cluster<IceItem>[] {
  const key = `${zoom}|${selected}`;
  if (cached?.key === key) return cached.clusters;
  const at = (i: IceItem) => L.CRS.EPSG3857.latLngToPoint(L.latLng(posOf(i).lat, posOf(i).lng), zoom);
  const clusters = cluster(items.filter((i) => itemId(i) !== selected), at, CLUSTER_PX);
  const sel = items.find((i) => itemId(i) === selected);
  if (sel) {
    const p = at(sel);
    clusters.push({ items: [sel], x: p.x, y: p.y });
  }
  cached = { key, clusters };
  return clusters;
}

function refresh(): void {
  if (!map.hasLayer(iceLayer)) return;
  const zoom = map.getZoom();
  const view = map.getBounds().pad(VIEW_PAD);
  const keep = new Set<string>();
  if (zoom >= CLUSTER_UNTIL_ZOOM) {
    for (const it of items) if (view.contains([posOf(it).lat, posOf(it).lng])) single(it, keep);
  } else {
    for (const c of clustersAt(zoom)) {
      const ll = L.CRS.EPSG3857.pointToLatLng(L.point(c.x, c.y), zoom);
      if (!view.contains(ll)) continue;
      if (c.items.length === 1) single(c.items[0], keep);
      else group(c, ll, zoom, keep);
    }
  }
  for (const [id, { marker }] of markers) {
    if (keep.has(id) || marker.isPopupOpen()) continue;
    marker.remove();
    markers.delete(id);
  }
}

function single(it: IceItem, keep: Set<string>): void {
  const id = itemId(it);
  keep.add(id);
  const sel = id === selected;
  const score = scoreOf(it) ?? -1;
  const o = it.obs;
  const t = o.thicknessCm != null ? String(Math.round(o.thicknessCm)) : '';
  const html = `<div class="ic sc${score}${it.warn ? ' warn' : ''}${it.old ? ' old' : ''}${sel ? ' sel' : ''}">${t ? `<b>${t}</b>` : ''}</div>`;
  const title = `${o.place}${t ? ` · ${t} cm` : ''}`;
  const size = 30;
  const known = markers.get(id);
  if (!known) {
    const { lat, lng } = posOf(it);
    const marker = L.marker([lat, lng], { icon: icon(html, size), title, alt: title, bubblingMouseEvents: false, zIndexOffset: sel ? 500 : 0 });
    marker.on('click', () => placePopupClearOfPanel(marker)); // before bindPopup: runs before the popup pans the map
    // Looked up on every open, so the popup shows the latest data for this marker.
    marker.bindPopup(() => popupFn(items.find((i) => itemId(i) === id) ?? it), { maxWidth: 300, autoPanPadding: [16, 16] });
    marker.addTo(iceLayer);
    markers.set(id, { marker, html });
  } else if (known.html !== html) {
    known.marker.setIcon(icon(html, size));
    known.marker.setZIndexOffset(sel ? 500 : 0);
    known.html = html;
  }
}

function group(c: Cluster<IceItem>, ll: L.LatLng, zoom: number, keep: Set<string>): void {
  const id = `cl:${zoom}:${itemId(c.items[0])}`;
  keep.add(id);
  const n = c.items.length;
  const scores = c.items.flatMap((i) => (scoreOf(i) != null ? [scoreOf(i)!] : []));
  const best = scores.length ? Math.max(...scores) : -1;
  const warn = c.items.some((i) => i.warn);
  const size = n < 10 ? 26 : n < 100 ? 32 : 38;
  const html = `<div class="cg-cl sc${best}${warn ? ' warn' : ''}" style="width:${size}px;height:${size}px"><b>${n}</b></div>`;
  const known = markers.get(id);
  if (known) {
    known.marker.setLatLng(ll);
    if (known.html !== html) {
      known.marker.setIcon(icon(html, size + 6));
      known.html = html;
    }
    return;
  }
  const label = `${n} isobservasjoner${warn ? ', noen med faretegn' : ''}. Trykk for å zoome inn.`;
  const marker = L.marker(ll, { icon: icon(html, size + 6), title: label, alt: label, bubblingMouseEvents: false, zIndexOffset: 100 });
  marker.on('click', () => {
    const bounds = L.latLngBounds(c.items.map((i) => [posOf(i).lat, posOf(i).lng] as [number, number]));
    const fit = map.getBoundsZoom(bounds.pad(0.2));
    map.flyTo(bounds.getCenter(), Math.min(CLUSTER_UNTIL_ZOOM, Math.max(zoom + 2, fit)));
  });
  marker.addTo(iceLayer);
  markers.set(id, { marker, html });
}

export function closeIcePopup(): void {
  map.closePopup();
}
