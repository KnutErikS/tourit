import * as L from 'leaflet';
import { BRATT_MAX_NATIVE, BRATT_UTLOP_TILE_URL, RUNOUT, type RunoutClass } from '../config';
import { cumulative } from '../terrain/elevation';

/**
 * Which parts of a route lie in avalanche terrain, read from NVE's "Bratthet
 * med utløp" tiles (the map on the steepness layer with runout on): steep
 * ground (27° and up, where avalanches start) and the three runout bands below
 * it. The tiles have exact, unblended colours, so a pixel tells the class.
 * Using the tiles (not a query) means saved map areas work without signal.
 */

/** Worst first: an avalanche is likelier to reach you the earlier in this list. */
export const ZONES = ['steep', 'short', 'medium', 'long'] as const;
export type Zone = (typeof ZONES)[number];

/** A stretch of the route in one zone, in metres from the start. */
export interface ZoneSection {
  zone: Zone;
  from: number;
  to: number;
  /** The route's points along the stretch, for drawing it on the map. */
  lls: L.LatLng[];
}

/** Test the route this often. */
const STEP = 10;
/** Read tiles at this zoom (~3–6 m pixels in Norway; the model itself is on a 10 m grid) … */
const ZOOM = Math.min(14, BRATT_MAX_NATIVE);
/** … or coarser, for long routes, so one check never asks NVE for more than this many tiles. */
const MAX_TILES = 120;
const MIN_ZOOM = 11;

const CRS = L.CRS.EPSG3857;
const RUNOUT_CLASSES = Object.keys(RUNOUT) as RunoutClass[];

function zoneOf(r: number, g: number, b: number, a: number): Zone | null {
  if (a < 128) return null;
  for (const k of RUNOUT_CLASSES) {
    const [cr, cg, cb] = RUNOUT[k].rgb;
    if (Math.abs(r - cr) + Math.abs(g - cg) + Math.abs(b - cb) < 24) return k;
  }
  return 'steep'; // any other opaque colour is one of the steepness classes
}

/** Decode one tile into a 256×256 array of zone indexes (255 = none). */
async function loadTile(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  const res = await fetch(url, { mode: 'cors', signal });
  const out = new Uint8Array(65536).fill(255);
  if (res.status === 404) return out; // outside NVE's coverage
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bmp = await createImageBitmap(await res.blob());
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const px = ctx.getImageData(0, 0, 256, 256).data;
  for (let i = 0; i < 65536; i++) {
    const z = zoneOf(px[i * 4], px[i * 4 + 1], px[i * 4 + 2], px[i * 4 + 3]);
    if (z) out[i] = ZONES.indexOf(z);
  }
  return out;
}

/** Points every STEP metres along the line, with their distance from the start. */
function samples(pts: L.LatLng[]): { d: number; ll: L.LatLng }[] {
  const cum = cumulative(pts);
  const out = [{ d: 0, ll: pts[0] }];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], len = cum[i] - cum[i - 1];
    const n = Math.max(1, Math.ceil(len / STEP));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push({ d: cum[i - 1] + t * len, ll: k === n ? b : L.latLng(a.lat + (b.lat - a.lat) * t, a.lng + (b.lng - a.lng) * t) });
    }
  }
  return out;
}

/** Stretches of the route in steep terrain or a runout band. Throws on network errors. */
export async function zoneSections(pts: L.LatLng[], signal?: AbortSignal): Promise<ZoneSection[]> {
  if (pts.length < 2) return [];
  const smp = samples(pts);

  // Pick the finest zoom that stays under MAX_TILES.
  let z = ZOOM, keys: Map<string, { x: number; y: number }>;
  for (;;) {
    keys = new Map();
    for (const s of smp) {
      const p = CRS.latLngToPoint(s.ll, z);
      const x = Math.floor(p.x / 256), y = Math.floor(p.y / 256);
      keys.set(`${x}/${y}`, { x, y });
    }
    if (keys.size <= MAX_TILES || z <= MIN_ZOOM) break;
    z--;
  }
  if (keys.size > MAX_TILES) throw new Error('ruta er for lang til å sjekke');

  const tiles = new Map<string, Uint8Array>();
  const list = [...keys];
  // A few at a time, to be polite to NVE.
  for (let i = 0; i < list.length; i += 6)
    await Promise.all(
      list.slice(i, i + 6).map(async ([k, t]) => tiles.set(k, await loadTile(L.Util.template(BRATT_UTLOP_TILE_URL, { ...t, z }), signal))),
    );

  const out: ZoneSection[] = [];
  let cur = null as ZoneSection | null;
  for (const s of smp) {
    const p = CRS.latLngToPoint(s.ll, z);
    const x = Math.floor(p.x / 256), y = Math.floor(p.y / 256);
    const v = tiles.get(`${x}/${y}`)![(Math.floor(p.y) - y * 256) * 256 + (Math.floor(p.x) - x * 256)];
    const zone = v === 255 ? null : ZONES[v];
    if (zone && cur?.zone === zone) {
      cur.to = s.d;
      cur.lls.push(s.ll);
    } else {
      // Start the new stretch where the last one ended, so the drawn pieces meet.
      const prev: L.LatLng | undefined = cur?.lls.at(-1);
      cur = zone ? { zone, from: s.d, to: s.d, lls: prev ? [prev, s.ll] : [s.ll] } : null;
      if (cur) out.push(cur);
    }
  }
  return out;
}

/** Tiles read for single points (the selected point), kept so moving the point nearby is instant. */
const pointTiles = new Map<string, Promise<Uint8Array>>();
const MAX_POINT_TILES = 40;

/** The zone at one point (steep, a runout band, or null). Throws on network errors. */
export async function zoneAt(ll: L.LatLng): Promise<Zone | null> {
  const p = CRS.latLngToPoint(ll, ZOOM);
  const x = Math.floor(p.x / 256), y = Math.floor(p.y / 256);
  const key = `${x}/${y}`;
  let tile = pointTiles.get(key);
  if (!tile) {
    tile = loadTile(L.Util.template(BRATT_UTLOP_TILE_URL, { x, y, z: ZOOM }));
    pointTiles.set(key, tile);
    tile.catch(() => pointTiles.delete(key));
    if (pointTiles.size > MAX_POINT_TILES) pointTiles.delete(pointTiles.keys().next().value!);
  }
  const v = (await tile)[(Math.floor(p.y) - y * 256) * 256 + (Math.floor(p.x) - x * 256)];
  return v === 255 ? null : ZONES[v];
}
