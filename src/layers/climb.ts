import * as L from 'leaflet';
import type { ClimbRating } from '../domain/climb';
import type { Crag } from '../domain/crags';
import { map } from '../map';
import { placePopupClearOfPanel } from './popupPlacement';
import { cluster, type Cluster } from './cluster';

/**
 * Climbing crags as small rounded squares: coloured by the climbing rating once
 * the weather for the crag is in (crags in the current view), grey before.
 * Always on the map while climbing is chosen (main.ts adds and removes the layer).
 * Tapping one opens a popup (built by ui/climb.ts).
 *
 * Norway has well over a thousand crags, so not all of them become markers:
 * - below CLUSTER_UNTIL_ZOOM, crags closer than CLUSTER_PX on screen are shown
 *   as one numbered badge (tap it to zoom in); the selected crag is never in one;
 * - at every zoom only the crags and clusters in the view (plus VIEW_PAD) are
 *   on the map; the rest are added as the map moves.
 * Markers are reused by crag (and cluster) and only get a new icon when their
 * rating changes, so an open popup stays open; a marker with its popup open is
 * kept even when it leaves the view.
 */
export const climbLayer = L.layerGroup();

export interface ClimbMarker {
  crag: Crag;
  rating: ClimbRating | null;
}

/** From this zoom every crag is its own marker (~10 m per pixel: crags rarely overlap). */
export const CLUSTER_UNTIL_ZOOM = 14;
/** Crags closer than this on screen share a badge, px (a bit more than a marker is wide). */
const CLUSTER_PX = 44;
/** Markers are kept this far outside the view (share of its size), so short pans need no new ones. */
const VIEW_PAD = 0.3;

const markers = new Map<string, { marker: L.Marker; html: string }>();
const icon = (html: string, size = 28) => L.divIcon({ className: 'cg-hit', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });

let items: ClimbMarker[] = [];
let selected: string | null = null;
let popupFn: (crag: Crag) => HTMLElement = () => document.createElement('div');

/** Draw the crags in `list` (the style filter's choice), with their ratings. */
export function drawClimbMarkers(list: ClimbMarker[], sel: string | null, popup: (crag: Crag) => HTMLElement): void {
  items = list;
  selected = sel;
  popupFn = popup;
  refresh();
}

// Follow the map straight away (ui/climb.ts also redraws, but only after the map settles).
map.on('zoomend moveend', () => map.hasLayer(climbLayer) && refresh());
climbLayer.on('add', () => refresh());

/* ---------- clusters per zoom, cached ---------- */

let cached: { key: string; zoom: number; clusters: Cluster<ClimbMarker>[] } | null = null;

/** The clusters at `zoom` for the current crags (ratings may change; membership only with the crags or the selection). */
function clustersAt(zoom: number): Cluster<ClimbMarker>[] {
  const key = `${zoom}|${selected}|${items.length}|${items.map((i) => i.crag.id).join(',')}`;
  if (cached?.key === key) {
    // Same members: refresh the ratings they carry.
    const byId = new Map(items.map((i) => [i.crag.id, i]));
    for (const c of cached.clusters) c.items = c.items.map((i) => byId.get(i.crag.id) ?? i);
    return cached.clusters;
  }
  const free = items.filter((i) => i.crag.id !== selected);
  const clusters = cluster(free, (i) => L.CRS.EPSG3857.latLngToPoint(L.latLng(i.crag.lat, i.crag.lng), zoom), CLUSTER_PX);
  const sel = items.find((i) => i.crag.id === selected);
  if (sel) {
    const p = L.CRS.EPSG3857.latLngToPoint(L.latLng(sel.crag.lat, sel.crag.lng), zoom);
    clusters.push({ items: [sel], x: p.x, y: p.y });
  }
  cached = { key, zoom, clusters };
  return clusters;
}

/* ---------- drawing ---------- */

function refresh(): void {
  if (!map.hasLayer(climbLayer)) return;
  const zoom = map.getZoom();
  const view = map.getBounds().pad(VIEW_PAD);
  const keep = new Set<string>();

  if (zoom >= CLUSTER_UNTIL_ZOOM) {
    for (const it of items) if (view.contains([it.crag.lat, it.crag.lng])) single(it, keep);
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

/** One crag's square. */
function single({ crag, rating }: ClimbMarker, keep: Set<string>): void {
  keep.add(crag.id);
  const sel = crag.id === selected;
  const html = `<div class="cg sc${rating ? rating.score : -1}${sel ? ' sel' : ''}">${rating ? `<b>${rating.score}</b>` : ''}</div>`;
  const known = markers.get(crag.id);
  if (!known) {
    const marker = L.marker([crag.lat, crag.lng], { icon: icon(html), title: crag.name, alt: crag.name, bubblingMouseEvents: false, zIndexOffset: sel ? 500 : 0 });
    marker.on('click', () => placePopupClearOfPanel(marker)); // before bindPopup: runs before the popup pans the map
    marker.bindPopup(() => popupFn(crag), { maxWidth: 300, autoPanPadding: [16, 16] });
    marker.addTo(climbLayer);
    markers.set(crag.id, { marker, html });
  } else if (known.html !== html) {
    known.marker.setIcon(icon(html));
    known.marker.setZIndexOffset(sel ? 500 : 0);
    known.html = html;
  }
}

/** A numbered badge for several crags, coloured by the best rating known among them; tap to zoom in. */
function group(c: Cluster<ClimbMarker>, ll: L.LatLng, zoom: number, keep: Set<string>): void {
  // Keyed by zoom and the first member: stable while panning, new on zoom.
  const id = `cl:${zoom}:${c.items[0].crag.id}`;
  keep.add(id);
  const n = c.items.length;
  const scores = c.items.flatMap((i) => (i.rating ? [i.rating.score] : []));
  const best = scores.length ? Math.max(...scores) : -1;
  const size = n < 10 ? 26 : n < 100 ? 32 : 38;
  const html = `<div class="cg-cl sc${best}" style="width:${size}px;height:${size}px"><b>${n}</b></div>`;
  const known = markers.get(id);
  if (known) {
    known.marker.setLatLng(ll); // the same first crag can lead a cluster with other members after a filter change
    if (known.html !== html) {
      known.marker.setIcon(icon(html, size + 6));
      known.html = html;
    }
    return;
  }
  const label = `${n} klatrefelt${best >= 0 ? `, beste ${best} av 5` : ''}. Trykk for å zoome inn.`;
  const marker = L.marker(ll, { icon: icon(html, size + 6), title: label, alt: label, bubblingMouseEvents: false, zIndexOffset: 100 });
  marker.on('click', () => zoomInto(c, zoom));
  marker.addTo(climbLayer);
  markers.set(id, { marker, html });
}

/** Zoom so the cluster's crags spread out: to fit them, and always at least two steps in. */
function zoomInto(c: Cluster<ClimbMarker>, zoom: number): void {
  const bounds = L.latLngBounds(c.items.map((i) => [i.crag.lat, i.crag.lng] as [number, number]));
  const fit = map.getBoundsZoom(bounds.pad(0.2));
  const target = Math.min(CLUSTER_UNTIL_ZOOM, Math.max(zoom + 2, fit));
  map.flyTo(bounds.getCenter(), target);
}

export function closeClimbPopup(): void {
  map.closePopup();
}
