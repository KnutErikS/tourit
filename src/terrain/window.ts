import * as L from 'leaflet';
import { SLOPE_RADIUS_M, WINDOW_M, slopeWindow, type SlopeGrid, type SlopeWindow } from '../domain/slopeWindow';
import { PRECISE_Z, getDem } from './dem';

/** Same zoom as `terrainAt`, the one stored precise (box means of slope need the decimals): ~4–9 m cells in Norway. */
const Z = PRECISE_Z;
const CIRC = 40075016.68557849;

/** The zoom-14 DEM tiles a square of `halfM` metres around `ll` touches, as "x/y". */
export function tilesAround(ll: L.LatLng, halfM: number): { x: number; y: number }[] {
  const cell = (CIRC / 2 ** Z / 256) * Math.cos((ll.lat * Math.PI) / 180);
  const half = Math.ceil(halfM / cell);
  const p = L.CRS.EPSG3857.latLngToPoint(ll, Z);
  const px = Math.floor(p.x), py = Math.floor(p.y);
  const out: { x: number; y: number }[] = [];
  for (let y = Math.floor((py - half) / 256); y <= Math.floor((py + half) / 256); y++)
    for (let x = Math.floor((px - half) / 256); x <= Math.floor((px + half) / 256); x++) out.push({ x, y });
  return out;
}

/**
 * A square grid of slope, elevation and aspect sector centred on `ll`,
 * `halfM` metres to each side, from the zoom-14 DEM tiles (cached and shared
 * with the map layers).
 */
export async function gridAround(ll: L.LatLng, halfM: number): Promise<SlopeGrid & { elev: Float32Array; sector: Uint8Array }> {
  const cell = (CIRC / 2 ** Z / 256) * Math.cos((ll.lat * Math.PI) / 180);
  const half = Math.ceil(halfM / cell);
  const size = 2 * half + 1;
  const p = L.CRS.EPSG3857.latLngToPoint(ll, Z);
  const px = Math.floor(p.x), py = Math.floor(p.y);
  const dem = new Map(await Promise.all(tilesAround(ll, halfM).map(async (t) => [`${t.x}/${t.y}`, await getDem(t.x, t.y, Z, 1)] as const)));

  const N = size * size;
  const slope = new Float32Array(N), elev = new Float32Array(N), sector = new Uint8Array(N), ok = new Uint8Array(N);
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++) {
      const gx = px - half + c, gy = py - half + r;
      const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256);
      const t = dem.get(`${tx}/${ty}`);
      if (!t) continue;
      const o = (gy - ty * 256) * t.n + (gx - tx * 256);
      if (!t.ok[o]) continue;
      const i = r * size + c;
      slope[i] = t.slope[o];
      elev[i] = t.elev[o];
      sector[i] = t.sector[o];
      ok[i] = 1;
    }
  return { size, cell, slope, elev, sector, ok };
}

/**
 * Steepest 20 × 20 m around a point and on the slope it is on (see
 * `domain/slopeWindow.ts`).
 */
export async function slopeAround(ll: L.LatLng): Promise<SlopeWindow> {
  return slopeWindow(await gridAround(ll, SLOPE_RADIUS_M + WINDOW_M));
}
