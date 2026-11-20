import type * as L from 'leaflet';
import { CLUES, type ClueKey, type Ticks } from '../domain/alptruth';
import { isoDate } from '../util';

/**
 * Your own ALPTRUTh ticks, kept on this device. Clues about the day (A, L, R,
 * U, Th) are kept per date. Clues about the slope (P, T) are kept per date and
 * spot (~100 m), so they don't follow you to the next slope. Dates older than
 * KEEP_DAYS are dropped.
 */

const PREFIX = 'tourit.alptruth.';
const KEEP_DAYS = 30;
const DAY_KEYS = CLUES.filter((c) => !c.spot).map((c) => c.key);
const SPOT_KEYS = CLUES.filter((c) => c.spot).map((c) => c.key);

interface Stored {
  day: Ticks;
  spots: Record<string, Ticks>;
}

/** ~100 m north–south (less east–west up north): ticks for a slope stay with that slope. */
const spotKey = (ll: L.LatLng) => `${ll.lat.toFixed(3)},${ll.lng.toFixed(3)}`;

/** Only known keys with true/false: storage can hold anything. */
function clean(v: unknown, keys: ClueKey[]): Ticks {
  const out: Ticks = {};
  if (v && typeof v === 'object') for (const k of keys) if (typeof (v as Ticks)[k] === 'boolean') out[k] = (v as Ticks)[k];
  return out;
}

/** This session's ticks, so they still work when storage is blocked or full. */
const memory = new Map<string, Stored>();

function read(date: string): Stored {
  const m = memory.get(date);
  if (m) return structuredClone(m);
  try {
    const v = JSON.parse(localStorage.getItem(PREFIX + date) ?? 'null') as Partial<Stored> | null;
    if (v && typeof v === 'object') return { day: v.day ?? {}, spots: v.spots && typeof v.spots === 'object' ? v.spots : {} };
  } catch {
    /* unreadable or blocked: start empty */
  }
  return { day: {}, spots: {} };
}

/** Your ticks for the date, with the slope clues for the spot at `ll`. */
export function loadTicks(date: string, ll: L.LatLng | null): Ticks {
  const s = read(date);
  return { ...clean(s.day, DAY_KEYS), ...(ll ? clean(s.spots[spotKey(ll)], SPOT_KEYS) : {}) };
}

/** Set (true/false) or clear (undefined) your tick. Slope clues need a spot. */
export function setTick(date: string, ll: L.LatLng | null, key: ClueKey, value: boolean | undefined): void {
  const s = read(date);
  let target: Ticks;
  if (SPOT_KEYS.includes(key)) {
    if (!ll) return;
    target = s.spots[spotKey(ll)] ??= {};
  } else target = s.day;
  if (value === undefined) delete target[key];
  else target[key] = value;
  for (const [k, t] of Object.entries(s.spots)) if (!Object.keys(t).length) delete s.spots[k];
  memory.set(date, s);
  try {
    if (!Object.keys(s.day).length && !Object.keys(s.spots).length) localStorage.removeItem(PREFIX + date);
    else localStorage.setItem(PREFIX + date, JSON.stringify(s));
    prune(date);
  } catch {
    /* storage full or blocked: the tick lasts until the page reloads (memory) */
  }
}

/** Drop ticks for dates older than KEEP_DAYS, except `keep` (the date just ticked, e.g. last season's). */
function prune(keep: string): void {
  const oldest = isoDate(new Date(Date.now() - KEEP_DAYS * 86_400_000));
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    const d = k?.startsWith(PREFIX) ? k.slice(PREFIX.length) : null;
    if (d && d < oldest && d !== keep) localStorage.removeItem(k!);
  }
}
