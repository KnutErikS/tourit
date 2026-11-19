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
