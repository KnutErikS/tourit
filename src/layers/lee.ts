import * as L from 'leaflet';
import type { Region } from '../types';

const CRS = L.CRS.EPSG3857;

/**
 * Which of `regions` each pixel of a 256 px tile lies in: index into `regions`,
 * or -1. Polygons are drawn into a scratch canvas with the index in the red channel.
 */
export function regionRaster(regions: Region[], coords: { x: number; y: number; z: number }): Int8Array {
  const out = new Int8Array(65536).fill(-1);
  const ox = coords.x * 256, oy = coords.y * 256;
  const tb = L.latLngBounds(CRS.pointToLatLng(L.point(ox, oy + 256), coords.z), CRS.pointToLatLng(L.point(ox + 256, oy), coords.z));
  const hit = regions.map((r, idx) => [r, idx] as const).filter(([r]) => r.bounds.intersects(tb));
  if (!hit.length) return out;

  const off = document.createElement('canvas');
  off.width = off.height = 256;
  const oc = off.getContext('2d', { willReadFrequently: true })!;
  // Red = (index + 1) * 4, so antialiased edges still round to a neighbour. Up to 62 regions.
  for (const [r, idx] of hit) {
    oc.fillStyle = `rgb(${(idx + 1) * 4},0,0)`;
    oc.beginPath();
    r.rings.forEach((ring) =>
      ring.forEach(([lat, lng], k) => {
        const p = CRS.latLngToPoint(L.latLng(lat, lng), coords.z);
        if (k) oc.lineTo(p.x - ox, p.y - oy);
        else oc.moveTo(p.x - ox, p.y - oy);
      }),
    );
    oc.fill('evenodd');
  }
  const red = oc.getImageData(0, 0, 256, 256).data;
  for (let o = 0; o < 65536; o++) {
    const i = Math.round(red[o * 4] / 4) - 1;
    if (i >= 0 && i < regions.length) out[o] = i;
  }
  return out;
}

/** Colour of the wind-loading hatch: dark, so it reads on both the aspect and the danger colours. */
export const LEE_RGB = [11, 18, 32] as const;

/**
 * Diagonal stripes over lee cells, in world pixels so they line up across tiles.
 * Strong loading gets denser stripes.
 */
export function onHatch(coords: { x: number; y: number }, o: number, strong: boolean): boolean {
  const gx = coords.x * 256 + (o & 255), gy = coords.y * 256 + (o >> 8);
  return (gx + gy) % (strong ? 6 : 9) < 2;
}

/** Paint one hatch pixel over whatever is in `px` at byte offset j. */
export function paintHatch(px: Uint8ClampedArray, j: number): void {
  px[j] = LEE_RGB[0]; px[j + 1] = LEE_RGB[1]; px[j + 2] = LEE_RGB[2];
  px[j + 3] = 210;
}
