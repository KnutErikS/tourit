import { ASP_RGB, ASPECT_MIN_ZOOM } from '../config';
import { state } from '../state';
import { computedLayer } from '../terrain/computedLayer';
import type { DemTile } from '../types';

/** Colours each cell by the direction the slope faces, if it is at least state.aspMin steep. Shared by 2D and 3D. */
export function drawAspect(tile: HTMLCanvasElement, an: DemTile): void {
  const ctx = tile.getContext('2d')!;
  const img = ctx.createImageData(256, 256), px = img.data;
  for (let o = 0; o < 65536; o++) {
    if (!an.ok[o] || an.slope[o] < state.aspMin) continue;
    const col = ASP_RGB[an.sector[o]], j = o * 4;
    px[j] = col[0]; px[j + 1] = col[1]; px[j + 2] = col[2];
    px[j + 3] = an.slope[o] >= 30 ? 200 : 140;
  }
  ctx.putImageData(img, 0, 0);
}

export function createAspectLayer(onError: (e: Error) => void) {
  return computedLayer({ minZoom: ASPECT_MIN_ZOOM, onError, draw: (tile, an) => drawAspect(tile, an) });
}
