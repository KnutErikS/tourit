import { DANGER_RGB, SKRED_MIN_ZOOM } from '../config';
import { matchesProblem } from '../domain/problems';
import { state } from '../state';
import { computedLayer } from '../terrain/computedLayer';
import type { DemTile } from '../types';
import { onHatch, paintHatch, regionRaster } from './lee';

/** Cell classes, higher wins when merging oversampled cells. */
const NONE = 0, OTHER_STEEP = 1, STEEP_NO_PROBLEMS = 2, HIT = 3, HIT_35 = 4;

/**
 * "Skredfare i terrenget": steep cells that match the aspect + height band of
 * any avalanche problem in the warning for the region they lie in, coloured by
 * danger level.
 *
 * At zoom 10–11 elevation is fetched at 2× resolution and each screen pixel
 * takes the strongest class of its 2×2 samples, so 35° slopes don't get
 * averaged below 30° at coarse resolution.
 *
 * With state.showLee, steep slopes facing the lee of the last days' wind in
 * the region (see domain/wind.ts) get a thin, semi-transparent dark hatch on top.
 * Matching slopes get a thin dark outline; other steep terrain is grey.
 */
/** Oversampling per zoom: 2× elevation samples below zoom 12 (see comment above). */
export const avalancheOversample = (z: number) => (z < 12 ? 2 : 1);

/** Grey for steep terrain outside the avalanche problems ("Vis øvrig bratt terreng svakt"): neutral, so it doesn't read as a danger colour. */
const REST_RGB = [92, 104, 120] as const;
/** Darken a danger colour for the outline of the matching slopes. */
const edgeOf = (c: readonly number[]) => c.map((v) => Math.round(v * 0.45));

/** Draw one 256 px tile. Shared by 2D (Leaflet) and 3D (MapLibre). */
export function drawAvalancheTerrain(tile: HTMLCanvasElement, an: DemTile, coords: { x: number; y: number; z: number }): void {
  const active = state.regions.filter((r) => r.warn && r.warn.level >= 1);
  if (!active.length) return;

  const rid = regionRaster(active, coords);
  const lee = state.showLee;

  const ctx = tile.getContext('2d')!;
  const img = ctx.createImageData(256, 256), px = img.data;
  const n = an.n, f = n / 256, thr = state.thr;

  // Pass 1: the class of every pixel, and whether it is a steep lee slope.
  const cls = new Uint8Array(65536), loadedAt = new Uint8Array(65536);
  for (let o = 0; o < 65536; o++) {
    const r = active[rid[o]];
    if (!r) continue;
    const w = r.warn!, pr = o >> 8, pc = o & 255;
    const wind = lee ? r.wind : null;

    let best = NONE, loaded = false;
    for (let dy = 0; dy < f; dy++)
      for (let dx = 0; dx < f; dx++) {
        const s = (pr * f + dy) * n + pc * f + dx;
        if (!an.ok[s] || an.slope[s] < thr) continue;
        if (wind?.lee[an.sector[s]]) loaded = true;
        if (best === HIT_35) continue;
        let v: number;
        if (!w.problems.length) v = STEEP_NO_PROBLEMS;
        else if (w.problems.some((p) => matchesProblem(p, an.sector[s], an.elev[s])))
          v = an.slope[s] >= 35 ? HIT_35 : HIT;
        else v = OTHER_STEEP;
        if (v > best) best = v;
      }
    cls[o] = best;
    loadedAt[o] = loaded ? 1 : 0;
  }

  // A hit pixel next to a non-hit one gets a thin dark edge. Pixels outside the
  // tile count as hits, so tile borders don't draw lines; lone specks (fewer than
  // two hit neighbours) stay plain, so scattered cells at low zoom don't turn dark.
  // Not at zoom 10: the slopes are only a few pixels wide there, and outlines just add noise.
  const outline = coords.z >= SKRED_MIN_ZOOM + 1;
  const isHit = (o: number) => cls[o] >= HIT;
  const edge = (o: number): boolean => {
    if (!outline || !isHit(o)) return false;
    const r = o >> 8, c = o & 255;
    let hits = 0, out = 0;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr > 255 || cc < 0 || cc > 255 || isHit(rr * 256 + cc)) hits++;
      else out++;
    }
    return out > 0 && hits >= 2;
  };

  // Pass 2: paint.
  for (let o = 0; o < 65536; o++) {
    const best = cls[o];
    if (best === NONE) continue;
    const r = active[rid[o]]!, j = o * 4;
    if (best >= STEEP_NO_PROBLEMS) {
      const col = DANGER_RGB[r.warn!.level];
      px[j] = col[0]; px[j + 1] = col[1]; px[j + 2] = col[2];
      px[j + 3] = best === HIT_35 ? 225 : best === HIT ? 185 : 110;
    } else if (state.showRest) {
      px[j] = REST_RGB[0]; px[j + 1] = REST_RGB[1]; px[j + 2] = REST_RGB[2]; px[j + 3] = 105;
    }
    // Steep lee slopes: wind-loaded, whether or not the warning names that aspect.
    // Stronger on the matching slopes, faint on the rest.
    if (loadedAt[o] && onHatch(coords, o, r.wind!.strong))
      paintHatch(px, j, best >= STEEP_NO_PROBLEMS ? 0.55 : 0.35);
    if (edge(o)) {
      const e = edgeOf(DANGER_RGB[r.warn!.level]);
      px[j] = e[0]; px[j + 1] = e[1]; px[j + 2] = e[2]; px[j + 3] = 235;
    }
  }
  ctx.putImageData(img, 0, 0);
}

export function createAvalancheTerrainLayer(onError: (e: Error) => void) {
  return computedLayer({ minZoom: SKRED_MIN_ZOOM, oversample: avalancheOversample, onError, draw: drawAvalancheTerrain });
}
