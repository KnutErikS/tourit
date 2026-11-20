import * as L from 'leaflet';
import { SLOPE_RADIUS_M, WINDOW_M, slopeWindow, type SlopeWindow } from '../domain/slopeWindow';
import { getDem } from './dem';

/** Same zoom as `terrainAt`: ~4–9 m cells in Norway. */
const Z = 14;
const CIRC = 40075016.68557849;

/**
 * Steepest 20 × 20 m around a point and on the slope it is on (see
 * `domain/slopeWindow.ts`). Loads the zoom-14 DEM tiles the search area
 * touches; they are cached and shared with the map layers.
 */
export async function slopeAround(ll: L.LatLng): Promise<SlopeWindow> {
  const cell = (CIRC / 2 ** Z / 256) * Math.cos((ll.lat * Math.PI) / 180);
  const half = Math.ceil((SLOPE_RADIUS_M + WINDOW_M) / cell);
  const size = 2 * half + 1;
  const p = L.CRS.EPSG3857.latLngToPoint(ll, Z);
  const px = Math.floor(p.x), py = Math.floor(p.y);

  const tiles = new Map<string, { x: number; y: number }>();
  const x0 = Math.floor((px - half) / 256), x1 = Math.floor((px + half) / 256);
  const y0 = Math.floor((py - half) / 256), y1 = Math.floor((py + half) / 256);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.set(`${x}/${y}`, { x, y });
  const dem = new Map(await Promise.all([...tiles].map(async ([k, t]) => [k, await getDem(t.x, t.y, Z, 1)] as const)));

  const slope = new Float32Array(size * size), elev = new Float32Array(size * size), ok = new Uint8Array(size * size);
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++) {
      const gx = px - half + c, gy = py - half + r;
      const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256);
      const t = dem.get(`${tx}/${ty}`);
      if (!t) continue;
      const o = (gy - ty * 256) * t.n + (gx - tx * 256);
      if (!t.ok[o]) continue;
      slope[r * size + c] = t.slope[o];
      elev[r * size + c] = t.elev[o];
      ok[r * size + c] = 1;
    }
  return slopeWindow({ size, cell, slope, elev, ok });
}
