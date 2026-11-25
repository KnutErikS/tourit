import { count } from '../analytics/count';
import { climbWeatherCached, fetchClimbWeather } from '../api/climbWeather';
import {
  bestClimbOfDay, cellOf, CLIMB_FROM_H, CLIMB_SCORE_NAME, CLIMB_TO_H, rainBefore, rateClimb, ROCK_NAME, type ClimbHour, type ClimbRating,
} from '../domain/climb';
import { gradeText, matchesStyle, styleText, type Crag, type StyleFilter } from '../domain/crags';
import { closeClimbPopup, drawClimbMarkers } from '../layers/climb';
import { map } from '../map';
import { state } from '../state';
import { $, esc, safeUrl } from '../util';
import { arrow, cap, deg, dirName, hh, km, r1, shortDate } from './format';
import { dayStrip, Nearby, scoreBadge, shownTime, tableDate } from './spotList';

/**
 * The Klatring tab: the crags in the map view (sport, trad or all), each with a
 * climbing rating for the time shown (now, or 12:00 on another chosen day), the
 * best rating of the next days, and, opened, the crag's facts and a 3-hourly
 * table for the day. Weather is only fetched for the crags listed (api/climbWeather.ts).
 * The list follows the map, or, sorted "Nærmest deg", holds the crags nearest your
 * position wherever the map is. Also keeps the crag markers in step.
 */

export interface ClimbHooks {
  onDate(iso: string): void;
  /** "Mer om feltet" in a map popup: open the Klatring tab (then openCrag is called). */
  onDetails(id: string): void;
  onShowOnMap(crag: Crag): void;
  onWeather(crag: Crag): void;
}

const HOUR = 3_600_000;
const DAYS = 7;
/** At most this many crags in the list (and asked weather for) at a time. */
const LIST_MAX = 40;

let hooks: ClimbHooks | null = null;
let crags: Crag[] = [];
let statusText = 'Henter klatrefelt…';
let weatherNote = '';
let openId: string | null = null;
let filter: StyleFilter = 'all';
type Sort = 'best' | 'near' | 'name';
let sort: Sort = 'best';

/** Your position for "Nærmest deg" (ui/spotList.ts); only redraws while climbing is shown. */
const nearby = new Nearby(() => renderClimb(), 'listen følger kartet', () => state.sport === 'climb');

const badge = (r: ClimbRating | null, cls = 'sp-badge') => scoreBadge(r?.score ?? null, r ? CLIMB_SCORE_NAME[r.score] : 'Ingen værdata ennå', cls);

/* ---------- time shown + weather ---------- */

/** Now when the chosen date is today, else 12:00 that day; null for past days. */
const shown = shownTime;

const hoursOf = (c: Crag): ClimbHour[] | null => climbWeatherCached(cellOf(c.lat, c.lng));

function ratingAt(c: Crag, t: number): { hour: ClimbHour; rating: ClimbRating; hours: ClimbHour[] } | null {
  const hours = hoursOf(c);
  if (!hours?.length) return null;
  let best: ClimbHour | null = null;
  for (const h of hours) if (!best || Math.abs(h.time - t) < Math.abs(best.time - t)) best = h;
  if (!best || Math.abs(best.time - t) > 90 * 60_000) return null;
  return { hour: best, rating: rateClimb(hours, best), hours };
}

let fetching = false;
let wanted: string[] = [];
/** After a failed fetch, wait this long before asking again (the list redraws often). */
const RETRY_MS = 60_000;
let failedAt = 0;
/** Ask for the weather of the listed crags' cells; redraw when it is in. */
function needWeather(list: Crag[]): void {
  wanted = [...new Set(list.map((c) => cellOf(c.lat, c.lng)))].filter((cell) => !climbWeatherCached(cell));
  if (!wanted.length || fetching || Date.now() - failedAt < RETRY_MS) return;
  fetching = true;
  weatherNote = 'Henter vær for feltene…';
  const cells = wanted;
  fetchClimbWeather(cells)
    .then(() => (weatherNote = ''))
    .catch((e: unknown) => {
      count('fail-openmeteo');
      failedAt = Date.now();
      weatherNote = `Fikk ikke hentet vær fra Open-Meteo (${(e as Error)?.message || 'nettverksfeil'}).`;
    })
    .finally(() => {
      fetching = false;
      renderClimb();
    });
}

/* ---------- rendering ---------- */

function factsLine(c: Crag, dist: number | null = null): string {
  const bits = [styleText(c)];
  if (c.routes) bits.push(`${c.routes} ${c.routes === 1 ? 'rute' : 'ruter'}`);
  const g = gradeText(c);
  if (g) bits.push(g);
  if (dist != null) bits.push(km(dist));
  return bits.map(esc).join(' · ');
}

function nowCell(at: ReturnType<typeof ratingAt>, fetchingThis: boolean): string {
  if (!at) return `<span class="sp-now"><span class="empty">${fetchingThis ? 'henter vær…' : '–'}</span></span>`;
  const { hour: h, rating: r } = at;
  return `<span class="sp-now"><span><b>${ROCK_NAME[r.rock]}</b> · ${deg(h.temp)}</span>`
    + `<small>${r.rain24 >= 0.1 ? `${r1(r.rain24)} mm siste døgn · ` : ''}vind ${Math.round(h.wind)} m/s</small></span>`;
}

function dayCells(c: Crag, pick = true): string {
  const hours = hoursOf(c);
  if (!hours) return '';
  return dayStrip(DAYS, (iso) => {
    const best = bestClimbOfDay(hours, iso);
    const r = best?.rating;
    return {
      score: r ? r.score : null,
      title: best && r ? `${shortDate(iso)}: ${CLIMB_SCORE_NAME[r.score]}, ${ROCK_NAME[r.rock].toLowerCase()} kl. ${hh(best.hour.time)}` : `${shortDate(iso)}: ingen data`,
    };
  }, pick, `Beste klatreforhold de neste dagene, kl. ${CLIMB_FROM_H}–${CLIMB_TO_H}`);
}

function dayTable(c: Crag): string {
  const hours = hoursOf(c);
  if (!hours) return '';
  const date = tableDate();
  const start = new Date(date + 'T00:00:00').getTime(), now = Date.now();
  const rows: string[] = [];
  for (let k = 6; k <= 21; k += 3) {
    const t = start + k * HOUR;
    if (t + 3 * HOUR <= now) continue;
    const h = hours.find((x) => x.time === t);
    if (!h) continue;
    const r = rateClimb(hours, h);
    const rain3 = rainBefore(hours, t + 2 * HOUR, 3); // the 3 hours shown in the row
    rows.push(`<tr><td>${hh(t)}</td><td>${badge(r, 'sp-badge mini')}</td><td>${ROCK_NAME[r.rock]}</td><td>${rain3 >= 0.1 ? r1(rain3) : '–'}</td>`
      + `<td>${deg(h.temp)}</td><td>${Math.round(h.wind)}${h.gust != null ? ` (${Math.round(h.gust)})` : ''} ${h.windDir != null ? arrow(h.windDir) : ''}</td></tr>`);
  }
  if (!rows.length) return '<p class="empty">Ingen timer igjen av denne dagen i varselet.</p>';
  return `<table class="sp-tab"><caption>${esc(shortDate(date))}</caption>
    <thead><tr><th>Kl.</th><th></th><th>Stein</th><th title="Nedbør de tre timene, mm">Regn</th><th>Temp.</th><th title="Vind og vindkast, m/s">Vind</th></tr></thead>
    <tbody>${rows.join('')}</tbody></table>`;
}

const osmUrl = (c: Crag) => `https://www.openstreetmap.org/${({ n: 'node', w: 'way', r: 'relation' } as const)[c.id[0] as 'n' | 'w' | 'r']}/${c.id.slice(1)}`;

function detail(c: Crag, at: ReturnType<typeof ratingAt>): string {
  const notes = at?.rating.notes.length ? `<ul class="sp-notes">${at.rating.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
  const url = c.url ? safeUrl(c.url.startsWith('http') ? c.url : `https://${c.url}`) : '';
  const g = gradeText(c);
  return `${notes}
    <dl class="facts sp-facts">
      <dt>Klatring</dt><dd>${esc(styleText(c))}${c.multipitch ? ', også flere taulengder' : ''}${c.boulder ? ', buldring' : ''}</dd>
      ${c.routes ? `<dt>Ruter</dt><dd>${c.routes}${c.area ? ' (område)' : ''}</dd>` : ''}
      ${g ? `<dt>Grader</dt><dd>${esc(g)}</dd>` : ''}
      ${c.length ? `<dt>Lengde</dt><dd>opptil ${Math.round(c.length)} m</dd>` : ''}
      ${c.rock ? `<dt>Bergart</dt><dd>${esc(c.rock)}</dd>` : ''}
      ${c.orientation ? `<dt>Vender mot</dt><dd>${esc(c.orientation)}</dd>` : ''}
      ${c.access ? `<dt>Adgang</dt><dd>${esc(c.access)}</dd>` : ''}
    </dl>
    ${dayTable(c)}
    <div class="sp-actions">
      <button type="button" class="btn" data-act="map">Vis i kartet</button>
      <button type="button" class="btn" data-act="wx">Vær her</button>
      ${url ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener">Fører/topo ↗</a>` : ''}
      <a class="btn" href="${osmUrl(c)}" target="_blank" rel="noopener" title="Feltet i OpenStreetMap, der data kan rettes og legges til">OSM ↗</a>
    </div>`;
}

function cragHtml(c: Crag, at: ReturnType<typeof ratingAt>, fetchingThis: boolean, dist: number | null): string {
  const open = c.id === openId;
  return `<article class="sp${open ? ' open' : ''}" data-id="${esc(c.id)}">
    <button type="button" class="sp-h" aria-expanded="${open}" aria-controls="cg-d-${esc(c.id)}">
      ${badge(at?.rating ?? null)}
      <span class="sp-name"><b>${esc(c.name)}</b><small>${factsLine(c, dist)}</small></span>
      ${nowCell(at, fetchingThis)}
    </button>
    ${dayCells(c)}
    <div class="sp-d" id="cg-d-${esc(c.id)}"${open ? '' : ' hidden'}>${open ? detail(c, at) : ''}</div>
  </article>`;
}

const ABOUT = `<details class="ws"><summary>Slik vurderes det</summary><div>
  <p class="desc">Klatrefeltene kommer fra OpenStreetMap. Sport eller trad, antall ruter og grader står på feltet eller på rutene som er lagt inn, og mangler for mange felt. Tallet 0–5 er vår egen grove vurdering fra været (Open-Meteo):</p>
  <ul class="advice">
    <li><b>Tørr stein:</b> regn nå gir 0. Regn siste døgn trekker fra (fra 0,5 mm ett, fra 3 mm to, fra 10 mm tre), og regn de siste seks timene ett til.</li>
    <li><b>Temperatur:</b> under 5 °C og over 22 °C trekker ett, under 0 °C og over 27 °C to.</li>
    <li><b>Vind og fukt:</b> vind fra 12 m/s og kast fra 20 m/s trekker ett hver, og fuktig luft (fra 90 %) uten vind ett.</li>
    <li>Våt stein gir høyst 1, fuktig stein høyst 3.</li>
  </ul>
  <p class="desc">Fargene på dagene viser beste time mellom kl. ${CLIMB_FROM_H} og ${CLIMB_TO_H}. Været er for et punkt på ca. 5 km, så sol, le og sig i akkurat din vegg er ikke med. Se selv før du klatrer.</p>
</div></details>`;

/** The crags matching the filter (all of Norway), for the map. */
const filtered = () => crags.filter((c) => matchesStyle(c, filter));

export function renderClimb(): void {
  const el = document.getElementById('climb');
  // Not shown while another sport is chosen (the crags may be preloaded then): nothing to
  // draw and no weather to fetch. Choosing climbing redraws (main.ts).
  if (!el || state.sport !== 'climb') return;
  const when = shown();
  const all = filtered();
  if (sort === 'near') nearby.locate();
  nearby.drawn();
  const distOf = (c: Crag) => nearby.distanceTo(c);
  const nearYou = sort === 'near' && nearby.here !== null;
  let picked: Crag[];
  let scope: string;
  if (nearYou) {
    // Nearest your position, wherever the map is.
    picked = all.map((c) => ({ c, d: distOf(c)! })).sort((a, b) => a.d - b.d).slice(0, LIST_MAX).map((x) => x.c);
    scope = !crags.length ? statusText : `De ${picked.length} feltene nærmest deg.`;
  } else {
    const view = map.getBounds().pad(0.1);
    const inView = all.filter((c) => view.contains([c.lat, c.lng]));
    const centre = map.getCenter();
    // Too many to list: the ones nearest the middle of the map.
    picked = inView.length > LIST_MAX
      ? [...inView].sort((a, b) => centre.distanceTo([a.lat, a.lng]) - centre.distanceTo([b.lat, b.lng])).slice(0, LIST_MAX)
      : inView;
    scope = !crags.length ? statusText
      : !inView.length ? 'Ingen klatrefelt i kartutsnittet. Flytt eller zoom ut kartet.'
      : inView.length > LIST_MAX ? `${inView.length} felt i kartutsnittet: viser de ${LIST_MAX} nærmest midten. Zoom inn for å se andre.`
      : `${inView.length} felt i kartutsnittet.`;
  }
  needWeather(picked);
  const items = picked.map((c) => ({ c, at: when ? ratingAt(c, when.t) : null, dist: distOf(c) }));
  const byName = (a: { c: Crag }, b: { c: Crag }) => a.c.name.localeCompare(b.c.name, 'nb');
  const list = sort === 'best'
    ? [...items].sort((a, b) => (b.at?.rating.score ?? -1) - (a.at?.rating.score ?? -1) || byName(a, b))
    : nearYou
      ? [...items].sort((a, b) => a.dist! - b.dist!)
      : [...items].sort(byName);
  const nearNote = sort === 'near' ? nearby.note() : '';
  const n = (f: StyleFilter) => crags.filter((c) => matchesStyle(c, f)).length;
  el.innerHTML = `
    <div class="surf-top">
      <p class="kicker">Klatrefelt · ${when ? esc(when.label) : 'velg i dag eller senere'}</p>
      <label class="ctrl"><span>Sorter</span><select id="climb-sort">
        <option value="best"${sort === 'best' ? ' selected' : ''}>Beste først</option>
        <option value="near"${sort === 'near' ? ' selected' : ''}>Nærmest deg</option>
        <option value="name"${sort === 'name' ? ' selected' : ''}>Navn</option>
      </select></label>
    </div>
    <div class="cg-filter" role="radiogroup" aria-label="Type klatring">
      ${(['all', 'sport', 'trad'] as const).map((f) => `<button type="button" role="radio" data-filter="${f}" aria-checked="${filter === f}">${{ all: 'Alle', sport: 'Sport', trad: 'Trad' }[f]}${crags.length ? ` <small>${n(f)}</small>` : ''}</button>`).join('')}
    </div>
    <p class="desc surf-status">${esc(when ? scope : 'Værvarselet gjelder bare fram i tid. Velg i dag eller en senere dag.')}</p>
    ${nearNote ? `<p class="desc surf-status">${esc(nearNote)}</p>` : ''}
    ${weatherNote ? `<p class="desc surf-status">${esc(weatherNote)}</p>` : ''}
    <div class="splist">${list.map(({ c, at, dist }) => cragHtml(c, at, fetching && wanted.includes(cellOf(c.lat, c.lng)), dist)).join('')}</div>
    ${ABOUT}
    <p class="wx-src">Klatrefelt: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-bidragsytere (ODbL). Legg gjerne til eller rett felt der, f.eks. med <a href="https://openclimbing.org/" target="_blank" rel="noopener">OpenClimbing</a>. Vær: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>.</p>`;
  if (when) {
    const ratings = new Map(items.map(({ c, at }) => [c.id, at?.rating ?? null]));
    drawClimbMarkers(all.map((c) => ({ crag: c, rating: ratings.get(c.id) ?? (hoursOf(c) ? ratingAt(c, when.t)?.rating ?? null : null) })), openId, popupFor);
  } else {
    drawClimbMarkers(all.map((c) => ({ crag: c, rating: null })), openId, popupFor);
  }
}

/* ---------- map popup ---------- */

function popupFor(c: Crag): HTMLElement {
  count('climb-marker');
  const el = document.createElement('div');
  el.className = 'sp-pop';
  const when = shown();
  const at = when ? ratingAt(c, when.t) : null;
  let body: string;
  if (!when) body = '<p class="empty">Værvarselet gjelder bare fram i tid.</p>';
  else if (!at) body = '<p class="empty">Ikke vær for feltet ennå: zoom inn, så hentes det for feltene i kartutsnittet.</p>';
  else {
    const { hour: h, rating: r } = at;
    body = `<dl class="facts sp-facts">
        <dt>Stein</dt><dd>${ROCK_NAME[r.rock]}${r.rain24 >= 0.1 ? ` · ${r1(r.rain24)} mm siste døgn` : ''}</dd>
        <dt>Temperatur</dt><dd>${deg(h.temp)}${h.rh != null ? ` · fukt ${Math.round(h.rh)} %` : ''}</dd>
        <dt>Vind</dt><dd>${Math.round(h.wind)}${h.gust != null ? ` (${Math.round(h.gust)})` : ''} m/s${h.windDir != null ? ` fra ${dirName(h.windDir)} ${arrow(h.windDir)}` : ''}</dd>
      </dl>
      ${r.notes.length ? `<ul class="sp-notes">${r.notes.slice(0, 2).map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`;
  }
  el.innerHTML = `
    <div class="sp-pop-h">${badge(at?.rating ?? null)}<span class="sp-name"><b>${esc(c.name)}</b><small>${factsLine(c)}</small></span></div>
    ${when && at ? `<p class="sp-pop-when">${esc(cap(when.label))}: <b>${CLIMB_SCORE_NAME[at.rating.score]}</b></p>` : ''}
    ${body}
    ${dayCells(c, false)}
    <div class="sp-actions">
      <button type="button" class="btn primary" data-act="more">Mer om feltet</button>
      <button type="button" class="btn" data-act="wx">Vær her</button>
    </div>`;
  el.querySelector('[data-act="more"]')!.addEventListener('click', () => {
    closeClimbPopup();
    hooks?.onDetails(c.id);
  });
  el.querySelector('[data-act="wx"]')!.addEventListener('click', () => {
    count('climb-weather');
    closeClimbPopup();
    hooks?.onWeather(c);
  });
  return el;
}

/* ---------- data + events ---------- */

export function setCrags(list: Crag[], note: string): void {
  crags = list;
  const n = list.length, sport = list.filter((c) => c.sport).length, trad = list.filter((c) => c.trad).length;
  statusText = `${note}${n} klatrefelt i Norge · ${sport} med sport · ${trad} med trad`;
  renderClimb();
}

export function setClimbStatus(text: string): void {
  statusText = text;
  renderClimb();
}

export const cragCount = () => crags.length;

/** Open (expand) a crag in the list and scroll it into view. */
export function openCrag(id: string): void {
  openId = id;
  renderClimb();
  document.querySelector(`#climb .sp[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

export function initClimb(h: ClimbHooks): void {
  hooks = h;
  const el = $('climb');
  el.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t.id === 'climb-sort') {
      const v = (t as HTMLSelectElement).value;
      sort = v === 'name' || v === 'near' ? v : 'best';
      if (sort === 'near') {
        count('climb-sort-near');
        nearby.retry();
      }
      renderClimb();
    }
  });
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const f = t.closest<HTMLElement>('[data-filter]')?.dataset.filter;
    if (f === 'all' || f === 'sport' || f === 'trad') {
      filter = f;
      if (f !== 'all') count(`climb-filter-${f}`);
      return renderClimb();
    }
    const art = t.closest<HTMLElement>('.sp');
    const c = crags.find((x) => x.id === art?.dataset.id);
    if (!c) return;
    const day = t.closest<HTMLElement>('.sp-day');
    if (day?.dataset.date) {
      openId = c.id;
      hooks?.onDate(day.dataset.date);
      return;
    }
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'map') return hooks?.onShowOnMap(c);
    if (act === 'wx') {
      count('climb-weather');
      return hooks?.onWeather(c);
    }
    if (t.closest('.sp-h')) {
      openId = openId === c.id ? null : c.id;
      if (openId) count('climb-list');
      renderClimb();
      if (openId) document.querySelector(`#climb .sp[data-id="${CSS.escape(openId)}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  });
  renderClimb();
}
