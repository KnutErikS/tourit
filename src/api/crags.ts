import { OVERPASS_API } from '../config';
import { CRAG_QUERY, MIN_CRAGS, parseCrags, readSnapshot, type Crag, type CragSnapshot, type OsmElement } from '../domain/crags';
import { storedCopy, withStored, type Fetched } from '../offline/dataCache';

/*
 * Every climbing crag in Norway. Loaded, in this order:
 *  1. the copy stored on the device, at once, whatever its age (crags change
 *     slowly); when it is older than REFRESH_MS a new one is fetched in the
 *     background and handed to `onUpdate`;
 *  2. the prebuilt snapshot on our own host (data/crags.json, made weekly by
 *     scripts/crags.ts in the deploy workflow): one small file, no waiting on
 *     Overpass;
 *  3. the live Overpass query, only when the snapshot is missing (dev, or the
 *     build couldn't reach Overpass) or older than SNAPSHOT_MAX_AGE.
 *
 * Overpass: POST as a form (a "simple" request: no CORS preflight). It answers
 * every request with Access-Control-Allow-Origin: *.
 */

const REFRESH_MS = 86_400_000;
const SNAPSHOT_MAX_AGE = 21 * 86_400_000;
const SNAPSHOT_URL = 'data/crags.json';
const KEY = 'norway';

async function fromSnapshot(): Promise<CragSnapshot | null> {
  try {
    // no-cache: revalidate with the host, so a new weekly build shows up.
    const res = await fetch(new URL(SNAPSHOT_URL, document.baseURI), { cache: 'no-cache' });
    return res.ok ? readSnapshot(await res.json()) : null;
  } catch {
    return null; // missing (the dev server answers with index.html), or offline
  }
}

async function fromOverpass(): Promise<Crag[]> {
  const res = await fetch(OVERPASS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(CRAG_QUERY)}`,
  });
  if (!res.ok) throw new Error(res.status === 429 || res.status === 504 ? 'OpenStreetMap-tjenesten er opptatt' : `HTTP ${res.status}`);
  const json = (await res.json()) as { elements?: OsmElement[] };
  const crags = parseCrags(json.elements ?? []);
  if (crags.length < MIN_CRAGS) throw new Error('for få klatrefelt i svaret');
  return crags;
}

async function load(): Promise<Crag[]> {
  const snap = await fromSnapshot();
  if (snap && Date.now() - snap.generated < SNAPSHOT_MAX_AGE) return snap.crags;
  try {
    return await fromOverpass();
  } catch (e) {
    if (snap) return snap.crags; // old, but better than nothing
    throw e;
  }
}

/** Fingerprint to tell whether a refresh changed anything worth redrawing. */
const sameList = (a: Crag[], b: Crag[]) => a.length === b.length && JSON.stringify(a) === JSON.stringify(b);

export async function fetchCrags(onUpdate?: (crags: Crag[]) => void): Promise<Fetched<Crag[]>> {
  const stored = await storedCopy<Crag[]>('crags', KEY);
  if (stored) {
    if (Date.now() - (stored.savedAt ?? 0) > REFRESH_MS) {
      void withStored('crags', KEY, load)
        .then((fresh) => {
          if (fresh.savedAt === null && !sameList(fresh.data, stored.data)) onUpdate?.(fresh.data);
        })
        .catch(() => {}); // keep the stored copy; try again next time
    }
    return { data: stored.data, savedAt: null };
  }
  return withStored('crags', KEY, load);
}
