import * as L from 'leaflet';
import { regionAt } from '../domain/geo';
import { RUNOUT } from '../config';
import { map } from '../map';
import { parseGpx } from '../route/gpx';
import { GROUPS, type Group, type Munter } from '../domain/risk';
import { type RiskSample, type TerrainSample, scoreRoute, summarize, terrainAlong } from '../route/risk';
import { ZONES, type Zone, type ZoneSection, zoneSections } from '../route/runout';
import { type Draft, type SavedRoute, listRoutes, putRoute, readDraft, removeRoute, writeDraft } from '../route/store';
import { state } from '../state';
import { type ProfilePoint, type ProfileStats, TooManyTiles, cumulative, profileOf, statsOf } from '../terrain/elevation';
import type { LatLngTuple } from '../types';
import { $, esc, fmtDate } from '../util';
import { infoButton, setInfoExtra } from './toolInfo';

/**
 * "Tegn rute": draw a line with several points on the map and see its length,
 * climb/descent and an elevation profile (like Norgeskart friluftsliv's
 * measuring tool). Routes can be saved on the device and exported as GPX.
 *
 * While the page is open the map is in drawing mode: a tap adds a point, a
 * point can be dragged, tapping a point removes it and tapping the line adds
 * a point there. Closing the page keeps the route on the map (read-only).
 */

const ICON_ROUTE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/><path d="M7 18h7a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h7"/></svg>';
const LINE = '#c2185b';
/** SLABS / Munter colours: the strip under the profile and the border on the route line. */
const RISK_RED = '#b71c1c', RISK_ORANGE = '#ff9800';
/** Above this many points (typically an imported GPS track) the in-between handles are drawn smaller. */
const DENSE = 40;

const page = () => $('route');

let drawing = false;
let points: L.LatLng[] = [];
let undo: L.LatLng[][] = [];
/** Saved route being edited (null = new). */
let editId: string | null = null;
let profile: ProfilePoint[] = [];
let stats: ProfileStats | null = null;
let loading = false;
/** Why there is no elevation, when it's not just "no data here". */
let elevErr = '';
let job = { cancelled: false };
let timer = 0;
let confirmDelete: string | null = null;
let badge: HTMLElement | null = null;
/** Stretches in steep terrain or runout (NVE's Bratthet med utløp); null while unknown. */
let runout: ZoneSection[] | null = null;
let runoutErr = '';
let runoutAbort: AbortController | null = null;
/** The terrain along the route for SLABS and Munter (route/risk.ts); null while unknown. */
let terrain: (TerrainSample | null)[] | null = null;
let riskErr = '';
let riskAbort: AbortController | null = null;

/** Munter's 3rd class: your group, remembered on this device. */
const GROUP_KEY = 'tourit.group';
function readGroup(): Group {
  try {
    const g = localStorage.getItem(GROUP_KEY);
    if (g && g in GROUPS) return g as Group;
  } catch {
    /* ignore */
  }
  return 'small';
}
let munterGroup: Group = readGroup();

/* ---------- map layers ---------- */

map.createPane('route').style.zIndex = '450';
const group = L.layerGroup().addTo(map);
/**
 * SLABS and Munter as a semi-transparent border around the route line, under
 * the white halo: orange where SLABS is elevated, red where SLABS is high or
 * Munter's residual risk is not acceptable (as in the strip under the profile).
 */
const riskGlow = {
  elevated: L.polyline([], { pane: 'route', color: RISK_ORANGE, weight: 17, opacity: 0.45, lineCap: 'butt', interactive: false }).addTo(group),
  high: L.polyline([], { pane: 'route', color: RISK_RED, weight: 17, opacity: 0.45, lineCap: 'butt', interactive: false }).addTo(group),
};
const halo = L.polyline([], { pane: 'route', color: '#fff', weight: 7, opacity: 0.85, interactive: false }).addTo(group);
/**
 * The route line's colour in avalanche terrain: red on steep ground (30° and
 * up), then NVE's three blues for short, medium and long runout (darker = more
 * avalanches reach it), the same as on the steepness map with runout. Blue
 * keeps runout apart from SLABS and Munter, which use orange and red.
 * Elsewhere the line keeps its own colour (LINE).
 */
const rgb = (c: readonly number[]) => `rgb(${c.join(',')})`;
const ZONE_STYLE: Record<Zone, { color: string; label: string; help: string }> = {
  steep: { color: '#b71c1c', label: 'Bratt (30°+)', help: 'der skred kan løsne' },
  // Runout in NVE's own blues (as on the map layer), so they don't mix with SLABS/Munter's orange and red.
  short: { color: rgb(RUNOUT.short.rgb), label: 'Kort utløp', help: 'halvparten av skredene når hit' },
  medium: { color: rgb(RUNOUT.medium.rgb), label: 'Middels utløp', help: 'ett av fire skred når hit' },
  long: { color: rgb(RUNOUT.long.rgb), label: 'Langt utløp', help: 'ett av tjue skred når hit' },
};
const line = L.polyline([], { pane: 'route', color: LINE, weight: 4, bubblingMouseEvents: false }).addTo(group);
// The zones colour the route line itself: drawn on top of it, not clickable, so taps still reach the line.
const zoneLines = Object.fromEntries(
  ZONES.map((z) => [z, L.polyline([], { pane: 'route', color: ZONE_STYLE[z].color, weight: 5, opacity: 1, lineCap: 'butt', interactive: false }).addTo(group)]),
) as Record<Zone, L.Polyline>;
const drawZones = (s: ZoneSection[]) => ZONES.forEach((z) => zoneLines[z].setLatLngs(s.filter((x) => x.zone === z).map((x) => x.lls)));
const vertices = L.layerGroup().addTo(group);
const cursor = L.circleMarker([0, 0], { pane: 'route', radius: 6, color: '#fff', weight: 2, fillColor: LINE, fillOpacity: 1, interactive: false });

export const isDrawing = () => drawing;

function vertexIcon(i: number): L.DivIcon {
  const cls = i === 0 ? ' start' : i === points.length - 1 ? ' end' : points.length > DENSE ? ' small' : '';
  const n = cls === ' small' ? 10 : 16;
  return L.divIcon({ className: '', html: `<div class="rt-v${cls}"></div>`, iconSize: [n, n], iconAnchor: [n / 2, n / 2] });
}

function drawLine(): void {
  halo.setLatLngs(points);
  line.setLatLngs(points);
}

function drawVertices(): void {
  vertices.clearLayers();
  if (!drawing) {
    // Read-only: just mark the start and the end.
    if (points.length) L.marker(points[0], { icon: vertexIcon(0), interactive: false, keyboard: false }).addTo(vertices);
    if (points.length > 1) L.marker(points[points.length - 1], { icon: vertexIcon(points.length - 1), interactive: false, keyboard: false }).addTo(vertices);
    return;
  }
  points.forEach((ll, i) => {
    const m = L.marker(ll, { icon: vertexIcon(i), draggable: true, keyboard: false, title: 'Dra for å flytte, trykk for å fjerne' });
    let before: L.LatLng[] = [];
    m.on('dragstart', () => (before = points.slice()));
    m.on('drag', () => {
      points[i] = m.getLatLng();
      drawLine();
    });
    m.on('dragend', () => {
      undo.push(before);
      changed();
    });
    m.on('click', () => edit(() => points.splice(i, 1)));
    m.addTo(vertices);
  });
}

/** Apply an edit, remembering the previous points for "Angre". */
function edit(fn: () => void): void {
  undo.push(points.slice());
  if (undo.length > 100) undo.shift();
  fn();
  changed();
}

function changed(): void {
  showMsg('');
  drawLine();
  drawVertices();
  saveDraft();
  scheduleProfile();
  render();
}

function onMapClick(e: L.LeafletMouseEvent): void {
  if (!drawing) return;
  edit(() => points.push(e.latlng));
}

/** Tap on the line: insert a point in the nearest segment. */
function onLineClick(e: L.LeafletMouseEvent): void {
  if (!drawing || points.length < 2) return;
  const p = map.latLngToLayerPoint(e.latlng);
  let best = 1, bestD = Infinity;
  for (let i = 1; i < points.length; i++) {
    const d = L.LineUtil.pointToSegmentDistance(p, map.latLngToLayerPoint(points[i - 1]), map.latLngToLayerPoint(points[i]));
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  edit(() => points.splice(best, 0, e.latlng));
}

/* ---------- elevation ---------- */

function scheduleProfile(): void {
  job.cancelled = true;
  clearTimeout(timer);
  profile = [];
  stats = null;
  elevErr = '';
  loading = points.length > 1;
  runoutAbort?.abort();
  runout = null;
  runoutErr = '';
  drawZones([]);
  riskAbort?.abort();
  terrain = null;
  drawRiskGlow();
  riskErr = '';
  if (!loading) return;
  timer = window.setTimeout(async () => {
    const mine = (job = { cancelled: false });
    const pts = points.slice();
    void loadRunout(pts);
    void loadRisk(pts);
    try {
      const p = await profileOf(pts, mine, (done, total) => {
        const el = document.querySelector('.rt-prof-wait');
        if (el && !mine.cancelled && total > 1) el.textContent = `henter høydedata… ${Math.round((done / total) * 100)} %`;
      });
      if (mine.cancelled) return;
      profile = p;
      stats = p.some((s) => s.z !== null) ? statsOf(p) : null;
    } catch (e) {
      if (mine.cancelled) return;
      profile = [];
      stats = null;
      elevErr = e instanceof TooManyTiles ? e.message : '';
    }
    loading = false;
    refreshSavedStats();
    render();
  }, 300);
}

/** Read the route's zones off NVE's steepness-with-runout tiles and mark them. */
async function loadRunout(pts: L.LatLng[]): Promise<void> {
  const ctl = (runoutAbort = new AbortController());
  try {
    const s = await zoneSections(pts, ctl.signal);
    if (ctl.signal.aborted) return;
    runout = s;
    drawZones(s);
  } catch (e) {
    if (ctl.signal.aborted) return;
    runout = null;
    runoutErr = navigator.onLine ? (e as Error)?.message || 'nettverksfeil' : 'uten nett';
  }
  render();
}

/** The terrain along the route for SLABS and Munter; scored when drawn (cheap). */
async function loadRisk(pts: L.LatLng[]): Promise<void> {
  const ctl = (riskAbort = new AbortController());
  try {
    const t = await terrainAlong(pts, ctl.signal, (share) => {
      const el = document.getElementById('rt-risk-prog');
      if (el && !ctl.signal.aborted) el.textContent = `Regner ut SLABS og Munter… ${Math.round(share * 100)} %`;
    });
    if (ctl.signal.aborted) return;
    terrain = t;
  } catch (e) {
    if (ctl.signal.aborted) return;
    riskErr = (e as Error)?.message || 'feil';
  }
  render();
}

/** Scores for the terrain, the day's warnings and the group; kept until one of them changes. */
let scored: { key: string; terrain: (TerrainSample | null)[]; samples: RiskSample[] } | null = null;
function currentRisk(): RiskSample[] {
  if (!terrain) return [];
  const key = `${state.date}|${munterGroup}|${state.regions.map((r) => r.warn?.level ?? '-').join('')}`;
  if (scored?.terrain !== terrain || scored.key !== key) scored = { key, terrain, samples: scoreRoute(terrain, munterGroup) };
  return scored.samples;
}

/** The day's warnings changed (new date, or they loaded): score the route again. */
/** Gaps between scored spots longer than this (no terrain data) break the border, metres. */
const GLOW_GAP_M = 100;

/** Draw the SLABS/Munter border along the route from the current scores (or clear it). */
function drawRiskGlow(): void {
  const parts: Record<'elevated' | 'high', L.LatLng[][]> = { elevated: [], high: [] };
  if (terrain && points.length > 1) {
    const r = currentRisk();
    let cur: { cls: 'elevated' | 'high'; lls: L.LatLng[] } | null = null;
    r.forEach((a, i) => {
      const b = r[i + 1];
      const cls = a.slabs?.cls === 'high' || (a.munter && !a.munter.ok) ? 'high' : a.slabs?.cls === 'elevated' ? 'elevated' : null;
      // Each spot stands for the stretch to the next one (as in the summary).
      if (!cls || !b || b.d - a.d > GLOW_GAP_M) {
        cur = null;
        return;
      }
      if (cur?.cls === cls) cur.lls.push(b.ll);
      else {
        cur = { cls, lls: [a.ll, b.ll] };
        parts[cls].push(cur.lls);
      }
    });
  }
  riskGlow.elevated.setLatLngs(parts.elevated);
  riskGlow.high.setLatLngs(parts.high);
}

export function refreshRouteRisk(): void {
  if (terrain) render();
}

/* ---------- formatting ---------- */

const fmtLen = (m: number) =>
  m >= 10_000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : m >= 1000 ? `${(m / 1000).toFixed(2).replace('.', ',')} km` : `${Math.round(m)} m`;
const fmtM = (m: number | null | undefined) => (m === null || m === undefined ? '–' : `${Math.round(m).toLocaleString('nb-NO')} m`);
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
const length = () => cumulative(points).at(-1) ?? 0;

/* ---------- rendering ---------- */

const PW = 320, PH = 110, PAD = { l: 34, r: 6, t: 8, b: 18 };

function profileSVG(): string {
  const valid = profile.filter((p) => p.z !== null) as (ProfilePoint & { z: number })[];
  if (valid.length < 2 || !stats || stats.min === null || stats.max === null) return '';
  const total = profile[profile.length - 1].d || 1;
  // Round the axis to whole 50 m steps, with at least 50 m of range.
  let lo = Math.floor(stats.min / 50) * 50, hi = Math.ceil(stats.max / 50) * 50;
  if (hi - lo < 50) hi = lo + 50;
  const x = (d: number) => PAD.l + (d / total) * (PW - PAD.l - PAD.r);
  const y = (z: number) => PH - PAD.b - ((z - lo) / (hi - lo)) * (PH - PAD.t - PAD.b);
  // Split at gaps (no data), so the area isn't drawn across the sea.
  let area = '', path = '', run: (ProfilePoint & { z: number })[] = [];
  const flush = () => {
    if (run.length > 1) {
      const pts = run.map((p) => `${x(p.d).toFixed(1)},${y(p.z).toFixed(1)}`);
      path += `M${pts.join('L')}`;
      area += `M${x(run[0].d).toFixed(1)},${PH - PAD.b}L${pts.join('L')}L${x(run[run.length - 1].d).toFixed(1)},${PH - PAD.b}Z`;
    }
    run = [];
  };
  for (const p of profile) p.z === null ? flush() : run.push(p as ProfilePoint & { z: number });
  flush();
  // Stretches in an aktsomhetsområde, as amber bands behind the profile (at least 2 px wide, so short ones show).
  const bands = (runout ?? [])
    .map((s) => {
      const x0 = x(s.from), w = Math.max(2, x(s.to) - x0);
      return `<rect class="ro" fill="${ZONE_STYLE[s.zone].color}" x="${x0.toFixed(1)}" y="${PAD.t}" width="${w.toFixed(1)}" height="${PH - PAD.t - PAD.b}"/>`;
    })
    .join('');
  const mid = (lo + hi) / 2;
  const grid = [lo, mid, hi]
    .map((v) => `<line x1="${PAD.l}" x2="${PW - PAD.r}" y1="${y(v)}" y2="${y(v)}" class="g"/><text x="${PAD.l - 4}" y="${y(v) + 3.5}" text-anchor="end">${Math.round(v)}</text>`)
    .join('');
  return `<svg class="rt-prof" id="rt-prof" viewBox="0 0 ${PW} ${PH}" role="img" aria-label="Høydeprofil fra ${Math.round(stats.min)} til ${Math.round(stats.max)} moh.">
    ${bands}${grid}
    <path d="${area}" class="a"/><path d="${path}" class="l"/>
    <text x="${PAD.l}" y="${PH - 4}">0</text><text x="${PW - PAD.r}" y="${PH - 4}" text-anchor="end">${esc(fmtLen(total))}</text>
    <line id="rt-cur" class="cur" y1="${PAD.t}" y2="${PH - PAD.b}" x1="-10" x2="-10"/>
    <text id="rt-curtxt" class="curtxt" y="${PAD.t + 9}" x="-100"></text>
  </svg>`;
}

function statsHTML(): string {
  if (points.length < 2) return '';
  // Same height as the profile while loading, so the buttons below don't jump.
  const elev = loading
    ? '<div class="rt-prof rt-prof-wait">henter høydedata…</div>'
    : stats
      ? ''
      : `<span class="rt-wait">${esc(elevErr || 'ingen høydedata her')}</span>`;
  const cell = (label: string, value: string) => `<div><span>${label}</span><b>${value}</b></div>`;
  return `<div class="rt-stats">
      ${cell('Lengde', fmtLen(length()))}
      ${cell('Stigning', stats ? '↑ ' + fmtM(stats.ascent) : '–')}
      ${cell('Nedstigning', stats ? '↓ ' + fmtM(stats.descent) : '–')}
      ${cell('Høyeste', stats ? fmtM(stats.max) : '–')}
      ${cell('Laveste', stats ? fmtM(stats.min) : '–')}
    </div>${runoutHTML()}${riskHTML()}${elev}${loading ? '' : profileSVG() + riskStrip()}`;
}

function runoutHTML(): string {
  if (runoutErr) return `<p class="rt-runout">Fikk ikke sjekket ruta mot NVEs bratthets- og utløpskart (${esc(runoutErr)}).</p>`;
  if (!runout) return '<p class="rt-runout">Sjekker ruta mot NVEs bratthets- og utløpskart…</p>';
  if (!runout.length) return '<p class="rt-runout">Ruta går ikke i bratt terreng eller i utløpsområder for snøskred etter NVEs kart.</p>';
  const len: Record<Zone, number> = { steep: 0, short: 0, medium: 0, long: 0 };
  // A stretch that is a single test point still counts as one step.
  for (const s of runout) len[s.zone] += Math.max(10, s.to - s.from);
  const rows = ZONES.filter((z) => len[z] > 0)
    .map((z) => `<li><i style="background:${ZONE_STYLE[z].color}" aria-hidden="true"></i><span>${esc(ZONE_STYLE[z].label)}</span><b>${esc(fmtLen(len[z]))}</b><small>${esc(ZONE_STYLE[z].help)}</small></li>`)
    .join('');
  return `<div class="rt-runout hit"><ul class="rt-zones">${rows}</ul><p>Utløp regnes fra bratte heng over ruta, også der du selv går på flatt terreng. Noen skred går lenger enn «langt utløp».</p></div>`;
}

const num = (x: number, d = 1) => x.toFixed(d).replace('.', ',');

/** 16, 0,67: whole numbers as they are, others with two decimals. */
const fig = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2).replace('.', ','));
const frac = (top: string, bottom: string) => `<span class="frac"><span>${top}</span><span>${bottom}</span></span>`;

/** Munter as a fraction: 16 / (2×2×2) = 16 / 8 = 2, with what each number stands for. */
function munterCalc(m: Munter, level: number): string {
  const prod = m.rf1 * m.rf2 * m.rf3;
  const eq =
    `<span class="mcalc${m.ok ? '' : ' bad'}" aria-label="${esc(`${m.dp} delt på ${m.rf1} ganger ${m.rf2} ganger ${m.rf3} er ${fig(m.rr)}`)}">` +
    `${frac(String(m.dp), `(${m.rf1}×${m.rf2}×${m.rf3})`)}<span>=</span>${frac(String(m.dp), String(prod))}<span>=</span><b>${fig(m.rr)}</b></span>`;
  const verdict = m.rule ?? (m.ok ? 'akseptabel (1 eller lavere)' : 'ikke akseptabel (over 1)');
  return `${eq}<small>${m.dp} = faregrad ${level}; ${m.rf1} bratthet × ${m.rf2} himmelretning × ${m.rf3} gruppe. ${esc(verdict)}</small>`;
}

/** The Munter line for one spot (in the route risk ⓘ dialog). */
function munterLine(a: RiskSample | undefined, label: string): string {
  if (!a) return '';
  if (!a.munter) return `<span class="mhead">${esc(label)}</span><small>Ingen snøskredvarsel her.</small>`;
  return `<span class="mhead">${esc(label)}</span>${munterCalc(a.munter, a.level)}`;
}

/** The spot with the highest residual risk (the first, if several tie). */
function worstMunter(r: RiskSample[]): RiskSample | undefined {
  let worst: RiskSample | undefined;
  for (const a of r) if (a.munter && (!worst?.munter || a.munter.rr > worst.munter.rr)) worst = a;
  return worst;
}
const worstLabel = (a: RiskSample) => `Munter, høyest restrisiko (ved ${fmtLen(a.d)})`;

/** The ⓘ dialog for the route's risk box shows Munter worked out for this route's worst spot. */
setInfoExtra('routeRisk', () => {
  const worst = terrain && !riskErr ? worstMunter(currentRisk()) : undefined;
  if (!worst?.munter) return '';
  return `<p class="kicker">Utregning for ruta</p><div class="rt-mline">${munterLine(worst, worstLabel(worst))}</div>`;
});

function riskHTML(): string {
  const head = `<div class="thead"><b class="kicker">Skredrisiko langs ruta</b>${infoButton('routeRisk')}</div>`;
  const options = (Object.keys(GROUPS) as Group[])
    .map((g) => `<option value="${g}"${g === munterGroup ? ' selected' : ''}>${esc(GROUPS[g].label)}</option>`)
    .join('');
  const select = `<label class="rt-group"><span>Gruppe (Munter)</span><select id="rt-group">${options}</select></label>`;
  let body: string;
  if (riskErr) body = `<p>Fikk ikke regnet ut SLABS og Munter (${esc(riskErr)}).</p>`;
  else if (!terrain) body = '<p id="rt-risk-prog">Regner ut SLABS og Munter…</p>';
  else {
    const s = summarize(currentRisk());
    if (!s.levels.length) body = '<p>Ingen snøskredvarsel for dagen der ruta går.</p>';
    else {
      const li = (color: string, label: string, m: number, small: string) =>
        `<li><i style="background:${color}" aria-hidden="true"></i><span>${esc(label)}</span><b>${esc(fmtLen(m))}</b><small>${esc(small)}</small></li>`;
      const rows = [
        s.highM > 0 ? li(RISK_RED, 'SLABS høy', s.highM, 'over én faregrad over Stop or Go-grensen') : '',
        s.elevatedM > 0 ? li(RISK_ORANGE, 'SLABS forhøyet', s.elevatedM, 'rundt Stop or Go-grensen') : '',
        s.munterM > 0 ? li(RISK_RED, 'Munter ikke akseptabel', s.munterM, `restrisiko høyest ${num(s.maxRR)}`) : '',
      ].join('');
      const fine = [
        s.highM + s.elevatedM === 0 ? 'SLABS: lav risiko hele veien.' : '',
        s.munterM === 0 ? `Munter: akseptabel hele veien (restrisiko høyest ${num(s.maxRR)}).` : '',
      ].filter(Boolean);
      body =
        (rows ? `<ul class="rt-zones">${rows}</ul>` : '') +
        (fine.length ? `<p>${esc(fine.join(' '))}</p>` : '') +

        `<p class="rsub">Faregrad ${s.levels.join(' og ')} i varselet for ${esc(fmtDate(state.date))}. SLABS bygger på sveitsiske data og er bare veiledende her.</p>`;
    }
  }
  return `<div class="rt-risk">${head}${body}${select}</div>`;
}

/** Two rows under the profile, lined up with it: SLABS (orange/red) and Munter (red where not acceptable). */
function riskStrip(): string {
  if (!terrain || !stats || profile.length < 2) return '';
  const r = currentRisk();
  if (!r.some((x) => x.slabs)) return '';
  const total = profile[profile.length - 1].d || 1;
  const x = (d: number) => PAD.l + (Math.min(d, total) / total) * (PW - PAD.l - PAD.r);
  const rect = (a: RiskSample, b: RiskSample | undefined, y: number, color: string) =>
    `<rect x="${x(a.d).toFixed(1)}" y="${y}" width="${Math.max(1, x(b?.d ?? a.d) - x(a.d)).toFixed(1)}" height="7" fill="${color}"/>`;
  let slabs = '', mun = '';
  r.forEach((a, i) => {
    const b = r[i + 1];
    if (a.slabs?.cls === 'high') slabs += rect(a, b, 2, RISK_RED);
    else if (a.slabs?.cls === 'elevated') slabs += rect(a, b, 2, RISK_ORANGE);
    if (a.munter && !a.munter.ok) mun += rect(a, b, 13, RISK_RED);
  });
  const w = PW - PAD.l - PAD.r;
  return `<svg class="rt-strip" viewBox="0 0 ${PW} 22" role="img" aria-label="SLABS og Munter langs ruta">
    <text x="${PAD.l - 4}" y="8.5" text-anchor="end">SLABS</text><rect class="bg" x="${PAD.l}" y="2" width="${w}" height="7"/>${slabs}
    <text x="${PAD.l - 4}" y="19.5" text-anchor="end">Munter</text><rect class="bg" x="${PAD.l}" y="13" width="${w}" height="7"/>${mun}
  </svg>`;
}

function routeHTML(r: SavedRoute): string {
  const climb = r.ascent !== null ? ` · ↑ ${fmtM(r.ascent)}` : '';
  const del = confirmDelete === r.id;
  return `<article class="off-area${r.id === editId ? ' rt-active' : ''}" data-id="${esc(r.id)}">
    <div class="off-title"><b>${esc(r.name)}</b>${r.id === editId ? '<span class="off-ok">Åpen</span>' : ''}</div>
    <div class="off-sub">${esc(fmtLen(Number(r.length) || 0))}${esc(climb)} · ${esc(fmtDay(r.createdAt))}</div>
    <div class="off-actions">
      <button class="btn" data-act="open">Vis i kartet</button>
      <button class="btn" data-act="gpx">GPX</button>
      <button class="btn${del ? ' danger' : ''}" data-act="delete">${del ? 'Bekreft sletting' : 'Slett'}</button>
    </div>
  </article>`;
}

function render(): void {
  drawRiskGlow(); // on the map, whether the route page is open or not
  const routes = listRoutes();
  if (badge) {
    badge.textContent = routes.length ? String(routes.length) : '';
    badge.hidden = !routes.length;
  }
  if (page().hidden) return;
  page().classList.toggle('has-route', points.length > 1);
  $('rt-help').textContent = points.length
    ? 'Trykk i kartet for å legge til punkter. Dra et punkt for å flytte det, trykk på et punkt for å fjerne det, eller trykk på linja for å legge inn et punkt.'
    : 'Trykk i kartet der turen starter, og videre for hvert punkt langs ruta.';
  $('rt-result').innerHTML = statsHTML();
  $('rt-save-row').hidden = points.length < 2;
  $<HTMLButtonElement>('rt-undo').disabled = !undo.length;
  $<HTMLButtonElement>('rt-clear').disabled = !points.length;
  $<HTMLButtonElement>('rt-gpx').disabled = points.length < 2;
  $('rt-save').textContent = editId ? 'Lagre endringer' : 'Lagre rute';
  $('rt-new').hidden = !editId && !points.length;
  $('rt-list').innerHTML = routes.length
    ? routes.map(routeHTML).join('')
    : '<p class="empty">Ingen lagrede ruter ennå. Tegn en rute og trykk «Lagre rute».</p>';
}

/* ---------- profile hover → position on the map ---------- */

function onProfileMove(e: PointerEvent): void {
  const svg = (e.target as Element).closest<SVGSVGElement>('#rt-prof');
  if (!svg || profile.length < 2) return;
  const r = svg.getBoundingClientRect();
  const sx = ((e.clientX - r.left) / r.width) * PW;
  const total = profile[profile.length - 1].d || 1;
  const d = Math.min(total, Math.max(0, ((sx - PAD.l) / (PW - PAD.l - PAD.r)) * total));
  let best = profile[0];
  for (const p of profile) if (Math.abs(p.d - d) < Math.abs(best.d - d)) best = p;
  const cx = PAD.l + (best.d / total) * (PW - PAD.l - PAD.r);
  const cur = svg.querySelector('#rt-cur')!, txt = svg.querySelector<SVGTextElement>('#rt-curtxt')!;
  cur.setAttribute('x1', String(cx));
  cur.setAttribute('x2', String(cx));
  txt.textContent = `${fmtLen(best.d)} · ${best.z === null ? '–' : Math.round(best.z) + ' moh.'}`;
  const right = cx > PW / 2;
  txt.setAttribute('x', String(right ? cx - 4 : cx + 4));
  txt.setAttribute('text-anchor', right ? 'end' : 'start');
  cursor.setLatLng(best.ll).addTo(map);
}

function onProfileLeave(): void {
  cursor.remove();
  const cur = document.getElementById('rt-cur');
  cur?.setAttribute('x1', '-10');
  cur?.setAttribute('x2', '-10');
  const txt = document.getElementById('rt-curtxt');
  if (txt) txt.textContent = '';
}

/* ---------- state ---------- */

function saveDraft(): void {
  const d: Draft = { points: points.map((p) => [p.lat, p.lng] as LatLngTuple), id: editId, name: $<HTMLInputElement>('rt-name').value };
  writeDraft(d);
}

function load(pts: LatLngTuple[], id: string | null, name: string): void {
  points = pts.map(([a, b]) => L.latLng(a, b));
  undo = [];
  editId = id;
  $<HTMLInputElement>('rt-name').value = name;
  changed();
}

function defaultName(): string {
  const r = points.length ? regionAt(state.regions, points[0]) : null;
  return r ? `Tur i ${r.name}` : `Rute ${listRoutes().length + 1}`;
}

function saveRoute(): void {
  if (points.length < 2) return;
  const nameEl = $<HTMLInputElement>('rt-name');
  const name = nameEl.value.trim() || defaultName();
  nameEl.value = name;
  const now = new Date().toISOString();
  const old = editId ? listRoutes().find((r) => r.id === editId) : undefined;
  const r: SavedRoute = {
    id: old?.id ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    createdAt: old?.createdAt ?? now,
    updatedAt: now,
    points: points.map((p) => [+p.lat.toFixed(6), +p.lng.toFixed(6)] as LatLngTuple),
    length: Math.round(length()),
    ascent: stats && !loading ? Math.round(stats.ascent) : null,
    descent: stats && !loading ? Math.round(stats.descent) : null,
  };
  try {
    putRoute(r);
  } catch {
    // localStorage full (or blocked): keep the route on the map and say why it wasn't saved.
    showMsg('Fikk ikke lagret ruta: lagringsplassen i nettleseren er full eller blokkert. Slett noen lagrede ruter, eller last ned ruta som GPX.', true);
    return;
  }
  editId = r.id;
  saveDraft();
  render();
  const btn = $('rt-save');
  btn.textContent = 'Lagret ✓';
  setTimeout(render, 1200);
}

/** Saved numbers can be filled in once the elevation for an opened route has loaded. */
function refreshSavedStats(): void {
  if (!editId || !stats || loading) return;
  const r = listRoutes().find((x) => x.id === editId);
  const same = r && r.points.length === points.length && r.points.every(([a, b], i) => Math.abs(a - points[i].lat) < 1e-6 && Math.abs(b - points[i].lng) < 1e-6);
  if (!r || !same || r.ascent !== null) return;
  try {
    putRoute({ ...r, ascent: Math.round(stats.ascent), descent: Math.round(stats.descent) });
  } catch {
    /* storage full: the list just keeps showing no climb */
  }
}

/* ---------- GPX ---------- */

function downloadGpx(name: string, pts: L.LatLng[], prof: ProfilePoint[]): void {
  const zAt = (ll: L.LatLng) => prof.find((p) => p.ll.equals(ll))?.z ?? null;
  const trk = pts
    .map((p) => {
      const z = zAt(p);
      return `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}">${z !== null ? `<ele>${z.toFixed(1)}</ele>` : ''}</trkpt>`;
    })
    .join('\n');
  const xmlName = esc(name).replace(/'/g, '&apos;');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Skredterreng" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${xmlName}</name><time>${new Date().toISOString()}</time></metadata>
  <trk>
    <name>${xmlName}</name>
    <trkseg>
${trk}
    </trkseg>
  </trk>
</gpx>
`;
  const url = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = (name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'rute') + '.gpx';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- GPX import ---------- */

function showMsg(text: string, err = false): void {
  const el = $('rt-msg');
  el.textContent = text;
  el.classList.toggle('err', err);
  el.hidden = !text;
}

/** Load a GPX file as a new, unsaved route (Angre brings back the previous one). */
async function importGpx(input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0];
  input.value = ''; // so picking the same file again fires 'change'
  if (!file) return;
  try {
    if (file.size > 20e6) throw new Error('Filen er for stor (over 20 MB).');
    const gpx = parseGpx(await file.text());
    const prev = points.slice();
    load(gpx.points, null, gpx.name || file.name.replace(/\.gpx$/i, ''));
    if (prev.length) undo = [prev];
    render();
    map.fitBounds(L.latLngBounds(gpx.points), { padding: [40, 40] });
    showMsg(`Importerte «${gpx.name || file.name}» med ${gpx.points.length} punkter. Trykk «Lagre rute» for å beholde den.`);
  } catch (e) {
    showMsg((e as Error)?.message || 'Kunne ikke lese GPX-filen.', true);
  }
}

/* ---------- open / close ---------- */

export function openRoute(): void {
  window.dispatchEvent(new CustomEvent('tourit:page', { detail: 'route' }));
  confirmDelete = null;
  page().hidden = false;
  drawing = true;
  map.getContainer().classList.add('drawing');
  drawVertices();
  render();
}

export function closeRoute(): void {
  if (page().hidden) return;
  page().hidden = true;
  drawing = false;
  map.getContainer().classList.remove('drawing');
  onProfileLeave();
  drawVertices();
}

async function onListClick(e: Event): Promise<void> {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
  const card = btn?.closest<HTMLElement>('.off-area');
  if (!btn || !card) return;
  const r = listRoutes().find((x) => x.id === card.dataset.id);
  if (!r) return;
  const act = btn.dataset.act;
  if (act !== 'delete') confirmDelete = null;
  switch (act) {
    case 'open':
      load(r.points, r.id, r.name);
      map.fitBounds(L.latLngBounds(r.points), { padding: [40, 40] });
      break;
    case 'gpx': {
      const pts = r.points.map(([a, b]) => L.latLng(a, b));
      void profileOf(pts).then((p) => downloadGpx(r.name, pts, p), () => downloadGpx(r.name, pts, []));
      break;
    }
    case 'delete':
      if (confirmDelete !== r.id) {
        confirmDelete = r.id;
        break;
      }
      confirmDelete = null;
      try {
        removeRoute(r.id);
      } catch {
        showMsg('Fikk ikke slettet ruta: lagringen i nettleseren er blokkert.', true);
        break;
      }
      if (editId === r.id) {
        editId = null;
        saveDraft();
      }
      break;
  }
  render();
}

/* ---------- setup ---------- */

const RouteControl = L.Control.extend({
  onAdd(): HTMLElement {
    const bar = L.DomUtil.create('div', 'leaflet-bar offctl rtctl');
    bar.innerHTML = `<a href="#" role="button" id="ctl-route" title="Tegn rute" aria-label="Tegn rute">${ICON_ROUTE}<span class="offbadge" hidden></span></a>`;
    L.DomEvent.disableClickPropagation(bar);
    const btn = bar.querySelector<HTMLElement>('#ctl-route')!;
    badge = btn.querySelector('.offbadge');
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (page().hidden) openRoute();
      else closeRoute();
    });
    return bar;
  },
});

export function initRoute(): void {
  page().innerHTML = `
    <header class="off-head">
      <h2>Tegn rute</h2>
      <button class="btn" id="rt-close" aria-label="Lukk">Lukk</button>
    </header>
    <div class="off-body">
      <p class="desc" id="rt-help"></p>
      <div id="rt-result" class="rt-result"></div>
      <div class="off-actions">
        <button class="btn" id="rt-undo">Angre</button>
        <button class="btn" id="rt-clear">Tøm</button>
        <button class="btn" id="rt-gpx">Last ned GPX</button>
        <button class="btn" id="rt-new" hidden>Ny rute</button>
        <button class="btn" id="rt-import">Importer GPX</button>
        <input type="file" id="rt-file" accept=".gpx,application/gpx+xml" hidden>
      </div>
      <p class="rt-msg" id="rt-msg" role="status" hidden></p>
      <section class="off-new" id="rt-save-row" hidden>
        <label class="off-field"><span>Navn</span><input id="rt-name" type="text" maxlength="60" autocomplete="off" placeholder="Navn på ruta"></label>
        <div class="off-actions"><button class="btn primary" id="rt-save">Lagre rute</button></div>
      </section>
      <h3 class="rt-h">Lagrede ruter</h3>
      <div class="off-list" id="rt-list"></div>
      <p class="foot">Høyder fra Kartverkets terrengmodell. Stigning regnes langs linja, så den blir mer nøyaktig jo tettere punktene følger terrenget.</p>
    </div>`;

  $('rt-close').addEventListener('click', closeRoute);
  $('rt-undo').addEventListener('click', () => {
    const prev = undo.pop();
    if (!prev) return;
    points = prev;
    changed();
  });
  $('rt-clear').addEventListener('click', () => edit(() => (points = [])));
  $('rt-new').addEventListener('click', () => {
    load([], null, '');
  });
  const nameInput = $<HTMLInputElement>('rt-name');
  const fileInput = $<HTMLInputElement>('rt-file');
  $('rt-gpx').addEventListener('click', () => downloadGpx(nameInput.value.trim() || defaultName(), points, profile));
  $('rt-import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => void importGpx(fileInput));
  $('rt-save').addEventListener('click', saveRoute);
  nameInput.addEventListener('input', saveDraft);
  nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && saveRoute());
  $('rt-list').addEventListener('click', (e) => void onListClick(e));
  const result = $('rt-result');
  result.addEventListener('pointermove', onProfileMove);
  result.addEventListener('pointerdown', onProfileMove);
  result.addEventListener('pointerleave', onProfileLeave);
  result.addEventListener('change', (e) => {
    const sel = (e.target as Element).closest<HTMLSelectElement>('#rt-group');
    if (!sel || !(sel.value in GROUPS)) return;
    munterGroup = sel.value as Group;
    try {
      localStorage.setItem(GROUP_KEY, munterGroup);
    } catch {
      /* remembered until the page reloads */
    }
    render();
  });

  map.on('click', onMapClick);
  line.on('click', onLineClick);
  window.addEventListener('tourit:page', (e) => (e as CustomEvent).detail !== 'route' && closeRoute());
  window.addEventListener('keydown', (e) => {
    if (!drawing || (e.target as HTMLElement).closest('input,select,textarea')) return;
    if (e.key === 'Escape') closeRoute();
    else if ((e.key === 'z' && (e.metaKey || e.ctrlKey)) || e.key === 'Backspace') $('rt-undo').click();
  });

  new RouteControl({ position: 'topright' }).addTo(map);

  // Bring back the route from the last visit (shown read-only until the tool is opened).
  const d = readDraft();
  if (d) load(d.points, d.id && listRoutes().some((r) => r.id === d.id) ? d.id : null, d.name);
  render();
}
