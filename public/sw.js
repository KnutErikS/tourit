/*
 * Service worker for saved map areas.
 *
 * The app downloads tiles for an area into Cache Storage (src/offline/download.ts).
 * This worker only reads from that cache: map tiles, steepness tiles and elevation
 * data are served from the device when saved, otherwise fetched from the network
 * as usual. Nothing is cached automatically while browsing.
 *
 * CACHE must match OFFLINE_CACHE in src/config.ts.
 */
const CACHE = 'tourit-tiles-v1';
const TILE_HOSTS = new Set(['cache.kartverket.no', 'gis3.nve.no', 'hoydedata.no']);

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let host;
  try {
    host = new URL(req.url).hostname;
  } catch {
    return;
  }
  if (!TILE_HOSTS.has(host)) return;

  event.respondWith(
    caches
      .open(CACHE)
      .then((cache) => cache.match(req.url, { ignoreVary: true }))
      .then((hit) => hit || fetch(req))
      .catch(() => fetch(req)),
  );
});
