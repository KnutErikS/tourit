import { ASP_RGB, ASPECT_MIN_ZOOM } from '../config';
import { state } from '../state';
import { computedLayer } from '../terrain/computedLayer';
import type { DemTile } from '../types';
import { onHatch, paintHatch, regionRaster } from './lee';

/**
 * Colours each cell by the direction the slope faces, if it is at least state.aspMin steep.
 * With state.showLee, cells facing the lee of the last days' wind in their region get a
 * dark diagonal hatch (see domain/wind.ts). Shared by 2D and 3D.
 */
export function drawAspect(tile: HTMLCanvasElement, an: DemTile, coords: { x: number; y: number; z: number }): void {
  const windy = state.showLee ? state.regions.filter((r) => r.wind?.lee.some(Boolean)) : [];
  const rid = windy.length ? regionRaster(windy, coords) : null;
  const ctx = tile.getContext('2d')!;
  const img = ctx.createImageData(256, 256), px = img.data;
  for (let o = 0; o < 65536; o++) {
    if (!an.ok[o] || an.slope[o] < state.aspMin) continue;
    const col = ASP_RGB[an.sector[o]], j = o * 4;
    px[j] = col[0]; px[j + 1] = col[1]; px[j + 2] = col[2];
    px[j + 3] = an.slope[o] >= 30 ? 200 : 140;
    const wind = rid ? windy[rid[o]]?.wind : null;
    if (wind?.lee[an.sector[o]] && onHatch(coords, o, wind.strong)) paintHatch(px, j);
  }
  ctx.putImageData(img, 0, 0);
}

export function createAspectLayer(onError: (e: Error) => void) {
  return computedLayer({ minZoom: ASPECT_MIN_ZOOM, onError, draw: drawAspect });
}
