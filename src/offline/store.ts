import type { AreaSpec } from './tiles';

/** A saved map area. The tiles live in Cache Storage; this is the metadata (in localStorage). */
export interface SavedArea extends AreaSpec {
  id: string;
  name: string;
  createdAt: string;
  /** Tiles in the area / how many are actually on the device. */
  tiles: number;
  stored: number;
  failed: number;
  /** Bytes of this area's tiles (tiles shared with other areas are counted in both). */
  bytes: number;
}

const KEY = 'tourit.savedAreas.v1';

export function listAreas(): SavedArea[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function save(list: SavedArea[]): void {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function putArea(a: SavedArea): void {
  const list = listAreas();
  const i = list.findIndex((x) => x.id === a.id);
  if (i >= 0) list[i] = a;
  else list.unshift(a);
  save(list);
}

export function removeArea(id: string): void {
  save(listAreas().filter((a) => a.id !== id));
}

export const isComplete = (a: SavedArea) => a.stored >= a.tiles;
