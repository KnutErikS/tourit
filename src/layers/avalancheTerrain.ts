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
 * the region (see domain/wind.ts) get a dark diagonal hatch on top.
 */
/** Oversampling per zoom: 2× elevation samples below zoom 12 (see comment above). */
export const avalancheOversample = (z: number) => (z < 12 ? 2 : 1);

/** Draw one 256 px tile. Shared by 2D (Leaflet) and 3D (MapLibre). */
export function drawAvalancheTerrain(tile: HTMLCanvasElement, an: DemTile, coords: { x: number; y: number; z: number }): void {
  const active = state.regions.filter((r) => r.warn && r.warn.level >= 1);
  if (!active.length) return;

  const rid = regionRaster(active, coords);
  const lee = state.showLee;

  const ctx = tile.getContext('2d')!;
  const img = ctx.createImageData(256, 256), px = img.data;
  const n = an.n, f = n / 256, thr = state.thr;

  for (let o = 0; o < 65536; o++) {
    const r = active[rid[o]];
    if (!r) continue;
    const w = r.warn!, j = o * 4, pr = Math.floor(o / 256), pc = o % 256;
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

    if (best >= STEEP_NO_PROBLEMS) {
      const col = DANGER_RGB[w.level];
      px[j] = col[0]; px[j + 1] = col[1]; px[j + 2] = col[2];
      px[j + 3] = best === HIT_35 ? 225 : best === HIT ? 185 : 110;
    } else if (best === OTHER_STEEP && state.showRest) {
      px[j] = 90; px[j + 1] = 105; px[j + 2] = 120; px[j + 3] = 70;
    }
    // Steep lee slopes: wind-loaded, whether or not the warning names that aspect.
    if (loaded && onHatch(coords, o, wind!.strong)) paintHatch(px, j);
  }
  ctx.putImageData(img, 0, 0);
}

export function createAvalancheTerrainLayer(onError: (e: Error) => void) {
  return computedLayer({ minZoom: SKRED_MIN_ZOOM, oversample: avalancheOversample, onError, draw: drawAvalancheTerrain });
}
