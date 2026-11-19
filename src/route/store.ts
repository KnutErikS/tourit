import type { LatLngTuple } from '../types';

/** A saved route (localStorage). Elevation is recomputed when it's opened; the numbers here are for the list. */
export interface SavedRoute {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  points: LatLngTuple[];
  /** Metres. */
  length: number;
  ascent: number | null;
  descent: number | null;
}

const KEY = 'tourit.savedRoutes.v1';
const DRAFT_KEY = 'tourit.routeDraft.v1';

const isPoint = (p: unknown): p is LatLngTuple =>
  Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n)) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;

const isRoute = (r: unknown): r is SavedRoute =>
  !!r && typeof r === 'object' && typeof (r as SavedRoute).id === 'string' && Array.isArray((r as SavedRoute).points) && (r as SavedRoute).points.every(isPoint);

export function listRoutes(): SavedRoute[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter(isRoute) : [];
  } catch {
    return [];
  }
}

function save(list: SavedRoute[]): void {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function putRoute(r: SavedRoute): void {
  const list = listRoutes();
  const i = list.findIndex((x) => x.id === r.id);
  if (i >= 0) list[i] = r;
  else list.unshift(r);
  save(list);
}

export function removeRoute(id: string): void {
  save(listRoutes().filter((r) => r.id !== id));
}

/** The route being drawn, so it survives a reload. `id` is set when it's a saved route being edited. */
export interface Draft {
  points: LatLngTuple[];
  id: string | null;
  name: string;
}

export function readDraft(): Draft | null {
  try {
    const v = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (!v || !Array.isArray(v.points) || !v.points.every(isPoint)) return null;
    return { points: v.points, id: typeof v.id === 'string' ? v.id : null, name: typeof v.name === 'string' ? v.name : '' };
  } catch {
    return null;
  }
}

export function writeDraft(d: Draft | null): void {
  try {
    if (d && d.points.length) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage unavailable */
  }
}
