import * as L from 'leaflet';
import {
  BASEMAP_ATTRIBUTION, BASEMAP_MAX_NATIVE, BASEMAP_URL,
  SVALBARD_BASEMAP_ATTRIBUTION, SVALBARD_BASEMAP_URL, SVALBARD_BOUNDS, SVALBARD_MAX_NATIVE,
} from './config';

/** The single Leaflet map instance. Created when this module is first imported. */
export const map = L.map('map', { zoomControl: false, minZoom: 4, maxZoom: 17, worldCopyJump: false }).setView(
  [64.6, 13.5],
  5,
);

L.control.zoom({ position: 'topright' }).addTo(map);

/*
 * Leaflet only re-measures its container on window `resize`. In the iPhone Home Screen
 * app the map can be created before the window has its final size, and the size can
 * then change without a `resize` (the launch settling, or --app-h from ui/viewport.ts).
 * Leaflet then keeps the old size: a blank map, or tiles missing along an edge. Watch
 * the container itself, and check again whenever the app comes back to the screen.
 */
const refit = () => requestAnimationFrame(() => map.invalidateSize({ debounceMoveend: true }));
new ResizeObserver(refit).observe(map.getContainer());
window.addEventListener('pageshow', refit);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refit());

L.tileLayer(BASEMAP_URL, {
  maxZoom: 17,
  maxNativeZoom: BASEMAP_MAX_NATIVE,
  attribution: BASEMAP_ATTRIBUTION,
}).addTo(map);

// Svalbard: Polarinstitutt's map over Kartverket's (which is blank there). `bounds`
// keeps Leaflet from requesting it anywhere else; sea tiles 404 and show Kartverket below.
L.tileLayer(SVALBARD_BASEMAP_URL, {
  maxZoom: 17,
  maxNativeZoom: SVALBARD_MAX_NATIVE,
  bounds: SVALBARD_BOUNDS,
  attribution: SVALBARD_BASEMAP_ATTRIBUTION,
}).addTo(map);

// Draw order: basemap (200) < terrain rasters (380) < region polygons (420) < markers (600).
map.createPane('terrain').style.zIndex = '380';
map.createPane('regions').style.zIndex = '420';
