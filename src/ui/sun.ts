import { DIRS } from '../config';
import { horizonAt, type Horizon } from '../domain/horizon';
import { daylight, sunDay, sunOnSlope, type HorizonFn, type Span } from '../domain/sun';
import { state } from '../state';
import { horizonFor } from '../terrain/horizon';
import type { Picked } from '../types';
import { fmtDate } from '../util';

/** Slope used for the aspect table: typical avalanche terrain. */
const TABLE_SLOPE = 30;

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
const dur = (min: number) => {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h} t${m ? ` ${m} min` : ''}` : `${m} min`;
};
const altTxt = (a: number) => `${Math.round(a)}°`.replace('-', '−');

/** "09:40–12:10, 15:00–16:20", or "hele døgnet". */
function spanList(s: Span[], dayStart: number, dayEnd: number): string {
  if (s.length === 1 && s[0].from <= dayStart && s[0].to >= dayEnd) return 'hele døgnet';
  // Each span stays on one line; several spans may wrap between them.
  return s.map((x) => `<span class="nw">${hhmm(x.from)}–${x.to >= dayEnd ? '24:00' : hhmm(x.to)}</span>`).join(', ');
}

/* ---------- the picked point's terrain horizon ---------- */

/** undefined = being worked out, null = failed. */
let hz: { key: string; h: Horizon | null | undefined; err?: string } | null = null;
let onReady: () => void = () => {};

/** Called when the horizon is ready (draw the panels again). */
export function initSun(ready: () => void): void {
  onReady = ready;
}

/** The horizon for the picked point, or undefined while it is worked out (then `ready` is called). */
function pickedHorizon(p: Picked): typeof hz {
  const key = `${p.ll.lat.toFixed(4)},${p.ll.lng.toFixed(4)}`;
  if (hz?.key === key) return hz;
  const mine: NonNullable<typeof hz> = { key, h: undefined };
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

/**
 * The "Sol og dagslys" card for the picked point and the selected date:
 * sunrise/sunset, daylight, when the sun reaches the point's own slope, and
 * when it reaches 30° slopes of each aspect. All computed on the device.
 */
export function sunCard(): string {
  const p = state.picked;
  if (!p || !state.date) return '';
  const day = sunDay(state.date, p.ll.lat, p.ll.lng);
  const end = day.start + day.pos.length * 60_000;
  const hor = pickedHorizon(p);
  const h = hor?.h;
  const hf: HorizonFn | undefined = h ? (az) => horizonAt(h, az) : undefined;
  const dl = daylight(day, hf);
  const list = (s: Span[]) => spanList(s, day.start, end);

  const high = `høyest ${altTxt(dl.maxAlt)} kl. ${hhmm(dl.noon)}`;
  let sunLine: string;
  if (dl.polarNight) sunLine = `<b>Mørketid</b>: sola er under horisonten hele dagen (${high})`;
  else if (dl.midnightSun) sunLine = `<b>Midnattssol</b>: sola går ikke ned (${high})`;
  else {
    const one = dl.sun.length === 1 ? dl.sun[0] : null;
    sunLine = one
      ? `opp ${one.from <= day.start ? '–' : hhmm(one.from)} · ned ${one.to >= end ? '–' : hhmm(one.to)} (${dur(dl.sunMin)}) · ${high}`
      : `${list(dl.sun)} (${dur(dl.sunMin)}) · ${high}`;
  }
  // When the sun is above the mountains around the point.
  let terrainLine = '';
  if (dl.overTerrain && !dl.polarNight) {
    const blocked = Math.round(dl.sunMin - (dl.overTerrainMin ?? 0));
    terrainLine = !dl.overTerrain.length
      ? 'sola kommer ikke over fjellene rundt i dag'
      : `${list(dl.overTerrain)} (${dur(dl.overTerrainMin!)})${blocked >= 5 ? `, ${dur(blocked)} i skyggen av terrenget` : ''}`;
  }
  const lightLine = !dl.light.length ? 'mørkt hele døgnet' : `${list(dl.light)}${dl.lightMin < day.pos.length - 1 ? ` (${dur(dl.lightMin)})` : ''}`;

  // The point's own slope (when the terrain is known).
  let here = '';
  const t = p.terrain;
  if (t) {
    const face = t.slope < 5 ? 'flatt' : `${Math.round(t.slope)}° ${DIRS[t.sector]}-vendt`;
    const s = sunOnSlope(day, t.slope, t.sector * 45, hf);
    here = s.spans.length
      ? `${face}: sol ${list(s.spans)}, sterkest ${Math.round(s.peak)} W/m² kl. ${hhmm(s.peakAt!)}`
      : `${face}: ingen direkte sol i dag`;
  }

  // Each aspect at 30°: when the sun is on it, and how strong at best.
  const rows = DIRS.map((d, k) => ({ d, k, s: sunOnSlope(day, TABLE_SLOPE, k * 45, hf) }));
  const top = Math.max(1, ...rows.map((r) => r.s.peak));
  const mine = t && t.slope >= 5 ? t.sector : -1;
  const table = rows
    .map(({ d, k, s }) => {
      const sun = s.spans.length > 0; // a grazing sun under the threshold counts as none
      const w = sun ? Math.round((s.peak / top) * 100) : 0;
      return `<div class="sun-row${k === mine ? ' me' : ''}"><b>${d}</b>`
        + `<span class="sun-t">${sun ? list(s.spans) : '<span class="nw">ingen sol</span>'}</span>`
        + `<span class="sun-bar" title="${sun ? `${Math.round(s.peak)} W/m²` : 'ingen sol'}"><i style="width:${w}%"></i></span>`
        + `<span class="sun-w">${sun ? Math.round(s.peak) : '–'}</span></div>`;
    })
    .join('');

  return `<div class="wxcard">
    <p class="kicker">Sol og dagslys</p>
    <div class="rsub">${fmtDate(state.date)}</div>
    <dl class="wx">
      <dt>Sol</dt><dd>${sunLine}</dd>
      ${terrainLine ? `<dt>Over fjellene</dt><dd>${terrainLine}</dd>` : ''}
      <dt>Dagslys</dt><dd>${lightLine}</dd>
      ${here ? `<dt>Punktet</dt><dd>${here}</dd>` : ''}
    </dl>
    ${dl.polarNight ? '' : `<p class="kicker sun-sub">Sol på ${TABLE_SLOPE}° heng</p><div class="sun-tab">${table}</div>`}
    <p class="wx-src">Beregnet på enheten for klarvær. ${shadowNote(hor)} W/m² er sterkeste direkte sol på hellingen; varmen i snøen øker med den. Dagslys er borgerlig tussmørke (sola mindre enn 6° under horisonten).</p>
  </div>`;
}

/** What the card says about terrain shadow. */
function shadowNote(hor: typeof hz): string {
  if (!hor || hor.h === undefined) return 'Regner ut skygge fra terrenget rundt…';
  if (hor.h === null) return `Skygge fra terrenget er ikke med (${hor.err}): med lav sol og i trange daler kommer sola senere og går tidligere.`;
  return 'Skygge fra fjell og dalsider inntil 20 km unna er med, fra Kartverkets høydedata (ca. 30 m celler nær, 140 m lenger ut), så tidene er gode til noen minutter. Skog og snøskavler er ikke med.';
}
