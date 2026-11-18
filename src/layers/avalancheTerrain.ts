import * as L from 'leaflet';
import { DANGER_RGB, SKRED_MIN_ZOOM } from '../config';
import { matchesProblem } from '../domain/problems';
import { state } from '../state';
import { computedLayer } from '../terrain/computedLayer';

const CRS = L.CRS.EPSG3857;

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
 */
export function createAvalancheTerrainLayer(onError: (e: Error) => void) {
  return computedLayer({
    minZoom: SKRED_MIN_ZOOM,
    oversample: (z) => (z < 12 ? 2 : 1),
    onError,
    draw(tile, an, coords) {
      const active = state.regions.filter((r) => r.warn && r.warn.level >= 1);
      if (!active.length) return;

      // Rasterise region polygons for this tile: red channel = (region index + 1) * 4.
      const off = document.createElement('canvas');
      off.width = off.height = 256;
      const oc = off.getContext('2d', { willReadFrequently: true })!;
      const ox = coords.x * 256, oy = coords.y * 256;
      const tb = L.latLngBounds(
        CRS.pointToLatLng(L.point(ox, oy + 256), coords.z),
        CRS.pointToLatLng(L.point(ox + 256, oy), coords.z),
      );
      active.forEach((r, idx) => {
        if (!r.bounds.intersects(tb)) return;
        oc.fillStyle = `rgb(${(idx + 1) * 4},0,0)`;
        oc.beginPath();
        r.rings.forEach((ring) =>
          ring.forEach(([lat, lng], k) => {
            const p = CRS.latLngToPoint(L.latLng(lat, lng), coords.z);
            const x = p.x - ox, y = p.y - oy;
            if (k) oc.lineTo(x, y);
            else oc.moveTo(x, y);
          }),
        );
        oc.fill('evenodd');
      });
      const rid = oc.getImageData(0, 0, 256, 256).data;

      const ctx = tile.getContext('2d')!;
      const img = ctx.createImageData(256, 256), px = img.data;
      const n = an.n, f = n / 256, thr = state.thr;

      for (let o = 0; o < 65536; o++) {
        const r = active[Math.round(rid[o * 4] / 4) - 1];
        if (!r) continue;
        const w = r.warn!, j = o * 4, pr = Math.floor(o / 256), pc = o % 256;

        let best = NONE;
        for (let dy = 0; dy < f && best < HIT_35; dy++)
          for (let dx = 0; dx < f && best < HIT_35; dx++) {
            const s = (pr * f + dy) * n + pc * f + dx;
            if (!an.ok[s] || an.slope[s] < thr) continue;
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
      }
      ctx.putImageData(img, 0, 0);
    },
  });
}
