import { DIRS } from '../config';
import { horizonAt, type Horizon } from '../domain/horizon';
import { daylight, sunDay, sunOnSlope, type Daylight, type HorizonFn, type Span, type SunDay } from '../domain/sun';
import { state } from '../state';
import { horizonFor } from '../terrain/horizon';
import type { Picked } from '../types';

/** Slope used for the aspect table: typical avalanche terrain. */
const TABLE_SLOPE = 30;

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
const deg = (a: number) => `${Math.round(a)}°`.replace('-', '−');
const dur = (min: number) => {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h} t${m ? ` ${m} min` : ''}` : `${m} min`;
};

/** "09:40–12:10, 15:00–16:20", or "hele døgnet". */
function spanList(s: Span[], dayStart: number, dayEnd: number): string {
  if (s.length === 1 && s[0].from <= dayStart && s[0].to >= dayEnd) return 'hele døgnet';
  // Each span stays on one line; several spans may wrap between them.
  return s.map((x) => `<span class="nw">${hhmm(x.from)}–${x.to >= dayEnd ? '24:00' : hhmm(x.to)}</span>`).join(', ');
}

/* ---------- the picked point's terrain horizon ---------- */

/** h: undefined = being worked out, null = failed. */
type HorizonState = { key: string; h: Horizon | null | undefined; err?: string };
let hz: HorizonState | null = null;
let onReady: () => void = () => {};

/** Called when the horizon is ready (draw the panels again). */
export function initSun(ready: () => void): void {
  onReady = ready;
}

/** The horizon for the picked point, or undefined while it is worked out (then `ready` is called). */
function pickedHorizon(p: Picked): HorizonState {
  const key = `${p.noTerrain ? 'flat:' : ''}${p.ll.lat.toFixed(4)},${p.ll.lng.toFixed(4)}`;
  if (hz?.key === key) return hz;
  // Picked while surfing: no elevation tiles fetched, the sun is shown without terrain shadow.
  if (p.noTerrain) return (hz = { key, h: null, err: 'ikke regnet ut i surfemodus' });
  const mine: HorizonState = { key, h: undefined };
  hz = mine;
  horizonFor(p.ll, p.terrain?.elev).then(
    (h) => {
      if (hz !== mine) return;
      mine.h = h;
      onReady();
    },
    (e: unknown) => {
      if (hz !== mine) return;
      mine.h = null;
      mine.err = navigator.onLine ? (e as Error)?.message || 'feil' : 'uten nett';
      onReady();
    },
  );
  return mine;
}

/* ---------- worked out once per draw ---------- */

interface SunInfo {
  day: SunDay;
  end: number;
  hor: HorizonState;
  hf?: HorizonFn;
  dl: Daylight;
  list: (s: Span[]) => string;
}

function sunInfo(): SunInfo | null {
  const p = state.picked;
  if (!p || !state.date) return null;
  const day = sunDay(state.date, p.ll.lat, p.ll.lng);
  const end = day.start + day.pos.length * 60_000;
  const hor = pickedHorizon(p);
  const h = hor?.h;
  const hf: HorizonFn | undefined = h ? (az) => horizonAt(h, az) : undefined;
  return { day, end, hor, hf, dl: daylight(day, hf), list: (s) => spanList(s, day.start, end) };
}

/** A line for the key box in the Vær tab: which icon, and the text (HTML). */
export interface SunKey {
  icon: 'sun' | 'nosun';
  html: string;
}

/**
 * Sun over the terrain around the picked point, and on the point's own slope,
 * as short lines for the key box at the top of the Vær tab.
 */
export function sunKeys(): SunKey[] {
  const i = sunInfo();
  if (!i) return [];
  const { dl, hor } = i;
  if (dl.polarNight) return [{ icon: 'nosun', html: '<b>Mørketid</b> – sola kommer ikke opp i dag' }];
  const out: SunKey[] = [];
  if (hor.h === undefined) out.push({ icon: 'sun', html: '<b>Sol over terrenget</b> regnes ut…' });
  else if (hor.h === null || !dl.overTerrain) out.push({ icon: 'sun', html: `<b>Sol ${i.list(dl.sun)}</b> (uten terrengskygge)` });
  else if (!dl.overTerrain.length) {
    // The sun is up, but lower than the mountains around: say so, or it reads as a contradiction.
    out.push({ icon: 'nosun', html: `<b>Ingen sol over terrenget</b> – sola er oppe ${i.list(dl.sun)}, men når bare ${deg(dl.maxAlt)} og blir under fjellene` });
  }
  else out.push({ icon: 'sun', html: `<b>Sol over terrenget ${i.list(dl.overTerrain)}</b> (${dur(dl.overTerrainMin!)})` });

  const t = state.picked?.terrain;
  if (t && t.slope >= 5) {
    const s = sunOnSlope(i.day, t.slope, t.sector * 45, i.hf);
    const face = `${DIRS[t.sector]}-hellingen`;
    out.push(s.spans.length
      ? { icon: 'sun', html: `<b>Sol på ${face}</b> ${i.list(s.spans)}` }
      : { icon: 'nosun', html: `<b>Ingen sol</b> på ${face} i dag` });
  }
  return out;
}

/** One line for surfing: when the sun is up and when it is light enough (no terrain or slopes). */
export function daylightKey(): SunKey | null {
  const i = sunInfo();
  if (!i) return null;
  const { dl } = i;
  if (dl.polarNight) return { icon: 'nosun', html: `<b>Mørketid</b>${dl.light.length ? ` – lyst ${i.list(dl.light)}` : ''}` };
  return { icon: 'sun', html: `<b>Sola oppe ${i.list(dl.sun)}</b> · lyst ${i.list(dl.light)}` };
}

/** The "Sol og dagslys" details: sunrise/sunset, daylight and when the sun reaches 30° slopes of each aspect. */
export function sunDetails(): string {
  const i = sunInfo();
  if (!i) return '';
  const { dl, day } = i;
  // "06:08–20:52 (14 t 44 min)": times, then how long, nothing more.
  const full = day.pos.length - 1;
  const timesLine = (spans: Span[], min: number, none: string) =>
    !spans.length ? none : `${i.list(spans)}${min < full ? ` <span class="sun-dur">(${dur(min)})</span>` : ''}`;
  const sunLine = timesLine(dl.sun, dl.sunMin, 'ingen (mørketid)');
  const hor = i.hor.h;
  const terrainLine = dl.polarNight || hor === null ? ''
    : hor === undefined ? 'regnes ut…'
    : timesLine(dl.overTerrain ?? [], dl.overTerrainMin ?? 0, 'ingen – sola er under fjellene');
  const lightLine = timesLine(dl.light, dl.lightMin, 'mørkt hele døgnet');

  // Each aspect at 30°: when the sun is on it, and how strong at best.
  const t = state.picked?.terrain;
  const rows = DIRS.map((d, k) => ({ d, k, s: sunOnSlope(day, TABLE_SLOPE, k * 45, i.hf) }));
  const top = Math.max(1, ...rows.map((r) => r.s.peak));
  const mine = t && t.slope >= 5 ? t.sector : -1;
  const table = rows
    .map(({ d, k, s }) => {
      const sun = s.spans.length > 0; // a grazing sun under the threshold counts as none
      const w = sun ? Math.round((s.peak / top) * 100) : 0;
      return `<div class="sun-row${k === mine ? ' sun-row-me' : ''}"><b>${d}</b>`
        + `<span class="sun-t">${sun ? i.list(s.spans) : '<span class="nw">ingen sol</span>'}</span>`
        + `<span class="sun-bar" title="${sun ? `${Math.round(s.peak)} W/m²` : 'ingen sol'}"><i style="width:${w}%"></i></span>`
        + `<span class="sun-w">${sun ? Math.round(s.peak) : '–'}</span></div>`;
    })
    .join('');

  return `<dl class="wx sun-times">
      <dt>Sola oppe</dt><dd>${sunLine}</dd>
      ${terrainLine ? `<dt>Over terrenget</dt><dd>${terrainLine}</dd>` : ''}
      <dt>Dagslys</dt><dd>${lightLine}</dd>
    </dl>
    ${dl.polarNight ? '' : `<p class="kicker sun-sub">Sol på ${TABLE_SLOPE}° heng · W/m²</p><div class="sun-tab">${table}</div>`}`;
}

/** What to say about the sun calculation, for the sources section. */
export function sunNote(): string {
  const hor: HorizonState | null = hz;
  const shadow = !hor || hor.h === undefined
    ? 'Skygge fra terrenget regnes ut.'
    : hor.h === null
      ? `Skygge fra terrenget er ikke med (${hor.err}): med lav sol og i trange daler kommer sola senere og går tidligere.`
      : 'Skygge fra fjell og dalsider inntil 20 km unna er med, fra Kartverkets høydedata (ca. 30 m celler nær, 140 m lenger ut), så tidene er gode til noen minutter. Skog og snøskavler er ikke med.';
  return `Sol er beregnet på enheten for klarvær. ${shadow} W/m² er sterkeste direkte sol på hellingen; varmen i snøen øker med den. Dagslys er borgerlig tussmørke (sola mindre enn 6° under horisonten).`;
}
