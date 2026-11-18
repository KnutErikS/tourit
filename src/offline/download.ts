import { OFFLINE_CACHE } from '../config';
import { type SavedArea, listAreas, putArea, removeArea } from './store';
import { areaTiles } from './tiles';

const CONCURRENCY = 6;

export interface Progress {
  done: number;
  total: number;
  failed: number;
  bytes: number;
}

/**
 * Download every tile of `area` that isn't on the device yet. Tiles already
 * cached (e.g. shared with another saved area) are skipped, so this also works
 * to resume an interrupted download. Saves progress to the store as it goes.
 */
export async function downloadArea(
  area: SavedArea,
  onProgress: (p: Progress) => void,
  signal: AbortSignal,
): Promise<SavedArea> {
  const cache = await caches.open(OFFLINE_CACHE);
  const jobs = areaTiles(area);
  const p: Progress = { done: 0, total: jobs.length, failed: 0, bytes: 0 };
  let next = 0;
  let lastSave = 0;

  const persist = () => {
    area = { ...area, tiles: p.total, stored: p.done - p.failed, failed: p.failed, bytes: p.bytes };
    putArea(area);
  };

  async function worker() {
    while (next < jobs.length && !signal.aborted) {
      const { url } = jobs[next++];
      try {
        const hit = await cache.match(url);
        if (hit) {
          p.bytes += (await hit.blob()).size;
        } else {
          const res = await fetch(url, { mode: 'cors', signal });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const blob = await res.clone().blob();
          await cache.put(url, res);
          p.bytes += blob.size;
        }
      } catch {
        if (signal.aborted) return;
        p.failed++;
      }
      p.done++;
      onProgress({ ...p });
      if (Date.now() - lastSave > 1000) {
        lastSave = Date.now();
        persist();
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  persist();
  return area;
}

/**
 * Delete an area. Tiles that another saved area also needs are kept.
 */
export async function deleteArea(id: string): Promise<void> {
  const all = listAreas();
  const victim = all.find((a) => a.id === id);
  removeArea(id);
  if (!victim) return;

  const keep = new Set<string>();
  for (const a of all) if (a.id !== id) for (const j of areaTiles(a)) keep.add(j.url);

  const cache = await caches.open(OFFLINE_CACHE);
  const urls = areaTiles(victim).map((j) => j.url).filter((u) => !keep.has(u));
  for (let i = 0; i < urls.length; i += 50) await Promise.all(urls.slice(i, i + 50).map((u) => cache.delete(u)));
}

export interface StorageInfo {
  usage: number;
  quota: number;
  persisted: boolean;
}

export async function storageInfo(): Promise<StorageInfo | null> {
  if (!navigator.storage?.estimate) return null;
  const [{ usage = 0, quota = 0 }, persisted] = await Promise.all([
    navigator.storage.estimate(),
    navigator.storage.persisted?.() ?? Promise.resolve(false),
  ]);
  return { usage, quota, persisted };
}

/** Ask the browser not to evict saved areas when space runs low. */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((e) => console.warn('Service worker:', e));
}

export const offlineSupported = () => 'caches' in window && 'serviceWorker' in navigator;
