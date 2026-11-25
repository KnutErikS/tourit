import { DIRS } from '../config';
import {
  PHASE_NAME, cloudPlace, phaseOf, precipUntil, skyText, spread, summarize, summarizeAir,
  type AirSummary, type CloudPlace, type PointWeather, type WeatherStep, type WeatherSummary,
} from '../domain/weather';
import { state } from '../state';
import { $, esc, fmtTime, isoDate } from '../util';
import { angDiff, nearestSpot, runs, windClass, windRel, WIND_CLASS_NAME, WIND_NAME, type WindClass } from '../domain/surf';
import { SURF_SPOTS } from '../domain/surfSpots';
import { daylightKey, sunDetails, sunKeys, sunNote, type SunKey } from './sun';

/** Daytime on a touring day, local time. */
const DAY_FROM_H = 6, DAY_TO_H = 18;
const HOUR = 3_600_000;

const dirName = (deg: number) => DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
const r1 = (x: number) => (x < 10 ? x.toFixed(1).replace('.', ',') : Math.round(x).toString());
const deg = (t: number) => `${Math.round(t)}°`.replace('-', '−');
const hh = (ms: number) => new Date(ms).toLocaleTimeString('nb-NO', { hour: '2-digit' });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const shortDate = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' });
/** Arrow pointing the way the wind blows (from `from` degrees). */
const arrow = (from: number) => `<i class="wx-arrow" style="transform:rotate(${Math.round(from)}deg)">↓</i>`;

/* ---------- icons ---------- */

const CLOUD = '<path d="M7 14h10a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.6 7.6 3.2 3.2 0 0 0 7 14z"/>';
const ICON_PARTS = {
  clear: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  night: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  partly: '<path d="M8 3v1.5M3.5 8H2M4.6 4.6l1 1M13.4 4.6l-1 1"/><path d="M5.3 10.2A3.5 3.5 0 0 1 11.7 6"/><path d="M9 19h8a3.5 3.5 0 0 0 .3-7 4.8 4.8 0 0 0-9.3 1.4A2.8 2.8 0 0 0 9 19z"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.6 11.6 3.2 3.2 0 0 0 7 18z"/>',
  fog: '<path d="M4 8h16M2 12h20M5 16h14M8 20h8"/>',
  snow: `${CLOUD}<path d="M8 17.5v.01M12 17v.01M16 17.5v.01M10 20.5v.01M14 20.5v.01"/>`,
  sleet: `${CLOUD}<path d="M8.5 17l-.8 2.5M14.5 17l-.8 2.5M11.5 18v.01M17 18.5v.01M10 21.5v.01"/>`,
  rain: `${CLOUD}<path d="M8.5 17l-1 3M12.5 17l-1 3M16.5 17l-1 3"/>`,
};
type IconKind = keyof typeof ICON_PARTS;
const icon = (k: IconKind, cls = 'wx-ic') =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON_PARTS[k]}</svg>`;

/** Icon for a period: precipitation wins, then fog, then cloud cover. */
function iconKind(o: { mm: number; snowFrac: number; cloud: number; fog?: number; night?: boolean }): IconKind {
  if (o.mm >= 0.1) return phaseOf(o.snowFrac);
  if (o.fog != null && o.fog >= 50) return 'fog';
  if (o.cloud >= 70) return 'cloud';
  if (o.cloud >= 15) return 'partly';
  return o.night ? 'night' : 'clear';
}

/* ---------- the time window ---------- */

/** Which time window to show for the selected date, or a reason there is none. */
function windowFor(w: PointWeather): { from: number; to: number; label: string } | string {
  const now = Date.now();
  const day = new Date(state.date + 'T00:00:00');
  const dayFrom = day.getTime() + DAY_FROM_H * HOUR, dayTo = day.getTime() + DAY_TO_H * HOUR;
  const last = w.steps.length ? w.steps[w.steps.length - 1].time : 0;
  if (state.date < isoDate(new Date())) return 'Værvarselet gjelder bare fram i tid. Velg i dag eller en senere dag for å se været.';
  if (dayFrom > last) return 'Værvarselet rekker ikke så langt fram.';
  if (dayTo <= now) return { from: now, to: now + 12 * HOUR, label: 'neste 12 timer' };
  return { from: Math.max(dayFrom, now), to: dayTo, label: `${now > dayFrom ? 'resten av dagen' : 'dagtid'} ${DAY_FROM_H}–${DAY_TO_H}` };
}

/* ---------- text ---------- */

/** Heights rounded to 100 m: the model can't place cloud more precisely than that. */
const m100 = (h: number) => Math.max(0, Math.round(h / 100) * 100);
const span = (r: { min: number; max: number }) =>
  m100(r.max) - m100(r.min) < 200 ? `ca. ${m100((r.min + r.max) / 2)}` : `${m100(r.min)}–${m100(r.max)}`;

const topPlace = (a: AirSummary) => (Object.entries(a.places) as [CloudPlace, number][]).sort((x, y) => y[1] - x[1])[0];

/** Icons for the key box. */
const KEY_ICON = {
  freeze: '<path d="M3 12h3M9 12h3M15 12h3M21 12h0"/><path d="M12 3v6M9.5 6.5L12 9l2.5-2.5"/>',
  cloud: '<path d="M4 9h16M2 13h20M5 17h14"/>',
  wind: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>',
  sun: ICON_PARTS.clear,
  nosun: `${ICON_PARTS.clear}<path d="M3 21L21 3"/>`,
};
type KeyIcon = keyof typeof KEY_ICON;
interface KeyLine { icon: KeyIcon; html: string }

/** Short weather lines on what matters for the tour, most important first. */
function keyLines(s: WeatherSummary, a: AirSummary | null): KeyLine[] {
  const out: KeyLine[] = [];
  if (a?.freezing) {
    const snow = a.snowLine ? (a.snowLine.max < 150 ? ' – snø helt ned' : ` – snø over ${span(a.snowLine)} moh.`) : '';
    out.push({ icon: 'freeze', html: `<b>Nullgrense ${span(a.freezing)} moh.</b>${snow}` });
  }
  const [place, n] = a ? topPlace(a) : (['clear', 0] as const);
  const most = a && n < a.n ? (n * 2 > a.n ? ' det meste av dagen' : ` ${n} av ${a.n} tider`) : ' hele perioden';
  if (a && place === 'in' && n > 0) out.push({ icon: 'cloud', html: `<b>I skyen</b>${most} – dårlig sikt` });
  else if (a && place === 'above' && n > 0) out.push({ icon: 'cloud', html: `<b>Over skyene</b>${most}` });
  if (s.fogMax != null && s.fogMax >= 20 && place !== 'in') out.push({ icon: 'cloud', html: `<b>Tåke</b> opptil ${Math.round(s.fogMax)} %` });
  if (s.gustMax != null && s.gustMax >= 15) out.push({ icon: 'wind', html: `<b>Vindkast ${Math.round(s.gustMax)} m/s</b> fra ${dirName(s.windFrom)}` });
  return out;
}

function keyBox(lines: (KeyLine | SunKey)[]): string {
  if (!lines.length) return '';
  const li = lines.map((l) => `<li><svg class="wx-k-i wx-k-${l.icon}" viewBox="0 0 24 24" aria-hidden="true">${KEY_ICON[l.icon]}</svg><span>${l.html}</span></li>`);
  return `<ul class="wx-keys">${li.join('')}</ul>`;
}

/* ---------- parts ---------- */

/**
 * Cloud and fog for a stretch of time, worked out the same way for the summary and for each
 * 3-hour cell: average cloud, and fog only when at least half of the hours have it (≥ 50 %),
 * so one foggy hour doesn't call the whole period "tåke".
 */
function skyOver(steps: WeatherStep[], from: number, to: number): { cloud: number; fog?: number } | null {
  const inside = steps.filter((x) => x.time >= from && x.time < to);
  if (!inside.length) return null;
  const cloud = inside.reduce((a, x) => a + x.cloud, 0) / inside.length;
  const fogs = inside.map((x) => x.fog).filter((f): f is number => f != null);
  if (!fogs.length) return { cloud };
  const foggy = fogs.filter((f) => f >= 50).length * 2 >= fogs.length;
  return { cloud, fog: foggy ? Math.max(...fogs) : Math.min(49, Math.max(...fogs)) };
}

/** Big summary: icon, temperature, sky, wind and precipitation. */
function hero(s: WeatherSummary, sky0: { cloud: number; fog?: number }, night: boolean): string {
  const wet = s.precip >= 0.1;
  const frac = wet ? s.snowMm / s.precip : 1;
  const sky = skyText(sky0.cloud, sky0.fog);
  const what = wet ? `${cap(PHASE_NAME[phaseOf(frac)])}, ${sky}` : cap(sky);
  const temp = Math.round(s.tempMin) === Math.round(s.tempMax) ? deg(s.tempMin) : `${deg(s.tempMin)} til ${deg(s.tempMax)}`;
  const range = s.precipMax != null && s.precipMax > s.precip + 0.5 ? `–${r1(s.precipMax)}` : '';
  const pBig = wet ? `${r1(s.precip)}${range} mm` : 'Opphold';
  const pSub = wet
    ? (s.snowCm >= 0.5 ? `≈ ${Math.round(s.snowCm)} cm nysnø` : s.precipProb != null ? `${Math.round(s.precipProb)} % sjanse` : '')
    : (s.precipMax != null && s.precipMax >= 0.5 ? `opptil ${r1(s.precipMax)} mm` : '');
  const kind = iconKind({ mm: s.precip, snowFrac: frac, cloud: sky0.cloud, fog: sky0.fog, night });
  return `<div class="wx-hero">${icon(kind, 'wx-hero-i')}
    <div class="wx-hero-main"><p class="wx-temp">${temp}</p><p class="wx-what">${esc(what)}</p></div>
    <div class="wx-hero-side">
      <p><b>${arrow(s.windFrom)} ${Math.round(s.windMax)} m/s ${dirName(s.windFrom)}</b>${s.gustMax != null ? `<span>kast ${Math.round(s.gustMax)}</span>` : ''}</p>
      <p><b>${pBig}</b>${pSub ? `<span>${pSub}</span>` : ''}</p>
    </div></div>`;
}

/** 3-hourly strip: time, icon, temperature, wind and precipitation. */
function hours(w: PointWeather, from: number, to: number): string {
  const shown = spread(w.steps, from, to, 3);
  if (shown.length < 2) return '';
  const rows = shown.map((s, i) => {
    const next = shown[i + 1]?.time ?? Math.min(to, s.time + 3 * HOUR);
    return { s, p: precipUntil(w.steps, s.time, next), sky: skyOver(w.steps, s.time, next) ?? { cloud: s.cloud, fog: s.fog } };
  });
  const scale = Math.max(2, ...rows.map((r) => r.p.mm));
  const cells = rows.map(({ s, p, sky }) => {
    const kind = iconKind({ mm: p.mm, snowFrac: p.snowFrac, cloud: sky.cloud, fog: sky.fog, night: s.symbol?.endsWith('_night') });
    const h = p.mm >= 0.1 ? Math.max(2, Math.round((p.mm / scale) * 22)) : 0;
    return `<div class="wx-h"><span class="wx-h-t">${hh(s.time)}</span>${icon(kind)}<b>${deg(s.temp)}</b>`
      + `<span class="wx-h-w">${arrow(s.windFrom)}${Math.round(s.wind)}${s.gust != null ? `<small>(${Math.round(s.gust)})</small>` : ''}</span>`
      + `<span class="wx-h-p"><i style="height:${h}px"></i></span><span class="wx-h-mm">${p.mm >= 0.1 ? r1(p.mm) : '–'}</span></div>`;
  });
  return `<div class="wx-hours" style="grid-template-columns:repeat(${cells.length},minmax(0,1fr))" aria-label="Hver tredje time">${cells.join('')}</div>`;
}

/** Schematic mountain: [x, height as a share of the peak], left to right. The point sits on the left side. */
const MOUNTAIN: [number, number][] = [[0, 0], [0.13, 0.14], [0.26, 0.32], [0.37, 0.5], [0.47, 0.73], [0.57, 0.88], [0.66, 1],
  [0.75, 0.88], [0.85, 0.63], [0.95, 0.31], [1, 0.1], [1, 0]];
const PEAK_I = 6;

/** "09–15": when the point is inside cloud, first to last such time (3-hour steps). */
function inCloudSpan(steps: WeatherStep[], from: number, to: number, alt: number): string {
  const hits = spread(steps, from, to, 3).filter((s) => s.cloudLayers && cloudPlace(s.cloudLayers, alt) === 'in');
  if (!hits.length) return '';
  const end = Math.min(to, hits[hits.length - 1].time + 3 * HOUR);
  return `${hh(hits[0].time)}–${hh(end)}`;
}

/**
 * The air over the point as a picture: a schematic mountain with the point on it, the
 * lowest cloud layer and the freezing level, all at their forecast heights, plus a sentence.
 */
function heightProfile(a: AirSummary, alt: number, cloudSpan: string): string {
  const W = 358, H = 250, x0 = 40, x1 = W - 2, y0 = 12, y1 = H - 14;
  const fl = a.freezing ? (a.freezing.min + a.freezing.max) / 2 : undefined;
  const want = Math.max(alt * 1.3, alt + 300, fl != null && fl < 4000 ? fl + 250 : 0,
    a.low && a.low.base < 4000 ? Math.min(a.low.top, a.low.base + 800) : 0);
  const top = Math.max(1500, Math.ceil(want / 500) * 500);
  const y = (h: number) => y1 - (Math.min(Math.max(h, 0), top) / top) * (y1 - y0);
  const X = (f: number) => x0 + f * (x1 - x0);
  const peak = Math.min(top * 0.9, Math.max(alt * 1.2, alt + 200));
  const pts = MOUNTAIN.map(([fx, fh]) => `${X(fx).toFixed(1)} ${y(fh * peak).toFixed(1)}`).join(' L');

  // Where the point's height meets the left slope.
  let px = X(MOUNTAIN[PEAK_I][0]);
  for (let i = 0; i < PEAK_I; i++) {
    const [ax, ah] = MOUNTAIN[i], [bx, bh] = MOUNTAIN[i + 1], f = alt / peak;
    if (f >= ah && f <= bh) { px = X(ax + ((f - ah) / (bh - ah)) * (bx - ax)); break; }
  }
  const py = y(alt);

  const step = top > 2500 ? 1000 : 500;
  const grid: string[] = [];
  for (let h = 0; h <= top; h += step) {
    grid.push(`<line class="hp-grid" x1="${x0}" x2="${x1}" y1="${y(h).toFixed(1)}" y2="${y(h).toFixed(1)}"/>`
      + `<text class="hp-ax" x="${x0 - 6}" y="${(y(h) + 3).toFixed(1)}" text-anchor="end">${h}</text>`);
  }

  let cloud = '';
  if (a.low && a.low.base < top) {
    const base = a.low.openBase ? 0 : a.low.base, ctop = a.low.openTop ? top : Math.min(a.low.top, top);
    const label = a.low.openBase ? `Skylag opp til ${m100(ctop)} moh.` : a.low.openTop || a.low.top > top
      ? `Skylag fra ${m100(base)} moh.` : `Skylag ${m100(base)}–${m100(ctop)} moh.`;
    const ty = y(ctop) + 15;
    cloud = `<rect class="hp-cloud" x="${x0}" y="${y(ctop).toFixed(1)}" width="${x1 - x0}" height="${(y(base) - y(ctop)).toFixed(1)}"/>`
      + `<text class="hp-lab" x="${x1 - 6}" y="${ty.toFixed(1)}" text-anchor="end">${label}</text>`
      + (cloudSpan ? `<text class="hp-ax" x="${x1 - 6}" y="${(ty + 13).toFixed(1)}" text-anchor="end">i skyen ${cloudSpan}</text>` : '');
  }

  let freeze = '';
  if (fl != null && a.freezing) {
    const flTxt = m100(a.freezing.max) - m100(a.freezing.min) >= 200 ? `${m100(a.freezing.min)}–${m100(a.freezing.max)}` : `≈ ${m100(fl)}`;
    const snow = a.snowLine ? (a.snowLine.max < 150 ? 'snø helt ned' : `snø over ${span(a.snowLine)}`) : '';
    if (fl < top) {
      const fy = y(fl);
      freeze = `<line class="hp-fl" x1="${x0}" x2="${x1}" y1="${fy.toFixed(1)}" y2="${fy.toFixed(1)}"/>`
        + `<text class="hp-lab hp-fl-lab" x="${x1 - 6}" y="${(fy - 6).toFixed(1)}" text-anchor="end">Nullgrense ${flTxt}</text>`
        + (snow && fy + 16 < y1 ? `<text class="hp-ax" x="${x1 - 6}" y="${(fy + 14).toFixed(1)}" text-anchor="end">${snow}</text>` : '');
    } else {
      freeze = `<text class="hp-lab hp-fl-lab" x="${x0 + 6}" y="${(y0 + 14).toFixed(1)}">Nullgrense over ${top} moh.</text>`;
    }
  }

  // The point, with a tag to the side that has room.
  const tag = `${Math.round(alt)} m`, tw = 62, left = px - tw - 26 >= x0 + 4;
  const tx = left ? Math.max(x0 + 6, px - tw - 26) : px + 22;
  const me = `<line class="hp-tagline" x1="${left ? tx + tw : tx}" x2="${px}" y1="${py.toFixed(1)}" y2="${py.toFixed(1)}"/>`
    + `<rect class="hp-tag" x="${tx.toFixed(1)}" y="${(py - 11).toFixed(1)}" width="${tw}" height="22" rx="4"/>`
    + `<text class="hp-tag-t" x="${(tx + tw / 2).toFixed(1)}" y="${(py + 4).toFixed(1)}" text-anchor="middle">${tag}</text>`
    + `<circle class="hp-me" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="6"/>`;

  const [place, n] = topPlace(a);
  const most = n === a.n ? 'hele perioden' : n * 2 > a.n ? 'store deler av dagen' : `${n} av ${a.n} tider`;
  const cap = {
    in: `Punktet ligger <b>inne i skyen</b> ${most}. Regn ikke med god sikt.`,
    above: `Punktet ligger <b>over skyene</b> ${most}.`,
    below: 'Skyene ligger <b>over punktet</b>.',
    between: 'Punktet ligger <b>mellom skylag</b>.',
    clear: '<b>Ingen tette skylag</b> under ca. 5000 moh.',
  }[place];

  const aria = `Punktet på ${Math.round(alt)} moh.${a.low ? `, skylag ${m100(a.low.base)}–${m100(a.low.top)} moh.` : ''}${fl != null ? `, nullgrense rundt ${m100(fl)} moh.` : ''}`;
  return `<figure class="hp-fig"><svg class="hp" viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}">`
    + `${grid.join('')}<path class="hp-mtn" d="M${pts} Z"/>${cloud}${freeze}${me}</svg>`
    + `<figcaption class="hp-cap">${cap}</figcaption></figure>`;
}

/* ---------- wind for surfing ---------- */

/**
 * Surf: the wind hour by hour (direction, speed, gusts), and, when the point is
 * at a surf spot (within 5 km), whether each hour blows offshore or onshore
 * there, plus a key line with the clean and blown-out stretches of the day.
 */
function surfWind(w: PointWeather, from: number, to: number): { keys: KeyLine[]; card: string } {
  const p = state.picked!;
  const spot = nearestSpot(SURF_SPOTS, { lat: p.ll.lat, lng: p.ll.lng });
  const steps = spread(w.steps, from, to, 1);
  if (!steps.length) return { keys: [], card: '' };
  const classOf = (x: WeatherStep) => (spot ? windClass(windRel(x.wind, x.windFrom, spot.offshoreFrom)) : null);

  // Key lines: strength and direction, then when it is clean at the spot.
  const keys: KeyLine[] = [];
  const lo = Math.min(...steps.map((x) => x.wind)), hi = Math.max(...steps.map((x) => x.wind));
  const gusts = steps.map((x) => x.gust).filter((g): g is number => g != null);
  const first = steps[0].windFrom, last = steps[steps.length - 1].windFrom;
  const dir = angDiff(first, last) >= 45 ? `fra ${dirName(first)}, dreier til ${dirName(last)}` : `fra ${dirName(first)}`;
  const speed = Math.round(lo) === Math.round(hi) ? `${Math.round(hi)} m/s` : `${Math.round(lo)}–${Math.round(hi)} m/s`;
  keys.push({ icon: 'wind', html: `<b>Vind ${dir}, ${speed}</b>${gusts.length ? ` · kast opptil ${Math.round(Math.max(...gusts))}` : ''}` });
  if (spot) {
    // Steps are hourly for the first days, then 6-hourly: join across whichever gap there is.
    const gap = steps.length > 1 ? Math.max(...steps.slice(1).map((x, i) => x.time - steps[i].time)) : HOUR;
    const parts = runs(steps.map((x) => ({ time: x.time, v: classOf(x)! })), gap);
    const name = (c: WindClass) => (c === 'clean' ? 'Fralands' : cap(WIND_CLASS_NAME[c]));
    const html = parts.length === 1
      ? `<b>${name(parts[0].v)} hele perioden</b> på ${esc(spot.name)}`
      : parts.map((r) => `<b>${name(r.v).toLowerCase()}</b> ${hh(r.from)}${r.to > r.from ? `–${hh(r.to)}` : ''}`).join(' · ').replace(/^<b>./, (m) => m.toUpperCase()) + ` <span class="nw">(${esc(spot.name)})</span>`;
    keys.push({ icon: 'wind', html });
  }

  // Hour by hour: bar for the mean wind, lighter bar out to the gusts.
  const top = Math.max(10, ...steps.map((x) => x.gust ?? x.wind));
  const rows = steps.map((x) => {
    const c = classOf(x);
    const rel = spot ? windRel(x.wind, x.windFrom, spot.offshoreFrom) : null;
    const pct = (v: number) => Math.min(100, (v / top) * 100).toFixed(0);
    return `<div class="wnd-row"><span class="wnd-t">${hh(x.time)}</span>`
      + `<span class="wnd-d">${arrow(x.windFrom)}${dirName(x.windFrom)}</span>`
      + `<span class="wnd-bar"><i class="wnd-g" style="width:${pct(x.gust ?? x.wind)}%"></i><i class="wnd-w${c ? ` wnd-${c}` : ''}" style="width:${pct(x.wind)}%"></i></span>`
      + `<span class="wnd-v"><b>${Math.round(x.wind)}</b>${x.gust != null ? `<small>(${Math.round(x.gust)})</small>` : ''}</span>`
      + (rel && c ? `<span class="wnd-rel wnd-${c}">${WIND_NAME[rel]}</span>` : '')
      + '</div>';
  });
  const note = spot
    ? `m/s, vindkast i parentes. Fralands på ${esc(spot.name)} er vind fra ${dirName(spot.offshoreFrom)}.`
    : 'm/s, vindkast i parentes. Trykk på en surfespot (eller «Vær her» i Surf-fanen) for å se om vinden er fralands der.';
  const card = `<section class="wnd${spot ? ' wnd-spot' : ''}" aria-label="Vind time for time">
      <p class="kicker">Vind time for time${spot ? ` · ${esc(spot.name)}` : ''}</p>
      <div class="wnd-rows">${rows.join('')}</div>
      <p class="wx-src">${note}</p>
    </section>`;
  return { keys, card };
}

/* ---------- folding sections, kept open across redraws ---------- */

const openSections = new Set<string>();
let listening = false;

function section(key: string, title: string, body: string, aside = ''): string {
  if (!body) return '';
  return `<details class="wx-sec" data-sec="${key}"${openSections.has(key) ? ' open' : ''}>`
    + `<summary><span>${title}</span>${aside ? `<span class="wx-sec-aside">${aside}</span>` : ''}</summary><div>${body}</div></details>`;
}

/* ---------- the tab ---------- */

function weatherSources(w: PointWeather, savedAt: number | null): string {
  const yr = `https://www.yr.no/nb/v%C3%A6rvarsel/daglig-tabell/${w.lat.toFixed(3)},${w.lon.toFixed(3)}`;
  return `${savedAt !== null ? `Uten nett · lagret ${esc(fmtTime(new Date(savedAt).toISOString()))}. ` : ''}`
    + `Varsel fra <a href="${yr}" target="_blank" rel="noopener">MET Norway / yr</a> (CC BY 4.0), oppdatert ${esc(fmtTime(new Date(w.updated).toISOString()))}`
    + `${w.altitude != null ? `, temperatur for ${w.altitude} moh.` : ''}.`
    + `${w.profileSource ? ` Skyhøyder og nullgrense fra <a href="https://open-meteo.com/" target="_blank" rel="noopener">${esc(w.profileSource)}</a> (CC BY 4.0), ca. 7 døgn fram.` : ''}`
    + ' Regn/snø, nysnø og skylag er beregnet her.';
}

interface WeatherParts {
  /** Message or the big summary. */
  top: string;
  keys: KeyLine[];
  hours: string;
  /** Surf only: key lines and the hour-by-hour wind card. */
  windKeys: KeyLine[];
  wind: string;
  clouds: string;
  sources: string;
  /** "dagtid 6–18" */
  when: string;
}

/** The weather part: a message, or summary, key lines, hours and the cloud section. */
function weatherParts(): WeatherParts {
  const p = state.picked!;
  const msg = (t: string, sources = ''): WeatherParts => ({ top: `<p class="rsub">${t}</p>`, keys: [], hours: '', windKeys: [], wind: '', clouds: '', sources, when: '' });
  if (p.weather === undefined) return msg('Henter værvarsel…');
  if (p.weather === null) return msg(`Fikk ikke hentet værvarsel (${esc(p.weatherErr ?? 'nettverksfeil')}).`);

  const { data: w, savedAt } = p.weather;
  const sources = weatherSources(w, savedAt);
  const win = windowFor(w);
  if (typeof win === 'string') return msg(win, sources);
  const s = summarize(w.steps, win.from, win.to);
  if (!s) return msg('Ingen varseldata for perioden.', sources);

  const alt = w.altitude ?? p.terrain?.elev;
  const a = alt != null ? summarizeAir(w.steps, win.from, win.to, alt) : null;
  const inWin = w.steps.filter((x) => x.time >= win.from && x.time < win.to && x.symbol);
  const night = inWin.length > 0 && inWin.filter((x) => x.symbol!.endsWith('_night')).length * 2 > inWin.length;

  const skyAll = skyOver(w.steps, win.from, win.to) ?? { cloud: s.cloudAvg, fog: s.fogMax };
  // Only the picture: where the cloud and the freezing level are, relative to the point.
  const clouds = a && alt != null ? heightProfile(a, alt, inCloudSpan(w.steps, win.from, win.to, alt)) : '';
  const sw = state.sport === 'surf' ? surfWind(w, win.from, win.to) : { keys: [], card: '' };
  return {
    top: `${hero(s, skyAll, night)}${s.partial ? '<p class="wx-when">Varselet slutter før perioden er over.</p>' : ''}`,
    keys: keyLines(s, a),
    hours: hours(w, win.from, win.to),
    windKeys: sw.keys,
    wind: sw.card,
    clouds, sources, when: win.label,
  };
}

/** "1180 moh. · 34° · NØ" and "tirs. 24. nov. · dagtid 6–18". */
function headLine(when: string): string {
  const p = state.picked!, t = p.terrain;
  // Surf: name the spot when the point is at one.
  const spot = state.sport === 'surf' ? nearestSpot(SURF_SPOTS, { lat: p.ll.lat, lng: p.ll.lng }) : null;
  const where = spot ? `${esc(spot.name)} · ${esc(spot.area)}`
    : t === undefined ? 'henter terreng…'
    : !t ? `${p.ll.lat.toFixed(4)}° N, ${p.ll.lng.toFixed(4)}° Ø`
    : `${Math.round(t.elev)} moh. · ${t.slope.toFixed(0)}° · ${DIRS[t.sector]}`;
  return `<div class="wx-headline"><span class="wx-where">${where}</span><span>${esc(shortDate(state.date))}${when ? ` · ${esc(when)}` : ''}</span></div>`;
}

/** The "Vær" tab: the picked point, the weather summary, sun over the terrain, and folding details. */
export function renderWeather(): void {
  const el = $('weather');
  if (!listening) {
    listening = true;
    // 'toggle' doesn't bubble: listen while it passes down.
    el.addEventListener('toggle', (e) => {
      const d = e.target as HTMLDetailsElement;
      const key = d.dataset?.sec;
      if (!key) return;
      if (d.open) openSections.add(key); else openSections.delete(key);
    }, true);
  }
  if (!state.picked) {
    el.innerHTML = '<p class="empty">Trykk på et sted i kartet for å se værvarselet der.</p>';
    return;
  }
  const wx = weatherParts();
  if (state.sport === 'surf') {
    // Surf: wind first; no cloud heights, freezing level or sun on slopes.
    const day = daylightKey();
    el.innerHTML = `<div class="wxv">
      ${headLine(wx.when)}
      ${wx.top}
      ${keyBox([...wx.windKeys, ...(day ? [day] : [])])}
      ${wx.wind}
      ${wx.hours}
      <div class="wx-secs">
        ${section('src', 'Kilder og metode', `<p class="wx-src">${wx.sources ? `${wx.sources} ` : ''}Sol og dagslys er beregnet på enheten (klarvær, uten skygge fra terrenget). Dagslys er borgerlig tussmørke.</p>`)}
      </div>
    </div>`;
    return;
  }
  const sources = `<p class="wx-src">${wx.sources ? `${wx.sources} ` : ''}${sunNote()}</p>`;
  // Weather first, then the sun lines, which work out even without a forecast.
  el.innerHTML = `<div class="wxv">
    ${headLine(wx.when)}
    ${wx.top}
    ${keyBox([...wx.keys, ...sunKeys()])}
    ${wx.hours}
    <div class="wx-secs">
      ${section('clouds', 'Skyer og høyder', wx.clouds)}
      ${section('sun', 'Sol på hellingene', sunDetails())}
      ${section('src', 'Kilder og metode', sources)}
    </div>
  </div>`;
}
