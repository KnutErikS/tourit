import * as L from 'leaflet';
import type { LatLngTuple } from '../types';

/**
 * Reads a GPX file into one line. Uses the track points if there are any
 * (all tracks and segments joined in order), else route points, else
 * waypoints. GPS tracks often have thousands of points, so the line is
 * simplified to keep it editable.
 */

/** Keep at most this many points (more makes dragging points on a phone impractical). */
const MAX_POINTS = 500;
/** Refuse files with more points than this (a day of 1-second GPS logging is ~50 000). */
const MAX_RAW_POINTS = 200_000;
/** A plain decimal number, optionally with an exponent. Rejects "61abc", "0x3d", "" and the like. */
const NUM = /^\s*[-+]?(\d+(\.\d*)?|\.\d+)(e[-+]?\d+)?\s*$/i;

function num(s: string | null): number {
  return s !== null && NUM.test(s) ? Number(s) : NaN;
}

export interface ParsedGpx {
  name: string;
  points: LatLngTuple[];
}

function pointsOf(doc: Document, tag: string): LatLngTuple[] {
  const els = doc.getElementsByTagNameNS('*', tag);
  if (els.length > MAX_RAW_POINTS) throw new Error(`GPX-filen har for mange punkter (over ${MAX_RAW_POINTS.toLocaleString('nb-NO')}).`);
  const out: LatLngTuple[] = [];
  for (const el of els) {
    const lat = num(el.getAttribute('lat')), lng = num(el.getAttribute('lon'));
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
  // Scattered points (not a real track) can survive any tolerance: thin them out evenly, keeping both ends.
  if (out.length > MAX_POINTS) {
    const src = out, n = MAX_POINTS;
    out = Array.from({ length: n }, (_, i) => src[Math.round((i * (src.length - 1)) / (n - 1))]);
  }
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
