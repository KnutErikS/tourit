import * as L from 'leaflet';
import { load as loadLerc, decode as decodeLerc } from 'lerc';
import lercWasmUrl from 'lerc/lerc-wasm.wasm?url';
import { DTM_URL } from '../config';
import type { DemTile, TerrainPoint } from '../types';
import { analyze, tileBytes } from './analyze';
import { TileCache } from './tileCache';

/**
 * Raw elevation from Kartverket's DTM ImageServer (hoydedata.no), fetched as
 * LERC float32 per Web Mercator tile, then turned into slope/aspect
 * (terrain/analyze.ts).
 *
 * Memory: tiles are kept in a cache with a byte budget, least recently used
 * out first. All tiles but zoom 14 are stored compact (5 bytes per cell
 * instead of 10, see analyze.ts): a 2×-oversampled zoom 10–11 tile is then
 * ~1.3 MB instead of ~2.6 MB, a plain one ~0.33 MB; zoom 14 stays ~0.65 MB.
 */

const CIRC = 40075016.68557849; // Web Mercator world width in metres
const ORIG = 20037508.342789244;

/**
 * The zoom that point analysis reads (terrainAt, the 20 × 20 m slope window,
 * SLABS along routes): its tiles are stored precise. The map layers share them.
 */
export const PRECISE_Z = 14;

/**
 * Cache budget: the tiles a full screen of both computed layers needs at the
 * worst zoom (a 2× tile plus a plain one per map tile, ~1.65 MB, plus Leaflet's
 * buffer around the screen), with room to pan back, within 64–192 MB. A phone
 * gets ~85 MB; a 1920 × 1080 screen hits the 192 MB cap.
 */
function budgetBytes(): number {
  const w = typeof screen !== 'undefined' ? Math.max(screen.width, screen.height) : 1920;
  const h = typeof screen !== 'undefined' ? Math.min(screen.width, screen.height) : 1080;
  const tiles = (Math.ceil(w / 256) + 3) * (Math.ceil(h / 256) + 3);
  const need = tiles * 1.65 * 2 ** 20 * 1.5;
  return Math.round(Math.min(192 * 2 ** 20, Math.max(64 * 2 ** 20, need)));
}
const cache = new TileCache<DemTile>(budgetBytes(), tileBytes);

// lerc ≥4 decodes via WebAssembly; the module must be loaded once before decode().
// Point it at the wasm file Vite emits, since the package's own relative lookup
// breaks once the JS is bundled.
let lercReady: Promise<void> | null = null;
function ensureLerc(): Promise<void> {
  lercReady ??= loadLerc({ locateFile: () => lercWasmUrl }).catch((e) => {
    lercReady = null;
    throw e;
  });
  return lercReady;
}

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

  const compact = !(z === PRECISE_Z && f === 1);
  const p = Promise.all([
    fetch(url).then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    }),
    ensureLerc(),
  ]).then(([buf]) => analyze(decodeLerc(buf), res, ymax + res, n, compact));

  cache.set(key, p); // drops it again if it fails, so the next call retries
  return p;
}

/** For checking memory in the console during development: `__demCache()`. */
if (import.meta.env.DEV) (window as unknown as { __demCache: () => unknown }).__demCache = () => ({ tiles: cache.size, mb: +(cache.bytes / 2 ** 20).toFixed(1), budgetMb: +(cache.budget / 2 ** 20).toFixed(1) });

/** Elevation, slope and aspect at one point, sampled from a zoom-14 tile (~5–10 m cells). */
export async function terrainAt(ll: L.LatLng): Promise<TerrainPoint | null> {
  const z = PRECISE_Z;
  const p = L.CRS.EPSG3857.latLngToPoint(ll, z);
  const x = Math.floor(p.x / 256), y = Math.floor(p.y / 256);
  const an = await getDem(x, y, z, 1);
  const o = (Math.floor(p.y) - y * 256) * 256 + (Math.floor(p.x) - x * 256);
  return an.ok[o] ? { elev: an.elev[o], slope: an.slope[o], sector: an.sector[o] } : null;
}
