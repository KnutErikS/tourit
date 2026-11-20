import * as L from 'leaflet';
import { NEAR_MAX, R_MAX, computeHorizon, type Horizon, type Sampler } from '../domain/horizon';
import { getDem } from './dem';
import type { DemTile } from '../types';

/**
 * The terrain horizon around a point (domain/horizon.ts), from Kartverket's
 * DTM: zoom 11 (~27–36 m cells in Norway) out to NEAR_MAX, zoom 9 (~110–145 m)
 * beyond, to R_MAX. Typically 2–4 tiles of each, ~150 kB apiece, fetched in
 * parallel and cached with the map layers' tiles (the aspect layer and saved
 * areas use the same zoom-11 tiles). The march itself is ~40 000 samples.
 *
 * Without network the far tiles usually aren't stored: the horizon then only
 * sees the nearest NEAR_MAX m, which is where most valley shadow comes from.
 */

const NEAR_Z = 11;
const FAR_Z = 9;
const CIRC = 40075016.68557849;
/** Eye height above the snow, m: keeps the DEM cell under you from casting a horizon. */
const EYE_M = 2;

/** Nearest-cell elevation sampler for the area within `radius` m of `ll` at zoom `z`. */
async function sampler(ll: L.LatLng, z: number, radius: number): Promise<Sampler> {
  const pxPerM = 1 / ((CIRC / 2 ** z / 256) * Math.cos((ll.lat * Math.PI) / 180));
  const p = L.CRS.EPSG3857.latLngToPoint(ll, z);
  const r = radius * pxPerM;
  const keys: { x: number; y: number }[] = [];
  for (let y = Math.floor((p.y - r) / 256); y <= Math.floor((p.y + r) / 256); y++)
    for (let x = Math.floor((p.x - r) / 256); x <= Math.floor((p.x + r) / 256); x++) keys.push({ x, y });
  const tiles = new Map<string, DemTile>();
  await Promise.all(keys.map(async (t) => tiles.set(`${t.x}/${t.y}`, await getDem(t.x, t.y, z, 1))));
  return (east, north) => {
    const gx = Math.floor(p.x + east * pxPerM), gy = Math.floor(p.y - north * pxPerM);
    const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256);
    const t = tiles.get(`${tx}/${ty}`);
    if (!t) return NaN;
    const o = (gy - ty * 256) * t.n + (gx - tx * 256);
    return t.ok[o] ? t.elev[o] : NaN;
  };
}

const cache = new Map<string, Promise<Horizon>>();
const MAX_CACHE = 30;

/**
 * The horizon at `ll`, seen from `elev` (m; the DEM height at the point when
 * known, else read from the near tiles). Cached per ~100 m. Rejects when even
 * the near tiles can't be had.
 */
export function horizonFor(ll: L.LatLng, elev?: number | null): Promise<Horizon> {
  const key = `${ll.lat.toFixed(3)},${ll.lng.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const job = (async () => {
    const farJob = sampler(ll, FAR_Z, R_MAX).catch((): Sampler => () => NaN); // in parallel with the near tiles
    const near = await sampler(ll, NEAR_Z, NEAR_MAX);
    const far = await farJob;
    const z = elev ?? near(0, 0);
    if (!Number.isFinite(z)) throw new Error('ingen høydedata for punktet');
    return computeHorizon(near, far, z + EYE_M);
  })();
  cache.set(key, job);
  job.catch(() => cache.delete(key));
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return job;
}
