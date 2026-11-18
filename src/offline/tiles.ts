import * as L from 'leaflet';
import { BASEMAP_MAX_NATIVE, BASEMAP_URL, BRATT_MAX_NATIVE, BRATT_TILE_URL, DEM_MAX_NATIVE, SKRED_MIN_ZOOM } from '../config';
import { demUrl } from '../terrain/dem';

/**
 * Which tile URLs a saved area consists of. The URLs must be byte-for-byte the
 * same as the ones the map layers request, because the service worker looks
 * tiles up by URL.
 */

export type Bounds = [[number, number], [number, number]]; // [[south, west], [north, east]]

export interface AreaSpec {
  bounds: Bounds;
  /** Highest zoom to save. Lower zooms down to MIN_ZOOM are always included. */
  maxZoom: number;
  bratt: boolean;
  /** Elevation tiles for the avalanche-terrain + aspect layers and point picking. */
  terrain: boolean;
}

/** Lowest zoom saved, so you can zoom out and still see the area in context. */
export const MIN_ZOOM = 5;

/** Rough average sizes measured against the live services (bytes per tile). */
const AVG_BYTES = { base: 65_000, bratt: 12_000, dem1: 150_000, dem2: 500_000 };

const CRS = L.CRS.EPSG3857;

function tileRange(b: Bounds, z: number) {
  const nw = CRS.latLngToPoint(L.latLng(b[1][0], b[0][1]), z);
  const se = CRS.latLngToPoint(L.latLng(b[0][0], b[1][1]), z);
  const max = 2 ** z - 1;
  const clamp = (v: number) => Math.min(max, Math.max(0, v));
  return {
    x0: clamp(Math.floor(nw.x / 256)), x1: clamp(Math.floor(se.x / 256)),
    y0: clamp(Math.floor(nw.y / 256)), y1: clamp(Math.floor(se.y / 256)),
  };
}

function* tilesAt(b: Bounds, z: number) {
  const r = tileRange(b, z);
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) yield { x, y, z };
}

const fill = (tpl: string, t: { x: number; y: number; z: number }) => L.Util.template(tpl, t);

export interface TileJob {
  url: string;
  kind: keyof typeof AVG_BYTES;
}

/** Every tile URL for an area, de-duplicated. */
export function areaTiles(a: AreaSpec): TileJob[] {
  const jobs = new Map<string, TileJob>();
  const add = (url: string, kind: TileJob['kind']) => jobs.set(url, { url, kind });

  for (let z = MIN_ZOOM; z <= Math.min(a.maxZoom, BASEMAP_MAX_NATIVE); z++)
    for (const t of tilesAt(a.bounds, z)) add(fill(BASEMAP_URL, t), 'base');

  if (a.bratt)
    for (let z = MIN_ZOOM; z <= Math.min(a.maxZoom, BRATT_MAX_NATIVE); z++)
      for (const t of tilesAt(a.bounds, z)) add(fill(BRATT_TILE_URL, t), 'bratt');

  if (a.terrain)
    for (let z = SKRED_MIN_ZOOM; z <= Math.min(a.maxZoom, DEM_MAX_NATIVE); z++)
      for (const t of tilesAt(a.bounds, z)) {
        // Must mirror the oversampling in layers/avalancheTerrain.ts (2× below zoom 12)
        // and layers/aspect.ts (always 1×, from zoom 11).
        if (z < 12) add(demUrl(t.x, t.y, z, 2), 'dem2');
        if (z >= 11) add(demUrl(t.x, t.y, z, 1), 'dem1');
      }

  return [...jobs.values()];
}

export function estimate(a: AreaSpec): { tiles: number; bytes: number } {
  const jobs = areaTiles(a);
  return { tiles: jobs.length, bytes: jobs.reduce((n, j) => n + AVG_BYTES[j.kind], 0) };
}

export function boundsOf(b: L.LatLngBounds): Bounds {
  const sw = b.getSouthWest(), ne = b.getNorthEast();
  return [[sw.lat, sw.lng], [ne.lat, ne.lng]];
}
