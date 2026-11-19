/*
 * Service worker: makes the app open without network.
 *
 * 1. The app itself. On install, the page and its built files are stored in a
 *    versioned "shell" cache. The list is written into this file at build time
 *    (see swPrecache() in vite.config.ts); in dev it stays empty and nothing is
 *    stored. The page is fetched from the network first (so updates show up),
 *    with the stored copy as fallback; built files have content hashes, so they
 *    are served straight from the cache.
 *
 * 2. Saved map areas. The app downloads tiles for an area into Cache Storage
 *    (src/offline/download.ts). Map tiles, steepness tiles and elevation data are
 *    served from there when saved, otherwise fetched from the network as usual.
 *    TILE_CACHE must match OFFLINE_CACHE in src/config.ts.
 *
 * Warnings, observations and regions are not handled here: the app stores the
 * latest ones itself (src/offline/dataCache.ts), so it can say how old they are.
 */
const TILE_CACHE = 'tourit-tiles-v1';
const TILE_HOSTS = new Set(['cache.kartverket.no', 'gis3.nve.no', 'hoydedata.no']);

/* Filled in by the build: built files to store, and a version for the shell cache. */
const PRECACHE = [];
const SHELL_VERSION = 'dev';

const SHELL_PREFIX = 'tourit-shell-';
const SHELL_CACHE = SHELL_PREFIX + SHELL_VERSION;
const scoped = (path) => new URL(path, self.registration.scope).href;
const INDEX = scoped('index.html');
/** How long to wait for the network before showing the stored page (weak signal in the mountains). */
const PAGE_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      if (PRECACHE.length) {
        const cache = await caches.open(SHELL_CACHE);
        // cache: 'reload' so we don't store a stale copy from the HTTP cache.
        await cache.addAll(['index.html', ...PRECACHE].map((p) => new Request(scoped(p), { cache: 'reload' })));
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith(SHELL_PREFIX) && n !== SHELL_CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

/** Network first, stored page if the network fails or is too slow. */
async function page(req) {
  const network = fetch(req);
  const timeout = new Promise((resolve) => setTimeout(resolve, PAGE_TIMEOUT_MS));
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
  } catch {
    /* offline: fall through to the stored page */
  }
  const stored = await caches.match(INDEX, { cacheName: SHELL_CACHE });
  return stored || network; // nothing stored (dev, or first visit): keep waiting for the network
}

async function fromCache(cacheName, req) {
  try {
    const hit = await (await caches.open(cacheName)).match(req.url, { ignoreVary: true });
    if (hit) return hit;
  } catch {
    /* cache unavailable: use the network */
  }
  return fetch(req);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      if (PRECACHE.length) event.respondWith(page(req));
      return;
    }
    if (PRECACHE.length) event.respondWith(fromCache(SHELL_CACHE, req));
    return;
  }

  if (TILE_HOSTS.has(url.hostname)) event.respondWith(fromCache(TILE_CACHE, req));
});
