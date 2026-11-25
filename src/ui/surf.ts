import type { SpotForecast } from '../api/surf';
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
let forecasts = new Map<string, SurfHour[]>();
let statusText = 'Henter bølgevarsel…';
let openId: string | null = null;
type Sort = 'best' | 'near' | 'coast';
let sort: Sort = 'best';

/** Your position for "Nærmest deg" (ui/spotList.ts). */
const nearby = new Nearby(() => renderSurf(), 'listen står langs kysten', () => true);

const badge = (r: SurfRating | null, cls = 'sp-badge') => scoreBadge(r?.score ?? null, r ? scoreName(r) : 'Ingen data', cls);

/** Now when the chosen date is today, else 12:00 that day; null for past days. */
const shown = shownTime;

function ratingAt(spot: SurfSpot, t: number): { hour: SurfHour; rating: SurfRating } | null {
  const hour = hourAt(forecasts.get(spot.id) ?? [], t);
  return hour ? { hour, rating: rateHour(spot, hour) } : null;
}

/* ---------- rendering ---------- */

function nowCell(at: ReturnType<typeof ratingAt>): string {
  if (!at) return `<span class="sp-now"><span class="empty">${forecasts.size ? 'Utenfor varselet' : '…'}</span></span>`;
  const { hour: h, rating: r } = at;
  const size = r.size != null ? `<b>${r.size < 0.3 ? 'flatt' : `ca. ${r1(r.size)} m`}</b>` : '<b>–</b>';
  const period = r.period != null ? ` · ${Math.round(r.period)} s` : '';
  const swell = h.swellDir != null ? `fra ${dirName(h.swellDir)} ${arrow(h.swellDir)}` : '';
  const wind = h.windSpeed != null && h.windDir != null ? `vind ${Math.round(h.windSpeed)} m/s ${r.wind ? WIND_NAME[r.wind] : ''}` : '';
  return `<span class="sp-now"><span>${size}${period}</span><small>${[swell, wind].filter(Boolean).join(' · ')}</small></span>`;
}

/** The next days' best rating; buttons that pick the day in the list, plain cells in the map popup. */
function dayCells(spot: SurfSpot, pick = true): string {
  const hours = forecasts.get(spot.id) ?? [];
  return dayStrip(DAYS, (iso) => {
    const best = bestOfDay(spot, hours, iso);
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
  const hours = forecasts.get(spot.id) ?? [];
  const start = dayStart(date), now = Date.now();
  const rows: string[] = [];
  for (let k = 0; k < 24; k += 3) {
    const t = start + k * HOUR;
    if (t + 3 * HOUR <= now) continue; // past 3-hour blocks of today
    const h = hourAt(hours, t);
    if (!h) continue;
    const r = rateHour(spot, h);
    const size = r.size == null ? '–' : r.size < 0.3 ? 'flatt' : r1(r.size);
    const swell = h.swellH != null ? `${r1(h.swellH)} m ${h.swellT != null ? `${Math.round(h.swellT)} s` : ''} ${h.swellDir != null ? arrow(h.swellDir) : ''}` : '–';
    const wind = h.windSpeed != null
      ? `${Math.round(h.windSpeed)}${h.windGust != null ? ` (${Math.round(h.windGust)})` : ''} ${h.windDir != null ? arrow(h.windDir) : ''}<small>${r.wind ? WIND_NAME[r.wind] : ''}</small>`
      : '–';
    rows.push(`<tr><td>${hh(t)}</td><td>${badge(r, 'sp-badge mini')}</td><td>${size}</td><td>${swell}</td><td>${wind}</td></tr>`);
  }
  if (!rows.length) return '<p class="empty">Ingen timer igjen av denne dagen i varselet.</p>';
  return `<table class="sp-tab"><caption>${esc(shortDate(date))}</caption>
    <thead><tr><th>Kl.</th><th></th><th title="Anslått høyde på brytende bølger">Bølger</th><th>Dønning</th><th title="Vind og vindkast, m/s">Vind</th></tr></thead>
    <tbody>${rows.join('')}</tbody></table>`;
}

function detail(spot: SurfSpot, at: ReturnType<typeof ratingAt>): string {
  const notes = at?.rating.notes.length ? `<ul class="sp-notes">${at.rating.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
  const sst = at?.hour.sst != null ? `<dt>Sjøtemperatur</dt><dd>${r1(at.hour.sst)} °C</dd>` : '';
  return `${notes}
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

function spotHtml(spot: SurfSpot, at: ReturnType<typeof ratingAt>, dist: number | null): string {
  const open = spot.id === openId;
  return `<article class="sp${open ? ' open' : ''}" data-id="${esc(spot.id)}">
    <button type="button" class="sp-h" aria-expanded="${open}" aria-controls="sp-d-${esc(spot.id)}">
      ${badge(at?.rating ?? null)}
      <span class="sp-name"><b>${esc(spot.name)}</b><small>${esc(spot.area)} · ${esc(KIND_NAME[spot.kind])}${dist != null ? ` · ${km(dist)}` : ''}</small></span>
      ${nowCell(at)}
    </button>
    ${dayCells(spot)}
    <div class="sp-d" id="sp-d-${esc(spot.id)}"${open ? '' : ' hidden'}>${open ? detail(spot, at) : ''}</div>
  </article>`;
}

const ABOUT = `<details class="ws"><summary>Slik vurderes det</summary><div>
  <p class="desc">Bølgevarselet er for havet noen km utenfor (Open-Meteo, modellruter på ca. 5–9 km), ikke for selve stranden. Tallet 0–5 er vår egen grove vurdering:</p>
  <ul class="advice">
    <li><b>Størrelse:</b> høyden på dønningen, justert for hvor mye som kommer inn fra den retningen spotten vender mot, gjort om til brytende bølgehøyde med perioden (Komar og Gaughan 1972). Lang periode gir større bølger av samme dønning.</li>
    <li><b>Periode:</b> ≥ 11 s gir ett poeng ekstra (ren dønning med kraft), under 7 s ett mindre (vindsjø).</li>
    <li><b>Vind:</b> fralands eller stille holder bølgene rene. Sideveis trekker ett, pålands to, og sterk vind (fra 9 m/s) ett til.</li>
  </ul>
  <p class="desc">Fargene på dagene viser beste time mellom kl. ${DAY_FROM_H} og ${DAY_TO_H}. Lokale forhold som sandbanker, tidevann og ly bak øyer er ikke med, så se alltid selv før du går uti.</p>
</div></details>`;

export function renderSurf(): void {
  const el = document.getElementById('surf');
  if (!el) return;
  const when = shown();
  if (sort === 'near') nearby.locate();
  nearby.drawn();
  const items = SURF_SPOTS.map((spot) => ({ spot, at: when ? ratingAt(spot, when.t) : null, dist: nearby.distanceTo(spot) }));
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
    <div class="splist">${list.map(({ spot, at, dist }) => spotHtml(spot, at, dist)).join('')}</div>
    ${ABOUT}
    <p class="wx-src">Bølger og vind: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (DWD, ECMWF, MET Norge). Spotdata: <a href="https://www.surf-forecast.com/countries/Norway/breaks" target="_blank" rel="noopener">surf-forecast.com</a>.</p>`;
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
  const at = when ? ratingAt(spot, when.t) : null;
  let body: string;
  if (!when) body = '<p class="empty">Bølgevarselet gjelder bare fram i tid. Velg i dag eller en senere dag.</p>';
  else if (!at) body = `<p class="empty">${forecasts.size ? 'Utenfor bølgevarselet.' : esc(statusText)}</p>`;
  else {
    const { hour: h, rating: r } = at;
    const size = r.size == null ? '–' : r.size < 0.3 ? 'flatt' : `ca. ${r1(r.size)} m`;
    const swell = h.swellH != null
      ? `${r1(h.swellH)} m${h.swellT != null ? ` · ${Math.round(h.swellT)} s` : ''}${h.swellDir != null ? ` · fra ${dirName(h.swellDir)} ${arrow(h.swellDir)}` : ''}`
      : '–';
    const wind = h.windSpeed != null
      ? `${Math.round(h.windSpeed)}${h.windGust != null ? ` (${Math.round(h.windGust)})` : ''} m/s${h.windDir != null ? ` fra ${dirName(h.windDir)} ${arrow(h.windDir)}` : ''}${r.wind ? `, ${WIND_NAME[r.wind]}` : ''}`
      : '–';
    body = `<dl class="facts sp-facts">
        <dt>Bølger</dt><dd>${size}</dd>
        <dt>Dønning</dt><dd>${swell}</dd>
        <dt>Vind</dt><dd>${wind}</dd>
        ${h.sst != null ? `<dt>Sjøtemp.</dt><dd>${r1(h.sst)} °C</dd>` : ''}
      </dl>
      ${r.notes.length ? `<ul class="sp-notes">${r.notes.slice(0, 2).map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`;
  }
  el.innerHTML = `
    <div class="sp-pop-h">${badge(at?.rating ?? null)}<span class="sp-name"><b>${esc(spot.name)}</b><small>${esc(spot.area)} · ${esc(KIND_NAME[spot.kind])}</small></span></div>
    ${when ? `<p class="sp-pop-when">${esc(cap(when.label))}${at ? `: <b>${esc(scoreName(at.rating))}</b>` : ''}</p>` : ''}
    ${body}
    ${forecasts.size ? dayCells(spot, false) : ''}
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

export function setSurfData(list: SpotForecast[], note: string): void {
  forecasts = new Map(list.map((f) => [f.id, f.hours]));
  const last = Math.max(0, ...list.flatMap((f) => f.hours.slice(-1).map((h) => h.time)));
  statusText = `${note}${SURF_SPOTS.length} spotter · varsel til ${last ? shortDate(isoDate(new Date(last))) : '–'}`;
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
