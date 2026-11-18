import * as L from 'leaflet';
import { BASEMAP_MAX_NATIVE, BASEMAP_URL } from './config';

/** The single Leaflet map instance. Created when this module is first imported. */
export const map = L.map('map', { zoomControl: false, minZoom: 4, maxZoom: 17, worldCopyJump: false }).setView(
  [64.6, 13.5],
  5,
);

L.control.zoom({ position: 'topright' }).addTo(map);

L.tileLayer(BASEMAP_URL, {
  maxZoom: 17,
  maxNativeZoom: BASEMAP_MAX_NATIVE,
  attribution: '© <a href="https://www.kartverket.no" target="_blank" rel="noopener">Kartverket</a>',
}).addTo(map);

// Draw order: basemap (200) < terrain rasters (380) < region polygons (420) < markers (600).
map.createPane('terrain').style.zIndex = '380';
map.createPane('regions').style.zIndex = '420';
