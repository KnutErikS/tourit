import type * as L from 'leaflet';
import { fetchPointWeather } from '../api/met';
import { DIRS } from '../config';
import type { ClueKey } from '../domain/alptruth';
import type { StopOrGoStatus } from '../domain/stopOrGo';
import type { PointWeather } from '../domain/weather';
import { state } from '../state';
import { terrainAt } from '../terrain/dem';
import type { Info } from '../domain/infos';
import { assessAlptruth, type AlptruthAssessment } from '../tools/alptruth';
import { assessInfos } from '../tools/infos';
import { assessStopOrGo, type StopOrGoAssessment } from '../tools/stopOrGo';
import { setTick } from '../tools/ticks';
import type { TerrainPoint } from '../types';
import { $, esc, fmtDate, isoDate } from '../util';
import { currentPosition, onPositionChange } from './locate';
import { pointLine } from './point';
import { infoButton } from './toolInfo';

/**
 * The "Verktøy" tab: Stop or Go and ALPTRUTh for one point. The tapped point
 * wins; without one, your position (while it is shown on the map). Tap the
 * pin again to go back to your position.
 *
 * Worked out again when the point, the day or the data change, but only
 * while the tab is open. While following your position, only when you have
 * moved FOLLOW_M or more, so a GPS fix every second doesn't recompute.
 */

const FOLLOW_M = 25;

interface Target {
  kind: 'pick' | 'position';
  ll: L.LatLng;
  terrain: TerrainPoint | null | undefined;
  weather: PointWeather | null;
  accuracy?: number;
}

let active = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let token = 0;
/** Separate from `token`: a tick must not cancel a recalculation already running. */
let clueToken = 0;
/** Where the position was last worked out, to skip small GPS moves. */
let lastPositionLL: L.LatLng | null = null;
/** The point the cards show now, for ticks. */
let shown: Target | null = null;
let shownAlp: AlptruthAssessment | null = null;

const terrainCache = new Map<string, Promise<TerrainPoint | null>>();
/** Terrain at your position: cached per ~10 m, since you stand still a lot. */
function positionTerrain(ll: L.LatLng): Promise<TerrainPoint | null> {
  const key = `${ll.lat.toFixed(4)},${ll.lng.toFixed(4)}`;
  let p = terrainCache.get(key);
  if (!p) {
    p = terrainAt(ll).catch(() => null);
    terrainCache.set(key, p);
    if (terrainCache.size > 50) terrainCache.delete(terrainCache.keys().next().value!);
  }
  return p;
}

/** The point to work on: the tapped point, else your position, else none. */
async function target(): Promise<Target | null> {
  const p = state.picked;
  if (p) return { kind: 'pick', ll: p.ll, terrain: p.terrain, weather: p.weather?.data ?? null };
  const pos = currentPosition();
  if (!pos) return null;
  const terrain = await positionTerrain(pos.ll);
  // MET only forecasts from now on: no use for a day that has been.
  const wantMet = state.date >= isoDate(new Date());
  const weather = wantMet ? await fetchPointWeather(pos.ll.lat, pos.ll.lng, terrain?.elev).then((r) => r.data).catch(() => null) : null;
  return { kind: 'position', ll: pos.ll, terrain, weather, accuracy: pos.accuracy };
}

/* ---------- rendering ---------- */

const STATUS: Record<StopOrGoStatus, string> = { go: 'Gå', caution: 'Varsomt', stop: 'Stopp', none: 'Ingen varsel' };

function positionLine(t: Target): string {
  const tr = t.terrain;
  const facts = tr ? `<b>${Math.round(tr.elev)} moh.</b><b>${tr.slope.toFixed(0)}°</b><b>${DIRS[tr.sector]}-vendt</b>` : '<span>ingen høydedata her</span>';
  return `<div class="pick"><span>Min posisjon</span>${t.accuracy ? `<b>± ${Math.round(t.accuracy)} m</b>` : ''}${facts}</div>`;
}

function head(t: Target, region: string | null): string {
  const where = t.kind === 'pick' ? pointLine({ chips: false }) : positionLine(t);
  const hint =
    t.kind === 'pick' && currentPosition()
      ? 'Viser valgt punkt. Trykk på nålen i kartet for å følge posisjonen din.'
      : t.kind === 'position'
        ? 'Følger posisjonen din. Trykk i kartet for å se et annet punkt.'
        : '';
  return `${where}<p class="rsub">${esc(region ?? 'Utenfor varslingsregionene')} · ${esc(fmtDate(state.date))}${hint ? ` · ${hint}` : ''}</p>`;
}

function stopOrGoCard(s: StopOrGoAssessment): string {
  const status = s.level >= 1 && s.steepness == null ? 'Mangler terrengdata' : STATUS[s.status];
  const where = s.area === 'track' ? 'der sporet går' : 'i hele henget';
  const limit =
    s.level < 1
      ? ''
      : s.limit == null
        ? `Ingen generell grense ved faregrad ${s.used}`
        : `Under ${s.limit}° ${where}${s.area === 'terrain' ? ', utenfor utløpssoner' : ''}`;
  const facts = [
    s.level >= 1 ? `Faregrad ${s.level} i varselet${s.used !== s.level ? `, ${s.used} brukt` : ''}` : '',
    s.steepness != null ? `Brattest ${Math.round(s.steepness)}° ${where}` : '',
  ].filter(Boolean);
  const reasons = [...s.reasons];
  if (s.signs.length) reasons.push(`Meldt i Regobs: ${s.signs.join(', ')}.`);
  return `<section class="tcard" aria-labelledby="sog-h">
    <div class="thead"><h3 class="kicker" id="sog-h">Stop or Go</h3>${infoButton('stopOrGo')}</div>
    <div class="sog-verdict"><span class="sog-pill sog-${s.status}">${esc(status)}</span>${limit ? `<span class="sog-limit">${esc(limit)}</span>` : ''}</div>
    ${facts.length ? `<p class="rsub">${facts.map(esc).join(' · ')}</p>` : ''}
    ${reasons.length ? `<ul class="treasons">${reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
  </section>`;
}

function alptruthCard(a: AlptruthAssessment): string {
  const rows = a.clues
    .map((c) => {
      const state_ = c.on ? 'on' : c.auto === null && c.mine === undefined ? 'unknown' : 'off';
      const why = c.why.length ? c.why.join(' · ') : `${c.hint}. Vurder selv.`;
      return `<li><button type="button" class="alp-clue alp-${state_}" role="switch" aria-checked="${c.on}" data-clue="${c.key}">
        <span class="alp-box" aria-hidden="true">${c.on ? '✓' : state_ === 'unknown' ? '?' : ''}</span>
        <span class="alp-key">${c.key}</span>
        <span class="alp-text"><b>${esc(c.name)}</b>${c.mine !== undefined ? '<span class="alp-mine">ditt kryss</span>' : ''}<small>${esc(why)}</small></span>
      </button></li>`;
    })
    .join('');
  return `<section class="tcard" aria-labelledby="alp-h">
    <div class="thead"><h3 class="kicker" id="alp-h">ALPTRUTh</h3>${infoButton('alptruth')}<span class="alp-count${a.red ? ' red' : ''}">${a.count} av 7</span></div>
    <ul class="alp-list">${rows}</ul>
    <p class="rsub">Trykk på et tegn for å krysse av for det du ser selv. Ditt kryss teller foran dataene; trykk igjen for å gå tilbake.</p>
  </section>`;
}

/** The infos that apply to the point today, red flags first; nothing when none do. */
function infoList(list: Info[]): string {
  if (!list.length) return '';
  const items = list.map((i) => `<li class="info-${i.level}">${esc(i.text)}</li>`).join('');
  return `<section class="infos" aria-label="Infoer for punktet"><ul>${items}</ul></section>`;
}

const EMPTY =
  '<p class="empty">Trykk på et sted i kartet, eller slå på Min posisjon <span aria-hidden="true">◎</span>. Da ser du Stop or Go og ALPTRUTh for punktet.</p>';
const FOOT = '<p class="foot">Verktøyene er hjelpemidler i planleggingen og erstatter ikke egen vurdering i felt.</p>';

async function compute(): Promise<void> {
  const my = ++token;
  const el = $('tools');
  const t = await target();
  if (my !== token) return;
  if (!t) {
    shown = shownAlp = null;
    el.classList.remove('busy');
    el.innerHTML = EMPTY;
    return;
  }
  if (t.kind === 'position') lastPositionLL = t.ll;
  // Keep what is on screen while working it out, dimmed, unless it is another point.
  if (!shown || !shown.ll.equals(t.ll)) el.innerHTML = '<p class="empty">Regner ut…</p>';
  el.classList.add('busy');
  const [sog, alp, list] = await Promise.all([
    assessStopOrGo(t.ll, t.terrain),
    assessAlptruth(t.ll, t.terrain, t.weather),
    assessInfos(t.ll, t.terrain, t.weather).catch((): Info[] => []),
  ]);
  if (my !== token) return;
  shown = t;
  shownAlp = alp;
  el.classList.remove('busy');
  el.innerHTML = head(t, alp.regionName) + infoList(list) + stopOrGoCard(sog) + `<div id="alp-card">${alptruthCard(alp)}</div>` + FOOT;
}

/** Work the cards out again soon (several data loads in a row become one run). Only while the tab is open. */
export function renderTools(): void {
  if (!active) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void compute();
  }, 80);
}

/** The tab was opened or closed. */
export function setToolsActive(on: boolean): void {
  active = on;
  if (on) renderTools();
}

/** Tap on a clue: flip it. If that matches the data, your tick goes away again. */
async function onClue(key: ClueKey): Promise<void> {
  const t = shown, clue = shownAlp?.clues.find((c) => c.key === key);
  if (!t || !clue) return;
  const next = !clue.on;
  setTick(state.date, t.ll, key, next === (clue.auto ?? false) ? undefined : next);
  const my = ++clueToken, run = token;
  const alp = await assessAlptruth(t.ll, t.terrain, t.weather);
  if (my !== clueToken || run !== token) return; // a newer tick or recalculation draws it
  shownAlp = alp;
  const card = document.getElementById('alp-card');
  if (card) card.innerHTML = alptruthCard(alp);
  // Keep the keyboard focus on the clue that was tapped.
  card?.querySelector<HTMLElement>(`[data-clue="${key}"]`)?.focus();
}

export function initTools(): void {
  $('tools').addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLElement>('[data-clue]');
    if (btn) void onClue(btn.dataset.clue as ClueKey);
  });
  let hadPosition = false;
  onPositionChange((pos) => {
    const switched = !!pos !== hadPosition; // position turned on or off
    hadPosition = !!pos;
    // The tapped point wins; only the hint under it changes ("Trykk på nålen …").
    if (state.picked) return void (switched && renderTools());
    if (!pos || !lastPositionLL || pos.ll.distanceTo(lastPositionLL) >= FOLLOW_M) renderTools();
  });
}
