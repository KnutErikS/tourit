import * as L from 'leaflet';
import type { LatLngTuple } from '../types';

/**
 * Reads a GPX file into one line. Uses the track points if there are any
 * (all tracks and segments joined in order), else route points, else
 * waypoints. GPS tracks often have thousands of points, so the line is
 * simplified to keep it editable.
 */

/** Keep at most about this many points (more makes dragging points on a phone impractical). */
const MAX_POINTS = 500;

export interface ParsedGpx {
  name: string;
  points: LatLngTuple[];
}

function pointsOf(doc: Document, tag: string): LatLngTuple[] {
  const out: LatLngTuple[] = [];
  for (const el of doc.getElementsByTagNameNS('*', tag)) {
    const lat = parseFloat(el.getAttribute('lat') ?? ''), lng = parseFloat(el.getAttribute('lon') ?? '');
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) out.push([lat, lng]);
  }
  return out;
}

/** Douglas–Peucker in Web Mercator pixels, with a tolerance that grows until the line is short enough. */
function simplify(pts: LatLngTuple[]): LatLngTuple[] {
  if (pts.length <= MAX_POINTS) return pts;
  const z = 17; // ~1 m per pixel in Norway
  const px = pts.map((p) => L.CRS.EPSG3857.latLngToPoint(L.latLng(p[0], p[1]), z));
  let out = px;
  for (let tol = 2; out.length > MAX_POINTS && tol < 1e5; tol *= 1.6) out = L.LineUtil.simplify(px, tol);
  return out.map((p) => {
    const ll = L.CRS.EPSG3857.pointToLatLng(p, z);
    return [+ll.lat.toFixed(6), +ll.lng.toFixed(6)] as LatLngTuple;
  });
}

export function parseGpx(text: string): ParsedGpx {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length || doc.documentElement.localName !== 'gpx') throw new Error('Filen er ikke en gyldig GPX-fil.');
  let points = pointsOf(doc, 'trkpt');
  if (points.length < 2) points = pointsOf(doc, 'rtept');
  if (points.length < 2) points = pointsOf(doc, 'wpt');
  if (points.length < 2) throw new Error('Fant ingen spor eller rute i GPX-filen.');
  // Prefer the track/route name, then the file's metadata name.
  const nameEl = doc.querySelector('trk > name, rte > name, metadata > name');
  return { name: (nameEl?.textContent ?? '').trim().slice(0, 60), points: simplify(points) };
}
