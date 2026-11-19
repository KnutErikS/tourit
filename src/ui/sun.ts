import { DIRS } from '../config';
import { daylight, sunDay, sunOnSlope, type Span } from '../domain/sun';
import { state } from '../state';
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
  const dl = daylight(day);
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
  const lightLine = !dl.light.length ? 'mørkt hele døgnet' : `${list(dl.light)}${dl.lightMin < day.pos.length - 1 ? ` (${dur(dl.lightMin)})` : ''}`;

  // The point's own slope (when the terrain is known).
  let here = '';
  const t = p.terrain;
  if (t) {
    const face = t.slope < 5 ? 'flatt' : `${Math.round(t.slope)}° ${DIRS[t.sector]}-vendt`;
    const s = sunOnSlope(day, t.slope, t.sector * 45);
    here = s.spans.length
      ? `${face}: sol ${list(s.spans)}, sterkest ${Math.round(s.peak)} W/m² kl. ${hhmm(s.peakAt!)}`
      : `${face}: ingen direkte sol i dag`;
  }

  // Each aspect at 30°: when the sun is on it, and how strong at best.
  const rows = DIRS.map((d, k) => ({ d, k, s: sunOnSlope(day, TABLE_SLOPE, k * 45) }));
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
      <dt>Dagslys</dt><dd>${lightLine}</dd>
      ${here ? `<dt>Punktet</dt><dd>${here}</dd>` : ''}
    </dl>
    ${dl.polarNight ? '' : `<p class="kicker sun-sub">Sol på ${TABLE_SLOPE}° heng</p><div class="sun-tab">${table}</div>`}
    <p class="wx-src">Beregnet på enheten for klarvær. Skygge fra fjell og dalsider rundt er ikke med: med lav sol og i trange daler kommer sola senere og går tidligere. W/m² er sterkeste direkte sol på hellingen; varmen i snøen øker med den. Dagslys er borgerlig tussmørke (sola mindre enn 6° under horisonten).</p>
  </div>`;
}
