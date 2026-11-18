import * as L from 'leaflet';
import Lerc, { type LercPixelBlock } from 'lerc';
import { DTM_URL } from '../config';
import type { DemTile, TerrainPoint } from '../types';

/**
 * Raw elevation from Kartverket's DTM ImageServer (hoydedata.no), fetched as
 * LERC float32 per Web Mercator tile, then turned into slope/aspect here.
 */

const CIRC = 40075016.68557849; // Web Mercator world width in metres
const ORIG = 20037508.342789244;
const MAX_CACHE = 500;
const cache = new Map<string, Promise<DemTile>>();

/** Exact DTM request URL for tile (x, y, z) at oversampling f. Also used by offline downloads. */
export function demUrl(x: number, y: number, z: number, f = 1): string {
  const n = 256 * f;
  const size = CIRC / 2 ** z;
  const res = size / n;
  const xmin = -ORIG + x * size;
  const ymax = ORIG - y * size;
  const bbox = [xmin - res, ymax - size - res, xmin + size + res, ymax + res].join(',');
  return (
    `${DTM_URL}?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=${n + 2},${n + 2}` +
    `&format=lerc&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image`
  );
}

/**
 * Elevation analysis for tile (x, y, z).
 * `f` = oversampling: fetch f×f elevation samples per screen pixel, so steep
 * slopes are not smoothed away at low zoom. The grid gets a 1-cell border so
 * the 3×3 slope kernel works at the tile edges.
 */
export function getDem(x: number, y: number, z: number, f = 1): Promise<DemTile> {
  const key = `${z}/${x}/${y}/${f}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const n = 256 * f;
  const size = CIRC / 2 ** z;
  const res = size / n;
  const ymax = ORIG - y * size;
  const url = demUrl(x, y, z, f);

  const p = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    })
    .then((buf) => analyze(Lerc.decode(buf), res, ymax + res, n));

  cache.set(key, p);
  p.catch(() => cache.delete(key));
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return p;
}

/** Slope (Horn's method) and aspect for n×n cells from an (n+2)×(n+2) grid. */
export function analyze(d: LercPixelBlock, res: number, ytop: number, n: number): DemTile {
  const W = d.width, Z = d.pixels[0], M = d.mask;
  const N = n * n;
  const slope = new Float32Array(N), sector = new Uint8Array(N), elev = new Float32Array(N), ok = new Uint8Array(N);
  if (W !== n + 2 || d.height !== n + 2) return { n, slope, sector, elev, ok };

  const good = (i: number) => (!M || M[i]) && Z[i] > -500 && Z[i] < 9000;
  for (let r = 0; r < n; r++) {
    // Ground distance between cells shrinks with latitude in Web Mercator.
    const ym = ytop - (r + 1.5) * res;
    const g = res * Math.cos(Math.atan(Math.sinh(ym / 6378137)));
    for (let c = 0; c < n; c++) {
      const i = (r + 1) * W + (c + 1), o = r * n + c;
      const a = i - W - 1, b = i - W, cc = i - W + 1, dd = i - 1, f = i + 1, gg = i + W - 1, h = i + W, ii = i + W + 1;
      if (!(good(i) && good(a) && good(b) && good(cc) && good(dd) && good(f) && good(gg) && good(h) && good(ii))) continue;
      const dzx = (Z[cc] + 2 * Z[f] + Z[ii] - (Z[a] + 2 * Z[dd] + Z[gg])) / (8 * g); // rise towards east
      const dzr = (Z[gg] + 2 * Z[h] + Z[ii] - (Z[a] + 2 * Z[b] + Z[cc])) / (8 * g); // rise towards south (row dir)
      slope[o] = (Math.atan(Math.hypot(dzx, dzr)) * 180) / Math.PI;
      let asp = (Math.atan2(-dzx, dzr) * 180) / Math.PI;
      if (asp < 0) asp += 360;
      sector[o] = Math.floor(((asp + 22.5) % 360) / 45);
      elev[o] = Z[i];
      ok[o] = 1;
    }
  }
  return { n, slope, sector, elev, ok };
}

/** Elevation, slope and aspect at one point, sampled from a zoom-14 tile (~5–10 m cells). */
export async function terrainAt(ll: L.LatLng): Promise<TerrainPoint | null> {
  const z = 14;
  const p = L.CRS.EPSG3857.latLngToPoint(ll, z);
  const x = Math.floor(p.x / 256), y = Math.floor(p.y / 256);
  const an = await getDem(x, y, z, 1);
  const o = (Math.floor(p.y) - y * 256) * 256 + (Math.floor(p.x) - x * 256);
  return an.ok[o] ? { elev: an.elev[o], slope: an.slope[o], sector: an.sector[o] } : null;
}
