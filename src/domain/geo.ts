import type * as L from 'leaflet';
import type { LatLngTuple, Region } from '../types';

/** Ray-casting point-in-polygon for one ring of [lat, lng]. */
export function inRing(lat: number, lng: number, ring: LatLngTuple[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Forecast region containing the point (rings combined with even-odd rule). */
export function regionAt(regions: Region[], ll: L.LatLng): Region | null {
  return (
    regions.find(
      (r) => r.bounds.contains(ll) && r.rings.reduce((acc, ring) => acc !== inRing(ll.lat, ll.lng, ring), false),
    ) ?? null
  );
}
