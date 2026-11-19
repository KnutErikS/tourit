import { map } from './map';
import { state } from './state';
import { $, isoDate } from './util';

/**
 * Remembers the map view between visits and mirrors it in the URL hash, so a
 * view can be shared as a link.
 *
 * Stored (localStorage, best effort): centre, zoom, which layers are on, the
 * layer settings and the warning date ("today" is stored as "today", so a
 * later visit opens on that day's date).
 *
 * URL hash: `#zoom/lat/lng/layers/date`, e.g. `#12/61.63601/8.31234/sbo/2026-03-14`.
 * Layers are one letter each (s = skredfare, b = bratthet, a = himmelretning,
 * o = observasjoner, `-` = none); the date is left out when it is today.
 * Everything after lat/lng is optional. A hash wins over the stored view.
 */

const KEY = 'tourit.view';

/** Layer checkboxes and their letter in the hash. */
const LAYERS = { s: 'l-skred', b: 'l-bratt', a: 'l-asp', o: 'l-obs' } as const;
type LayerCode = keyof typeof LAYERS;
const CODES = Object.keys(LAYERS) as LayerCode[];

/** Inputs whose value is remembered (selects + range). */
const SETTINGS = ['s-thr', 'a-min', 'o-bratt'] as const;

export interface View {
  zoom: number;
  lat: number;
  lng: number;
  /** Letters of the layers that are on. */
  layers?: string;
  /** YYYY-MM-DD, or 'today'. */
  date?: string;
  settings?: Partial<Record<(typeof SETTINGS)[number], string>>;
  rest?: boolean;
  lee?: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const todayIso = () => isoDate(new Date());

function validPos(zoom: number, lat: number, lng: number): boolean {
  return [zoom, lat, lng].every(Number.isFinite) && Math.abs(lat) <= 85 && Math.abs(lng) <= 180;
}

function readStored(): View | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as View | null;
    return v && validPos(v.zoom, v.lat, v.lng) ? v : null;
  } catch {
    return null;
  }
}

/** Parse `#z/lat/lng[/layers[/date]]`; null if the hash isn't a view. */
export function parseHash(hash = location.hash): View | null {
  const parts = hash.replace(/^#/, '').split('/');
  if (parts.length < 3) return null;
  const [zoom, lat, lng] = parts.slice(0, 3).map(Number);
  if (!validPos(zoom, lat, lng)) return null;
  const v: View = { zoom, lat, lng };
  const layers = parts[3];
  if (layers !== undefined && /^(-|[sbao]*)$/.test(layers)) {
    v.layers = layers === '-' ? '' : layers;
    // With layers given, a missing date means "today" (the sharer was on today).
    v.date = DATE_RE.test(parts[4] ?? '') ? parts[4] : 'today';
  }
  return v;
}

function currentView(): View {
  const c = map.getCenter();
  const settings: View['settings'] = {};
  // Only settings changed from their default, so a later change of default reaches everyone.
  for (const id of SETTINGS) {
    const el = $<HTMLInputElement | HTMLSelectElement>(id);
    if (el.value !== defaultOf(el)) settings[id] = el.value;
  }
  return {
    zoom: map.getZoom(),
    lat: c.lat,
    lng: c.lng,
    layers: CODES.filter((k) => $<HTMLInputElement>(LAYERS[k]).checked).join(''),
    date: !state.date || state.date === todayIso() ? 'today' : state.date,
    settings,
    rest: $<HTMLInputElement>('s-rest').checked,
    lee: $<HTMLInputElement>('s-lee').checked,
  };
}

function hashFor(v: View): string {
  // About 1 m precision at high zoom, shorter numbers when zoomed out.
  const d = Math.min(6, Math.max(2, Math.ceil(v.zoom * 0.35)));
  let h = `#${Math.round(v.zoom)}/${v.lat.toFixed(d)}/${v.lng.toFixed(d)}/${v.layers || '-'}`;
  if (v.date && v.date !== 'today') h += `/${v.date}`;
  return h;
}

/** Link to the current view (for sharing). */
export function shareUrl(): string {
  return location.href.replace(/#.*$/, '') + hashFor(currentView());
}

let ready = false;

/** Store the current view and mirror it in the URL (no new history entry). */
export function saveView(): void {
  if (!ready) return;
  const v = currentView();
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable: just don't remember */
  }
  try {
    history.replaceState(history.state, '', hashFor(v));
  } catch {
    /* some sandboxed webviews refuse; the app still works */
  }
}

/** Set an input's value only if it's one of its allowed values. */
/** The value an input or select has in index.html, before anything is restored. */
function defaultOf(el: HTMLInputElement | HTMLSelectElement): string {
  if (el instanceof HTMLSelectElement) return ([...el.options].find((o) => o.defaultSelected) ?? el.options[0])?.value ?? '';
  return el.defaultValue;
}

/**
 * Earlier versions stored every setting, even untouched ones, so a stored old default
 * can't be told from a deliberate choice. Drop those so the new default applies.
 */
const OLD_DEFAULTS: Partial<Record<(typeof SETTINGS)[number], string>> = { 'o-bratt': '0.75' };

function setValue(id: string, value: string | undefined): void {
  if (value === undefined) return;
  const el = $<HTMLInputElement | HTMLSelectElement>(id);
  if (el instanceof HTMLSelectElement) {
    if ([...el.options].some((o) => o.value === value)) el.value = value;
  } else if (Number.isFinite(+value)) {
    el.value = value; // range input clamps to min/max itself
  }
}

function applyLayers(layers: string | undefined, notify: boolean): void {
  if (layers === undefined) return;
  for (const k of CODES) {
    const box = $<HTMLInputElement>(LAYERS[k]);
    const on = layers.includes(k);
    if (box.checked === on) continue;
    box.checked = on;
    if (notify) box.dispatchEvent(new Event('change'));
  }
}

const resolveDate = (d: string | undefined): string => (d && DATE_RE.test(d) ? d : todayIso());

/**
 * Before the layers are bound: set the map view, the layer checkboxes and the
 * settings inputs from the URL hash / stored view. Returns the date to open.
 * Only touches the DOM inputs; main.ts reads them when it binds the layers.
 */
export function restoreView(): string {
  const stored = readStored();
  const fromHash = parseHash();
  const v = fromHash ?? stored;
  if (v) map.setView([v.lat, v.lng], Math.round(v.zoom), { animate: false });
  applyLayers(v?.layers ?? stored?.layers, false);
  // Settings are personal preferences, never part of the link.
  for (const id of SETTINGS) {
    const value = stored?.settings?.[id];
    if (value !== OLD_DEFAULTS[id]) setValue(id, value);
  }
  if (stored?.rest !== undefined) $<HTMLInputElement>('s-rest').checked = stored.rest;
  if (stored?.lee !== undefined) $<HTMLInputElement>('s-lee').checked = $<HTMLInputElement>('a-lee').checked = stored.lee;
  return resolveDate(fromHash ? fromHash.date : stored?.date);
}

/**
 * After startup: keep storage + URL in step with the map and the controls,
 * and follow a hash pasted into the address bar of an open tab.
 */
export function trackView(go: (date: string) => void): void {
  ready = true;
  map.on('moveend', saveView);
  for (const id of [...Object.values(LAYERS), 's-rest', 's-lee', 'a-lee', ...SETTINGS]) $(id).addEventListener('change', saveView);
  window.addEventListener('hashchange', () => {
    const v = parseHash();
    if (!v) return;
    map.setView([v.lat, v.lng], Math.round(v.zoom));
    applyLayers(v.layers, true);
    if (v.date !== undefined) {
      const date = resolveDate(v.date);
      if (date !== state.date) go(date);
    }
    saveView();
  });
  saveView();
}
