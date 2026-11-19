import * as L from 'leaflet';
import { getDem } from './dem';

/**
 * Elevation profiles along a line, sampled from the same Kartverket DTM tiles
 * as the terrain layers (so saved areas also work offline for this).
 */

export interface ProfilePoint {
  /** Distance from the start, metres. */
  d: number;
  ll: L.LatLng;
  /** Metres above sea level, or null where the DTM has no data (sea, outside Norway). */
  z: number | null;
}

export interface ProfileStats {
  ascent: number;
  descent: number;
  min: number | null;
  max: number | null;
}

/** Up to this many samples along the line (plus one per vertex). */
const MAX_SAMPLES = 400;
/** Never sample closer than this (DTM cells are ~5–10 m at zoom 14). */
const MIN_STEP = 10;
/** Ignore ups and downs smaller than this, so DTM noise doesn't add up to fake climbing. */
const HYSTERESIS = 3;
/** Fetch this many DTM tiles at a time. */
const PARALLEL = 6;

/** Distance along each segment, as cumulative metres per vertex. */
export function cumulative(pts: L.LatLng[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + pts[i - 1].distanceTo(pts[i]));
  return out;
}

/** Points along the line: every vertex, plus evenly spaced points in between. */
function samplePoints(pts: L.LatLng[]): { d: number; ll: L.LatLng }[] {
  const cum = cumulative(pts);
  const total = cum[cum.length - 1];
  const step = Math.max(MIN_STEP, total / MAX_SAMPLES);
  const out: { d: number; ll: L.LatLng }[] = [{ d: 0, ll: pts[0] }];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], len = cum[i] - cum[i - 1];
    const n = Math.floor(len / step);
    for (let k = 1; k <= n; k++) {
      const t = (k * step) / len;
      if (t >= 0.999) break;
      out.push({ d: cum[i - 1] + t * len, ll: L.latLng(a.lat + (b.lat - a.lat) * t, a.lng + (b.lng - a.lng) * t) });
    }
    out.push({ d: cum[i], ll: b });
  }
  return out;
}

/**
 * Elevation profile for a line. Zoom 13 (~9 m cells in southern Norway, like DTM 10) is plenty for
 * trip numbers and needs a quarter of the tiles of zoom 14; very long routes use zoom 12.
 */
export async function profileOf(
  pts: L.LatLng[],
  signal?: { cancelled: boolean },
  onProgress?: (done: number, total: number) => void,
): Promise<ProfilePoint[]> {
  if (pts.length < 2) return [];
  const samples = samplePoints(pts);
  const total = samples[samples.length - 1].d;
  const z = total > 40_000 ? 12 : 13;

  // Which tile and pixel each sample falls in.
  const at = samples.map((s) => {
    const p = L.CRS.EPSG3857.latLngToPoint(s.ll, z);
    const x = Math.floor(p.x / 256), y = Math.floor(p.y / 256);
    return { key: `${x}/${y}`, x, y, o: (Math.floor(p.y) - y * 256) * 256 + (Math.floor(p.x) - x * 256) };
  });
  const keys = [...new Set(at.map((a) => a.key))];
  const tiles = new Map<string, Awaited<ReturnType<typeof getDem>> | null>();
  // A pool of PARALLEL requests: a slow tile doesn't hold up the others.
  let next = 0, done = 0;
  const worker = async () => {
    while (next < keys.length && !signal?.cancelled) {
      const k = keys[next++];
      const [x, y] = k.split('/').map(Number);
      try {
        tiles.set(k, await getDem(x, y, z, 1));
      } catch {
        tiles.set(k, null);
      }
      onProgress?.(++done, keys.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, keys.length) }, worker));
  if (signal?.cancelled) return [];
  return samples.map((s, i) => {
    const t = tiles.get(at[i].key);
    const o = at[i].o;
    return { d: s.d, ll: s.ll, z: t && t.ok[o] ? t.elev[o] : null };
  });
}

export function statsOf(profile: ProfilePoint[]): ProfileStats {
  let ascent = 0, descent = 0, min: number | null = null, max: number | null = null, ref: number | null = null;
  for (const p of profile) {
    if (p.z === null) continue;
    min = min === null ? p.z : Math.min(min, p.z);
    max = max === null ? p.z : Math.max(max, p.z);
    if (ref === null) ref = p.z;
    else if (p.z - ref >= HYSTERESIS) (ascent += p.z - ref), (ref = p.z);
    else if (ref - p.z >= HYSTERESIS) (descent += ref - p.z), (ref = p.z);
  }
  return { ascent, descent, min, max };
}
