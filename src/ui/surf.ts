import { SURF_MODELS, type SpotForecast, type SurfModel } from '../api/surf';
import {
  DAY_FROM_H, DAY_TO_H, bestOfDay, dayStart, hourAt, rateHour, scoreName, WIND_NAME, type SurfHour, type SurfRating,
} from '../domain/surf';
import { KIND_NAME, SURF_SPOTS, type SurfSpot } from '../domain/surfSpots';
import { closeSurfPopup, drawSurfMarkers } from '../layers/surf';
import { $, esc, isoDate } from '../util';
import { count, countSpot } from '../analytics/count';
import { arrow, cap, dirName, hh, km, r1, shortDate } from './format';
import { dayStrip, Nearby, scoreBadge, shownTime, tableDate } from './spotList';

/**
 * The Surf tab: every spot with its rating for the time shown (now, or 12:00 on
 * another chosen day), the best rating of each of the next days, and, opened,
 * the spot's facts and a 3-hourly table for the day. Also keeps the map's spot
 * markers in step. main.ts loads the data (api/surf.ts) and hands it over.
 */

export interface SurfHooks {
  /** A day cell was tapped: show that date. */
  onDate(iso: string): void;
  /** "Mer om spotten" in a map popup: open the Surf tab (then openSpot is called). */
  onDetails(id: string): void;
  onShowOnMap(spot: SurfSpot): void;
  onWeather(spot: SurfSpot): void;
}

const HOUR = 3_600_000;
const DAYS = 7;

let hooks: SurfHooks | null = null;
/** Both wave models' forecasts per spot id: shown side by side; the better rating of the two is the spot's rating. */
const byModel: Record<SurfModel, Map<string, SurfHour[]>> = { best_match: new Map(), ncep_gfswave025: new Map() };
const MODELS = Object.keys(SURF_MODELS) as SurfModel[];
/** Some forecast has been loaded (either model). */
const anyData = () => MODELS.some((m) => byModel[m].size > 0);
/** Both models have data: show pairs ("1,2 / 1,7"). */
const hasBoth = () => MODELS.every((m) => byModel[m].size > 0);
let statusText = 'Henter bølgevarsel…';
let openId: string | null = null;
type Sort = 'best' | 'near' | 'coast';
let sort: Sort = 'best';

/** Your position for "Nærmest deg" (ui/spotList.ts). */
const nearby = new Nearby(() => renderSurf(), 'listen står langs kysten', () => true);

const badge = (r: SurfRating | null, cls = 'sp-badge') => scoreBadge(r?.score ?? null, r ? scoreName(r) : 'Ingen data', cls);

/** Now when the chosen date is today, else 12:00 that day; null for past days. */
const shown = shownTime;

type Rated = { hour: SurfHour; rating: SurfRating; model: SurfModel };

function ratingAt(spot: SurfSpot, t: number, m: SurfModel): Rated | null {
  const hour = hourAt(byModel[m].get(spot.id) ?? [], t);
  return hour ? { hour, rating: rateHour(spot, hour), model: m } : null;
}

/**
 * The spot's rating at a time: the better of the two models (on a tie the
 * bigger breaking height, then the first model). Its hour gives the period,
 * direction and notes shown with it.
 */
function bestAt(spot: SurfSpot, t: number): Rated | null {
  let best: Rated | null = null;
  for (const m of MODELS) {
    const a = ratingAt(spot, t, m);
    if (!a || a.rating.size == null) continue;
    if (!best || a.rating.score > best.rating.score || (a.rating.score === best.rating.score && (a.rating.size ?? 0) > (best.rating.size ?? 0))) best = a;
  }
  return best ?? MODELS.map((m) => ratingAt(spot, t, m)).find(Boolean) ?? null;
}

/** "(NOAA)" after a rating when both models are in, so it's clear which one gave it. */
const from = (a: Rated | null) => (a && hasBoth() ? ` (${SURF_MODELS[a.model].short})` : '');

/* ---------- both models side by side ---------- */

/** Breaking height as shown: "0" under 0.3 m (flat), "–" without data. */
const bh = (x: number | null | undefined) => (x == null ? '–' : x < 0.3 ? '0' : r1(x));
const hx = (x: number | null | undefined) => (x == null ? '–' : r1(x));
/** "1,2 / 1,7" in the fixed order of MODELS (DWD/ECMWF, then NOAA). */
const pair = (vals: string[]) => vals.join(' / ');
const PAIR_TITLE = MODELS.map((m) => SURF_MODELS[m].short).join(' / ');

/** The two models for one spot and time, as a small table: rating, breaking height, swell, total. */
function compareTable(spot: SurfSpot, t: number): string {
  if (!hasBoth()) return '';
  const ats = MODELS.map((m) => ratingAt(spot, t, m));
  const top = bestAt(spot, t)?.model;
  const cell = (f: (a: NonNullable<(typeof ats)[number]>) => string) => ats.map((a) => `<td>${a ? f(a) : '–'}</td>`).join('');
  return `<table class="sp-cmp">
    <thead><tr><th></th>${MODELS.map((m) => `<th${m === top ? ' class="sel" title="Best vurdering: denne gir tallet for spotten"' : ''}>${esc(SURF_MODELS[m].short)}</th>`).join('')}</tr></thead>
    <tbody>
      <tr><th>Vurdering</th>${cell((a) => badge(a.rating, 'sp-badge mini'))}</tr>
      <tr><th title="Anslått høyde på brytende bølger ved spotten">Bryter</th>${cell((a) => (a.rating.size == null ? '–' : a.rating.size < 0.3 ? 'flatt' : `ca. ${r1(a.rating.size)} m`))}</tr>
      <tr><th title="Dønningen på åpent hav">Dønning</th>${cell((a) => `${hx(a.hour.swellH)} m${a.hour.swellT != null ? ` · ${Math.round(a.hour.swellT)} s` : ''}${a.hour.swellDir != null ? `<small>fra ${dirName(a.hour.swellDir)} ${arrow(a.hour.swellDir)}</small>` : ''}`)}</tr>
      <tr><th title="Dønning og vindsjø, åpent hav">Totalt</th>${cell((a) => `${hx(a.hour.waveH)} m`)}</tr>
    </tbody></table>`;
}

/* ---------- rendering ---------- */

function nowCell(spot: SurfSpot, at: Rated | null, t: number | null): string {
  if (!at) return `<span class="sp-now"><span class="empty">${anyData() ? 'Utenfor varselet' : '…'}</span></span>`;
  const { hour: h, rating: r } = at;
  const ats = hasBoth() && t != null ? MODELS.map((m) => ratingAt(spot, t, m)) : null;
  const size = ats
    ? `<b title="Brytende bølger, ${PAIR_TITLE}">${pair(ats.map((a) => bh(a?.rating.size)))} m</b>`
    : r.size != null ? `<b>${r.size < 0.3 ? 'flatt' : `ca. ${r1(r.size)} m`}</b>` : '<b>–</b>';
  const period = r.period != null ? ` · ${Math.round(r.period)} s` : '';
  // The open-water swell beside our breaking estimate: the number other surf sites show.
  const swellH = ats ? pair(ats.map((a) => hx(a?.hour.swellH))) : h.swellH != null ? r1(h.swellH) : '';
  const swell = swellH
    ? `dønning ${swellH} m${h.swellDir != null ? ` fra ${dirName(h.swellDir)} ${arrow(h.swellDir)}` : ''}`
    : h.swellDir != null ? `fra ${dirName(h.swellDir)} ${arrow(h.swellDir)}` : '';
  const wind = h.windSpeed != null && h.windDir != null ? `vind ${Math.round(h.windSpeed)} m/s ${r.wind ? WIND_NAME[r.wind] : ''}` : '';
  return `<span class="sp-now"><span title="Anslått høyde på brytende bølger ved spotten">${size}${period}</span>${swell ? `<small>${swell}</small>` : ''}${wind ? `<small>${wind}</small>` : ''}</span>`;
}

/** The next days' best rating; buttons that pick the day in the list, plain cells in the map popup. */
function dayCells(spot: SurfSpot, pick = true): string {
  return dayStrip(DAYS, (iso) => {
    // Best hour of the day in either model.
    let best: ReturnType<typeof bestOfDay> = null;
    for (const m of MODELS) {
      const b = bestOfDay(spot, byModel[m].get(spot.id) ?? [], iso);
      if (b && (!best || b.rating.score > best.rating.score)) best = b;
    }
    const r = best?.rating;
    return {
      score: r ? r.score : null,
      title: best && r
        ? `${shortDate(iso)}: ${scoreName(r)}${r.size != null && r.size >= 0.3 ? `, ca. ${r1(r.size)} m` : ''} kl. ${hh(best.hour.time)}`
        : `${shortDate(iso)}: ingen data`,
    };
  }, pick, `Beste vurdering de neste dagene, kl. ${DAY_FROM_H}–${DAY_TO_H}`);
}

function dayTable(spot: SurfSpot): string {
  const date = tableDate();
  const both = hasBoth();
  const start = dayStart(date), now = Date.now();
  const rows: string[] = [];
  for (let k = 0; k < 24; k += 3) {
    const t = start + k * HOUR;
    if (t + 3 * HOUR <= now) continue; // past 3-hour blocks of today
    const top = bestAt(spot, t);
    if (!top) continue;
    const { hour: h, rating: r } = top;
    // Both models: "1,2 / 1,7" (breaking) and "1,4 / 2,3 m" (swell); rating, period and direction from the better one.
    const ats = both ? MODELS.map((m) => ratingAt(spot, t, m)) : null;
    const size = ats ? pair(ats.map((a) => bh(a?.rating.size))) : r.size == null ? '–' : r.size < 0.3 ? 'flatt' : r1(r.size);
    const swellH = ats ? pair(ats.map((a) => hx(a?.hour.swellH))) : h.swellH != null ? r1(h.swellH) : null;
    const swell = swellH != null ? `${swellH} m ${h.swellT != null ? `${Math.round(h.swellT)} s` : ''} ${h.swellDir != null ? arrow(h.swellDir) : ''}` : '–';
    const wind = h.windSpeed != null
      ? `${Math.round(h.windSpeed)}${h.windGust != null ? ` (${Math.round(h.windGust)})` : ''} ${h.windDir != null ? arrow(h.windDir) : ''}<small>${r.wind ? WIND_NAME[r.wind] : ''}</small>`
      : '–';
    rows.push(`<tr><td>${hh(t)}</td><td title="${esc(SURF_MODELS[top.model].short)}">${badge(r, 'sp-badge mini')}</td><td>${size}</td><td>${swell}</td><td>${wind}</td></tr>`);
  }
  if (!rows.length) return '<p class="empty">Ingen timer igjen av denne dagen i varselet.</p>';
  return `${both ? `<p class="sp-cmp-key">Bryter og dønning: ${esc(PAIR_TITLE)}. Vurdering, periode og retning: modellen som gir best vurdering.</p>` : ''}<table class="sp-tab"><caption>${esc(shortDate(date))}</caption>
    <thead><tr><th>Kl.</th><th></th><th title="Anslått høyde på brytende bølger ved spotten, m${both ? ` (${PAIR_TITLE})` : ''}">Bryter</th><th title="Dønningen på åpent hav: høyde${both ? ` (${PAIR_TITLE})` : ''}, periode og retning">Dønning (hav)</th><th title="Vind og vindkast, m/s">Vind</th></tr></thead>
    <tbody>${rows.join('')}</tbody></table>`;
}

function detail(spot: SurfSpot, at: Rated | null, t: number | null): string {
  const cmp = t != null ? compareTable(spot, t) : '';
  const notes = at?.rating.notes.length ? `<ul class="sp-notes">${at.rating.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
  const sst = at?.hour.sst != null ? `<dt>Sjøtemperatur</dt><dd>${r1(at.hour.sst)} °C</dd>` : '';
  return `${cmp}${notes}
    <dl class="facts sp-facts">
      <dt>Type</dt><dd>${esc(KIND_NAME[spot.kind])}</dd>
      <dt>Beste dønning</dt><dd>fra ${dirName(spot.swellFrom)} ${arrow(spot.swellFrom)}</dd>
      <dt>Fralandsvind</dt><dd>fra ${dirName(spot.offshoreFrom)} ${arrow(spot.offshoreFrom)}</dd>
      ${sst}
      ${spot.note ? `<dt>Om spotten</dt><dd>${esc(spot.note)}</dd>` : ''}
    </dl>
    ${dayTable(spot)}
    <div class="sp-actions">
      <button type="button" class="btn" data-act="map">Vis i kartet</button>
      <button type="button" class="btn" data-act="wx">Vær her</button>
    </div>`;
}

function spotHtml(spot: SurfSpot, at: Rated | null, dist: number | null, t: number | null): string {
  const open = spot.id === openId;
  return `<article class="sp${open ? ' open' : ''}" data-id="${esc(spot.id)}">
    <button type="button" class="sp-h" aria-expanded="${open}" aria-controls="sp-d-${esc(spot.id)}">
      ${at ? scoreBadge(at.rating.score, `${scoreName(at.rating)}${from(at)}`, 'sp-badge') : badge(null)}
      <span class="sp-name"><b>${esc(spot.name)}</b><small>${esc(spot.area)} · ${esc(KIND_NAME[spot.kind])}${dist != null ? ` · ${km(dist)}` : ''}</small></span>
      ${nowCell(spot, at, t)}
    </button>
    ${dayCells(spot)}
    <div class="sp-d" id="sp-d-${esc(spot.id)}"${open ? '' : ' hidden'}>${open ? detail(spot, at, t) : ''}</div>
  </article>`;
}

const ABOUT = `<details class="ws"><summary>Slik vurderes det</summary><div>
  <p class="desc">Bølgevarselet er for havet noen km utenfor (Open-Meteo, modellruter på ca. 5–9 km), ikke for selve stranden. Tallet 0–5 er vår egen grove vurdering:</p>
  <ul class="advice">
    <li><b>Størrelse:</b> høyden på dønningen, justert for hvor mye som kommer inn fra den retningen spotten vender mot, gjort om til brytende bølgehøyde med perioden (Komar og Gaughan 1972). Lang periode gir større bølger av samme dønning.</li>
    <li><b>Periode:</b> ≥ 11 s gir ett poeng ekstra (ren dønning med kraft), under 7 s ett mindre (vindsjø).</li>
    <li><b>Vind:</b> fralands eller stille holder bølgene rene. Sideveis trekker ett, pålands to, og sterk vind (fra 9 m/s) ett til.</li>
  </ul>
  <p class="desc"><b>To tall:</b> det store tallet («ca. 1,2 m») er vårt anslag for brytende bølger ved spotten. «Dønning» er høyden på åpent hav, det samme som andre surfesider som surf-forecast.com viser. Kommer dønningen fra siden, blir det store tallet mye mindre enn dønningen.</p>
  <p class="desc"><b>To modeller:</b> høydene vises som «DWD/ECMWF / NOAA». NOAA GFS-Wave er samme modellfamilie som surf-forecast.com bruker. Modellene får vind fra ulike værmodeller og gir ofte ulik høyde. Tallet 0–5 og fargene er den beste av de to (det lønner seg å sjekke når én modell ser mer lovende ut), og perioden og retningen som vises er fra den.</p>
  <p class="desc">Fargene på dagene viser beste time mellom kl. ${DAY_FROM_H} og ${DAY_TO_H}. Lokale forhold som sandbanker, tidevann og ly bak øyer er ikke med, så se alltid selv før du går uti.</p>
</div></details>`;

export function renderSurf(): void {
  const el = document.getElementById('surf');
  if (!el) return;
  const when = shown();
  if (sort === 'near') nearby.locate();
  nearby.drawn();
  const items = SURF_SPOTS.map((spot) => ({ spot, at: when ? bestAt(spot, when.t) : null, dist: nearby.distanceTo(spot) }));
  const list = sort === 'best'
    ? [...items].sort((a, b) => (b.at?.rating.score ?? -1) - (a.at?.rating.score ?? -1) || (b.at?.rating.size ?? 0) - (a.at?.rating.size ?? 0))
    : sort === 'near' && nearby.here
      ? [...items].sort((a, b) => a.dist! - b.dist!)
      : items;
  const nearNote = sort === 'near' ? nearby.note() : '';
  el.innerHTML = `
    <div class="surf-top">
      <p class="kicker">Surfespotter · ${when ? esc(when.label) : 'velg i dag eller senere'}</p>
      <label class="ctrl"><span>Sorter</span><select id="surf-sort">
        <option value="best"${sort === 'best' ? ' selected' : ''}>Beste først</option>
        <option value="near"${sort === 'near' ? ' selected' : ''}>Nærmest deg</option>
        <option value="coast"${sort === 'coast' ? ' selected' : ''}>Langs kysten</option>
      </select></label>
    </div>
    <p class="desc surf-status">${esc(when ? statusText : 'Bølgevarselet gjelder bare fram i tid. Velg i dag eller en senere dag.')}</p>
    ${nearNote ? `<p class="desc surf-status">${esc(nearNote)}</p>` : ''}
    ${hasBoth() ? `<p class="sp-cmp-key">Høydene i lista: ${esc(PAIR_TITLE)}. Tallet 0–5 og fargene: den modellen som gir best vurdering.</p>` : ''}
    <div class="splist">${list.map(({ spot, at, dist }) => spotHtml(spot, at, dist, when?.t ?? null)).join('')}</div>
    ${ABOUT}
    <p class="wx-src">Bølger: ${MODELS.map((m) => esc(SURF_MODELS[m].source)).join('; ')}, via <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>. Vind: Open-Meteo. Spotdata: <a href="https://www.surf-forecast.com/countries/Norway/breaks" target="_blank" rel="noopener">surf-forecast.com</a>.</p>`;
  drawSurfMarkers(items.map(({ spot, at }) => ({ spot, rating: at?.rating ?? null })), openId, popupFor);
}

/* ---------- map popup ---------- */

/** What a tap on a spot in the map shows: the rating, waves and wind for the time shown, and the next days. */
function popupFor(spot: SurfSpot): HTMLElement {
  // Leaflet builds the popup each time it opens, so this is a tap on the marker.
  count('surf-marker');
  countSpot(spot);
  const el = document.createElement('div');
  el.className = 'sp-pop';
  const when = shown();
  const at = when ? bestAt(spot, when.t) : null;
  let body: string;
  if (!when) body = '<p class="empty">Bølgevarselet gjelder bare fram i tid. Velg i dag eller en senere dag.</p>';
  else if (!at) body = `<p class="empty">${anyData() ? 'Utenfor bølgevarselet.' : esc(statusText)}</p>`;
  else {
    const { hour: h, rating: r } = at;
    const size = r.size == null ? '–' : r.size < 0.3 ? 'flatt' : `ca. ${r1(r.size)} m`;
    const swell = h.swellH != null
      ? `${r1(h.swellH)} m${h.swellT != null ? ` · ${Math.round(h.swellT)} s` : ''}${h.swellDir != null ? ` · fra ${dirName(h.swellDir)} ${arrow(h.swellDir)}` : ''}`
      : '–';
    const wind = h.windSpeed != null
      ? `${Math.round(h.windSpeed)}${h.windGust != null ? ` (${Math.round(h.windGust)})` : ''} m/s${h.windDir != null ? ` fra ${dirName(h.windDir)} ${arrow(h.windDir)}` : ''}${r.wind ? `, ${WIND_NAME[r.wind]}` : ''}`
      : '–';
    // Both models: the comparison table; one model: the three heights as facts.
    const cmp = compareTable(spot, when.t);
    body = `${cmp}<dl class="facts sp-facts">
        ${cmp ? '' : `<dt>Bryter</dt><dd>${size} <span class="sp-hint">(anslått ved spotten)</span></dd>
        <dt>Dønning</dt><dd>${swell} <span class="sp-hint">(åpent hav)</span></dd>
        ${h.waveH != null ? `<dt>Totalt</dt><dd>${r1(h.waveH)} m <span class="sp-hint">(dønning og vindsjø, åpent hav)</span></dd>` : ''}`}
        <dt>Vind</dt><dd>${wind}</dd>
        ${h.sst != null ? `<dt>Sjøtemp.</dt><dd>${r1(h.sst)} °C</dd>` : ''}
      </dl>
      ${r.notes.length ? `<ul class="sp-notes">${r.notes.slice(0, 2).map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`;
  }
  el.innerHTML = `
    <div class="sp-pop-h">${badge(at?.rating ?? null)}<span class="sp-name"><b>${esc(spot.name)}</b><small>${esc(spot.area)} · ${esc(KIND_NAME[spot.kind])}</small></span></div>
    ${when ? `<p class="sp-pop-when">${esc(cap(when.label))}${at ? `: <b>${esc(scoreName(at.rating))}</b>${esc(from(at))}` : ''}</p>` : ''}
    ${body}
    ${anyData() ? dayCells(spot, false) : ''}
    <div class="sp-actions">
      <button type="button" class="btn primary" data-act="more">Mer om spotten</button>
      <button type="button" class="btn" data-act="wx">Vær her</button>
    </div>`;
  el.querySelector('[data-act="more"]')!.addEventListener('click', () => {
    closeSurfPopup();
    hooks?.onDetails(spot.id);
  });
  el.querySelector('[data-act="wx"]')!.addEventListener('click', () => {
    count('surf-weather');
    closeSurfPopup();
    hooks?.onWeather(spot);
  });
  return el;
}

/* ---------- data + events ---------- */

/**
 * One model's forecasts (ui/sportData.ts loads both). `missing` names the
 * models that couldn't be had, for the status line.
 */
export function setSurfData(m: SurfModel, list: SpotForecast[], note: string, missing: SurfModel[] = []): void {
  byModel[m] = new Map(list.map((f) => [f.id, f.hours]));
  const loaded = MODELS.filter((x) => byModel[x].size);
  const last = Math.max(0, ...MODELS.flatMap((x) => [...byModel[x].values()].flatMap((hs) => hs.slice(-1).map((h) => h.time))));
  statusText = `${note}${SURF_SPOTS.length} spotter · ${loaded.map((x) => SURF_MODELS[x].short).join(' og ')}`
    + `${missing.length ? ` (fikk ikke ${missing.map((x) => SURF_MODELS[x].short).join(', ')})` : ''}`
    + ` · varsel til ${last ? shortDate(isoDate(new Date(last))) : '–'}`;
  renderSurf();
}

export function setSurfStatus(text: string): void {
  statusText = text;
  renderSurf();
}

/** Open (expand) a spot in the list and scroll it into view. */
export function openSpot(id: string): void {
  openId = id;
  renderSurf();
  document.querySelector(`#surf .sp[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

export function initSurf(h: SurfHooks): void {
  hooks = h;
  const el = $('surf');
  el.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t.id === 'surf-sort') {
      const v = (t as HTMLSelectElement).value;
      sort = v === 'coast' || v === 'near' ? v : 'best';
      if (sort !== 'best') count(`surf-sort-${sort}`);
      if (sort === 'near') nearby.retry();
      renderSurf();
    }
  });
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const art = t.closest<HTMLElement>('.sp');
    const spot = SURF_SPOTS.find((s) => s.id === art?.dataset.id);
    if (!spot) return;
    const day = t.closest<HTMLElement>('.sp-day');
    if (day?.dataset.date) {
      count('surf-day');
      openId = spot.id;
      hooks?.onDate(day.dataset.date);
      return;
    }
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'map') {
      count('surf-show-map');
      return hooks?.onShowOnMap(spot);
    }
    if (act === 'wx') {
      count('surf-weather');
      return hooks?.onWeather(spot);
    }
    if (t.closest('.sp-h')) {
      openId = openId === spot.id ? null : spot.id;
      if (openId) {
        count('surf-list');
        countSpot(spot);
      }
      renderSurf();
      if (openId) document.querySelector(`#surf .sp[data-id="${CSS.escape(openId)}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  });
  renderSurf();
}
