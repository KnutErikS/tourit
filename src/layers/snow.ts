import * as L from 'leaflet';
import { SNOW_MAX_NATIVE, SNOW_WMS_URL } from '../config';
import { esc } from '../util';

/**
 * The seNorge maps offered, by WMS layer name. (seNorge also has 7-day new
 * snow, `sdfsw7d`, but the WMS used here returns it blank.)
 */
export const SNOW_KINDS = {
  sdfsw: 'Nysnø siste døgn',
  sdfsw3d: 'Nysnø siste 3 døgn',
  sd: 'Snødybde',
} as const;
export type SnowKind = keyof typeof SNOW_KINDS;
export const isSnowKind = (k: string): k is SnowKind => k in SNOW_KINDS;

const ATTRIBUTION = 'Snø © <a href="https://www.senorge.no" target="_blank" rel="noopener">NVE / seNorge</a>';

/**
 * NVE's seNorge snow map for one day: a WMS in web mercator with TIME=date.
 * Modelled from weather data on a 1 km grid, so it shows the pattern across a
 * region, not single slopes.
 */
export const snowLayer = L.tileLayer.wms(SNOW_WMS_URL, {
  layers: 'sdfsw3d',
  format: 'image/png',
  transparent: true,
  version: '1.1.1',
  styles: '',
  minZoom: 4,
  maxNativeZoom: SNOW_MAX_NATIVE,
  maxZoom: 17,
  opacity: 0.6,
  pane: 'terrain',
  attribution: ATTRIBUTION,
});

/** The WMS tile URL template for MapLibre (3D), for the given map and date. */
export function snowTileUrl(kind: SnowKind, date: string): string {
  const q = new URLSearchParams({
    SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetMap', LAYERS: kind, STYLES: '', SRS: 'EPSG:3857',
    WIDTH: '256', HEIGHT: '256', FORMAT: 'image/png', TRANSPARENT: 'true', TIME: date,
  });
  return `${SNOW_WMS_URL}?${q}&BBOX={bbox-epsg-3857}`;
}

/** Show `kind` for `date` (YYYY-MM-DD). */
export function setSnow(kind: SnowKind, date: string): void {
  snowLayer.setParams({ layers: kind, TIME: date } as L.WMSParams);
}

/**
 * Colour classes, low to high. Colours are the exact ones in NVE's map images
 * (checked against the tiles); labels follow seNorge's own legend.
 */
const NEW_SNOW: [string, string][] = [
  ['#ccf57a', 'Barmark'], ['#e5e5e5', 'Ikke nysnø'], ['#d9ffff', 'Mulig nysnø'], ['#b3ffff', 'Under 5 cm'],
  ['#80ebff', '5–10 cm'], ['#40ccff', '10–25 cm'], ['#0099ff', '25–50 cm'], ['#0019ff', '50–75 cm'], ['#000099', '75 cm+'],
];
const SNOW_LEGEND: Record<SnowKind, [string, string][]> = {
  sdfsw: NEW_SNOW,
  sdfsw3d: NEW_SNOW,
  sd: [
    ['#ccf57a', 'Barmark'], ['#d9ffff', 'Under 25 cm'], ['#b3ffff', '25–50 cm'], ['#80ebff', '50–100 cm'],
    ['#40ccff', '100–150 cm'], ['#0099ff', '150–200 cm'], ['#0019ff', '200–400 cm'], ['#000099', '400 cm+'],
  ],
};

/** The legend for `kind`, in the same style as the steepness legend. */
export function renderSnowLegend(el: HTMLElement, kind: SnowKind): void {
  el.innerHTML = SNOW_LEGEND[kind].map(([c, label]) => `<span><i class="sw" style="background:${c}"></i>${esc(label)}</span>`).join('');
}

export const SNOW_ATTRIBUTION = ATTRIBUTION;
