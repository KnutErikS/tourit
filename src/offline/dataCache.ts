/**
 * Keeps the latest API answers on the device, so the app still shows the
 * warning, the observations and the regions when it opens without network.
 *
 * Network first: every successful fetch is stored (in Cache Storage, under a
 * made-up same-origin URL per kind + key). When the fetch fails, or takes so
 * long that the signal is clearly bad, the stored copy is used instead and the
 * caller gets `savedAt`, so the UI can say how old it is.
 *
 * Only the newest few entries per kind are kept (warnings per date, observations
 * per date, one set of regions, the last few weather points).
 */

const DATA_CACHE = 'tourit-data-v1';
const SAVED_AT = 'x-tourit-saved-at';
/** Wait this long for the network before falling back to a stored copy. */
const SLOW_MS = 10_000;

export type Kind = 'warnings' | 'observations' | 'regions' | 'weather' | 'profile' | 'wind' | 'history' | 'webcams' | 'surf' | 'crags';
const KEEP: Record<Kind, number> = { warnings: 8, observations: 4, regions: 1, weather: 6, profile: 6, wind: 4, history: 8, webcams: 1, surf: 2, crags: 1 };

export interface Fetched<T> {
  data: T;
  /** When the stored copy was fetched (ms), or null if this came from the network now. */
  savedAt: number | null;
}

/** Thrown when the network failed and there is nothing stored for this key. */
export class NotStoredError extends Error {
  readonly kind: Kind;
  readonly key: string;
  constructor(kind: Kind, key: string, cause: unknown) {
    super((cause as Error)?.message || 'nettverksfeil');
    this.kind = kind;
    this.key = key;
  }
}

const available = () => typeof caches !== 'undefined';
const prefix = (kind: Kind) => new URL(`__data/${kind}/`, document.baseURI).href;
const urlFor = (kind: Kind, key: string) => prefix(kind) + encodeURIComponent(key);

async function read<T>(kind: Kind, key: string): Promise<Fetched<T> | null> {
  if (!available()) return null;
  try {
    const res = await (await caches.open(DATA_CACHE)).match(urlFor(kind, key));
    if (!res) return null;
    return { data: (await res.json()) as T, savedAt: Number(res.headers.get(SAVED_AT)) || 0 };
  } catch {
    return null;
  }
}

async function write(kind: Kind, key: string, data: unknown): Promise<void> {
  if (!available()) return;
  try {
    const cache = await caches.open(DATA_CACHE);
    const headers = { 'Content-Type': 'application/json', [SAVED_AT]: String(Date.now()) };
    await cache.put(urlFor(kind, key), new Response(JSON.stringify(data), { headers }));
    // Drop the oldest entries of this kind beyond the limit.
    const entries = await entriesOf(cache, kind);
    for (const e of entries.slice(KEEP[kind])) await cache.delete(e.url);
  } catch {
    /* storage full or unavailable: the app still works online */
  }
}

/** Stored entries of a kind, newest first. */
async function entriesOf(cache: Cache, kind: Kind): Promise<{ url: string; key: string; savedAt: number }[]> {
  const p = prefix(kind);
  const out = [];
  for (const req of await cache.keys()) {
    if (!req.url.startsWith(p)) continue;
    const res = await cache.match(req);
    out.push({ url: req.url, key: decodeURIComponent(req.url.slice(p.length)), savedAt: Number(res?.headers.get(SAVED_AT)) || 0 });
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

/** Keys stored for a kind (e.g. the dates with a stored warning), newest fetch first. */
export async function storedKeys(kind: Kind): Promise<string[]> {
  if (!available()) return [];
  try {
    return (await entriesOf(await caches.open(DATA_CACHE), kind)).map((e) => e.key);
  } catch {
    return [];
  }
}

/** The stored copy of a kind + key, or null: for data that changes so slowly that a recent copy needn't be fetched again. */
export function storedCopy<T>(kind: Kind, key: string): Promise<Fetched<T> | null> {
  return read<T>(kind, key);
}

/**
 * Fetch with `load`, store the answer, and fall back to the stored copy when
 * the network fails or is very slow.
 */
export async function withStored<T>(kind: Kind, key: string, load: () => Promise<T>): Promise<Fetched<T>> {
  const fresh = load().then((data) => {
    void write(kind, key, data);
    return { data, savedAt: null } as Fetched<T>;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<'slow'>((resolve) => (timer = setTimeout(() => resolve('slow'), SLOW_MS)));
  try {
    const first = await Promise.race([fresh, slow]);
    if (first !== 'slow') return first;
    // Bad signal: use the stored copy if there is one, otherwise keep waiting.
    return (await read<T>(kind, key)) ?? (await fresh);
  } catch (e) {
    const stored = await read<T>(kind, key);
    if (stored) return stored;
    throw new NotStoredError(kind, key, e);
  } finally {
    clearTimeout(timer);
  }
}
