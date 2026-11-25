import * as L from 'leaflet';
import { map } from '../map';
import { type SavedRoute, listRoutes, readShown, writeShown } from '../route/store';
import type { LatLngTuple } from '../types';
import { esc } from '../util';

/**
 * Saved routes shown on the map next to the open one ("Vis på kartet" in the
 * route page, ui/routePage.ts), each in its own colour, so several tours can be
 * compared at once. Only the open route gets the terrain and risk checks; these
 * are drawn plain, under it. Which ones are shown is remembered on the device.
 */

map.createPane('routes-shown').style.zIndex = '445';
const shownGroup = L.layerGroup().addTo(map);
let shown = new Set<string>(readShown());
let shownKey = '';
/** Colours for shown routes: clear of the open route's magenta, the zones' red and blues and SLABS/Munter's orange. */
const SHOWN_COLORS = ['#6a1b9a', '#2e7d32', '#5d4037', '#455a64', '#9e9d24', '#00695c'];

export const isShown = (id: string) => shown.has(id);
export const shownIds = (): ReadonlySet<string> => shown;

export function setShown(ids: Iterable<string>): void {
  shown = new Set(ids);
  writeShown([...shown]);
}

/**
 * A route's colour follows the order routes were saved in (oldest first), so
 * it doesn't change when others are shown or hidden, and the first six differ.
 */
export function shownColor(id: string, routes: SavedRoute[] = listRoutes()): string {
  const i = routes.length - 1 - routes.findIndex((r) => r.id === id);
  return SHOWN_COLORS[i % SHOWN_COLORS.length];
}

const endIcon = (color: string, start: boolean) =>
  L.divIcon({ className: '', html: `<div class="rt-v rt-o${start ? ' start' : ''}" style="--c:${color}"></div>`, iconSize: [12, 12], iconAnchor: [6, 6] });

/** Draw the shown saved routes, except the open one (`openId`, drawn in full by the route page). Redrawn only when something changed. */
export function drawShown(routes: SavedRoute[], openId: string | null): void {
  const list = routes.filter((r) => shown.has(r.id) && r.id !== openId && r.points.length > 1);
  const key = list.map((r) => `${r.id}@${r.updatedAt}`).join('|');
  if (key === shownKey) return;
  shownKey = key;
  shownGroup.clearLayers();
  for (const r of list) {
    const color = shownColor(r.id, routes);
    const lls = r.points.map(([a, b]) => L.latLng(a, b));
    L.polyline(lls, { pane: 'routes-shown', color: '#fff', weight: 6, opacity: 0.8, interactive: false }).addTo(shownGroup);
    // Taps go on to the map (a route point while drawing, a picked point otherwise); hover shows the name.
    L.polyline(lls, { pane: 'routes-shown', color, weight: 3.5, opacity: 0.95 })
      .bindTooltip(esc(r.name), { sticky: true, direction: 'top', className: 'rt-tip' })
      .addTo(shownGroup);
    L.marker(lls[0], { pane: 'routes-shown', icon: endIcon(color, true), interactive: false, keyboard: false }).addTo(shownGroup);
    L.marker(lls[lls.length - 1], { pane: 'routes-shown', icon: endIcon(color, false), interactive: false, keyboard: false }).addTo(shownGroup);
  }
}

/** Fit the map to every shown route and the open one (`open`, its points). */
export function fitShown(routes: SavedRoute[], open: L.LatLng[]): void {
  const lls: LatLngTuple[] = routes.filter((r) => shown.has(r.id)).flatMap((r) => r.points);
  lls.push(...open.map((p) => [p.lat, p.lng] as LatLngTuple));
  if (lls.length) map.fitBounds(L.latLngBounds(lls), { padding: [40, 40] });
}
