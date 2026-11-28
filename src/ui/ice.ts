import { count } from '../analytics/count';
import { CAPACITY_NAME, iceWarnings, obsWithin, SKATE_NAME, type IceObs } from '../domain/ice';
import { closeIcePopup, drawIceMarkers, itemId, type IceItem } from '../layers/ice';
import { map } from '../map';
import { state } from '../state';
import { $, esc, safeUrl } from '../util';
import { km, shortDate, todayIso } from './format';
import { Nearby, scoreBadge } from './spotList';

/**
 * The Skøyter tab: ice observations from Regobs (Varsom) in the map view, from
 * the last 1, 3 or 7 days up to the chosen date, newest first, nearest you or
 * best first; each with what the observer reported (skateability, carrying
 * capacity, ice thickness and layers, danger signs, comments, pictures). Also
 * keeps the markers (layers/ice.ts) in step.
 */

export interface IceHooks {
  /** "Mer" in a map popup: open the Skøyter tab (then openIce is called). */
  onDetails(id: string): void;
  onShowOnMap(p: { lat: number; lng: number }): void;
  onWeather(p: { lat: number; lng: number }): void;
}

const HOUR = 3_600_000;
const OBS_MAX = 40;
/** Observations older than this are faded on the map. */
const OLD_MS = 3 * 24 * HOUR;

let hooks: IceHooks | null = null;
let obs: IceObs[] = [];
/** The date `obs` were fetched for ('' = none yet). */
let obsDate = '';
let obsStatus = 'Henter isobservasjoner fra Regobs…';
let openId: string | null = null;
type Days = 1 | 3 | 7;
let days: Days = 3;
type Sort = 'new' | 'near' | 'best';
let sort: Sort = 'new';

const nearby = new Nearby(() => renderIce(), 'listen følger kartet', () => state.sport === 'ice');

const CAP_SHORT: Record<number, string> = { 1: 'Liten fare', 2: 'Normal fare', 3: 'Stor fare', 4: 'Uten bæreevne' };

/** The end of the period shown: now for today or a later day, the end of a past day. */
function endTime(): number {
  const date = state.date || todayIso();
  return date < todayIso() ? new Date(date + 'T23:59:59').getTime() : Date.now();
}

function ago(t: number): string {
  const min = (Date.now() - t) / 60_000;
  if (min < 60) return `for ${Math.max(1, Math.round(min))} min siden`;
  const h = min / 60;
  if (h < 24) return `for ${Math.round(h)} t siden`;
  const d = Math.round(h / 24);
  return d < 8 ? `for ${d} døgn siden` : new Date(t).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' });
}
const when = (t: number) => new Date(t).toLocaleString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const cmText = (x: number) => `${String(Math.round(x * 10) / 10).replace('.', ',')} cm`;

const obsBadge = (o: IceObs, cls = 'sp-badge') => scoreBadge(o.skate, o.skate ? SKATE_NAME[o.skate] : 'Skøytbarhet ikke oppgitt', cls);

/* ---------- observations ---------- */

function obsLine(o: IceObs, dist: number | null): string {
  const bits = [ago(o.time), o.observer];
  if (o.municipality && !o.place.toUpperCase().includes(o.municipality.toUpperCase())) bits.push(o.municipality.charAt(0) + o.municipality.slice(1).toLowerCase());
  if (dist != null) bits.push(km(dist));
  return bits.map(esc).join(' · ');
}

function warnLine(o: IceObs): string {
  const w = iceWarnings(o);
  return w.length ? `<p class="ice-warn"><b>Obs!</b> ${w.map(esc).join(' · ')}</p>` : '';
}

function layersText(o: IceObs): string {
  return o.layers.map((l) => (l.cm != null ? `${cmText(l.cm)} ${l.name.toLowerCase()}` : l.name.toLowerCase())).join(', ');
}

function obsDetail(o: IceObs): string {
  const l = layersText(o);
  const pics = o.images.slice(0, 6).map((im) => {
    const large = safeUrl(im.large), thumb = safeUrl(im.thumb);
    return large && thumb ? `<a href="${esc(large)}" target="_blank" rel="noopener"><img src="${esc(thumb)}" alt="Bilde fra observasjonen${im.credit ? `, © ${esc(im.credit)}` : ''}" loading="lazy"></a>` : '';
  }).join('');
  return `
    <dl class="facts sp-facts">
      <dt>Observert</dt><dd>${esc(when(o.time))}</dd>
      ${o.cover ? `<dt>Isdekke</dt><dd>${esc(o.cover)}</dd>` : ''}
      <dt>Skøyter</dt><dd>${o.skate ? esc(SKATE_NAME[o.skate]) : '<span class="empty">ikke oppgitt</span>'}</dd>
      <dt>Bæreevne</dt><dd>${o.capacity ? esc(CAPACITY_NAME[o.capacity]) : '<span class="empty">ikke oppgitt</span>'}</dd>
      ${o.thicknessCm != null ? `<dt>Istykkelse</dt><dd>${cmText(o.thicknessCm)}${l ? ` (${esc(l)})` : ''}</dd>` : l ? `<dt>Islag</dt><dd>${esc(l)}</dd>` : ''}
      ${o.snowCm != null ? `<dt>Snø på isen</dt><dd>${cmText(o.snowCm)}</dd>` : ''}
      ${o.slushCm != null ? `<dt>Sørpe</dt><dd>${cmText(o.slushCm)}</dd>` : ''}
      ${o.signs.length ? `<dt>Faretegn</dt><dd>${o.signs.map(esc).join('<br>')}</dd>` : o.noSigns ? '<dt>Faretegn</dt><dd>Ingen observert</dd>' : ''}
      ${o.incident ? `<dt>Hendelse</dt><dd>${esc(o.incident)}</dd>` : ''}
      <dt>Observatør</dt><dd>${esc(o.observer)}${o.competence && o.competence !== 'Ukjent' ? ` (${esc(o.competence)})` : ''}</dd>
    </dl>
    ${o.comments.map((c) => `<p class="ice-note">${esc(c)}</p>`).join('')}
    ${pics ? `<div class="ice-pics">${pics}</div>` : ''}
    <div class="sp-actions">
      <button type="button" class="btn" data-act="map">Vis i kartet</button>
      <button type="button" class="btn" data-act="wx">Vær her</button>
      <a class="btn" href="https://www.regobs.no/registration/${encodeURIComponent(String(o.id))}" target="_blank" rel="noopener">Åpne i Regobs ↗</a>
    </div>`;
}

function nowCellObs(o: IceObs): string {
  const t = o.thicknessCm != null ? `<b>${cmText(o.thicknessCm)}</b>` : '<span class="empty">–</span>';
  return `<span class="sp-now"><span>${t}</span>${o.capacity ? `<small>${esc(CAP_SHORT[o.capacity])}</small>` : ''}</span>`;
}

function obsHtml(o: IceObs, dist: number | null): string {
  const id = `o${o.id}`, open = id === openId;
  return `<article class="sp${open ? ' open' : ''}" data-id="${id}">
    <button type="button" class="sp-h" aria-expanded="${open}" aria-controls="ice-d-${id}">
      ${obsBadge(o)}
      <span class="sp-name"><b>${esc(o.place)}</b><small>${obsLine(o, dist)}</small></span>
      ${nowCellObs(o)}
    </button>
    ${warnLine(o)}
    <div class="sp-d" id="ice-d-${id}"${open ? '' : ' hidden'}>${open ? obsDetail(o) : ''}</div>
  </article>`;
}

const ABOUT = `<details class="ws"><summary>Om dataene og isvett</summary><div>
  <p class="desc">Isobservasjonene er det folk har meldt inn i Regobs (det Varsom viser under «Is») fra vann og sjø: skøytbarhet, bæreevne, istykkelse og islag, faretegn, kommentarer og bilder. Meldinger fra elver (isgang, sarr) er ikke med. Fargen er skøytbarheten observatøren oppga, tallet i sirkelen istykkelsen i cm, og en rød ring betyr stor fare for å gå gjennom, faretegn eller en hendelse. Observasjoner eldre enn tre døgn er blekere.</p>
  <p class="desc">Isen kan være helt annerledes et stykke unna, og den endrer seg fra time til time. Ha alltid ispigger og kasteline, gå aldri alene, unngå oser, innløp, utløp og strømmer, og kjenn etter med isstav. Les <a href="https://www.varsom.no/is/isvettreglene/" target="_blank" rel="noopener">isvettreglene</a>.</p>
</div></details>`;

/* ---------- rendering ---------- */

const SORT_LABEL: Record<Sort, string> = { new: 'Nyeste først', near: 'Nærmest deg', best: 'Beste først' };

export function renderIce(): void {
  const el = document.getElementById('ice');
  if (!el || state.sport !== 'ice') return;
  const end = endTime();
  const shownObs = obsWithin(obs, end, days);
  if (sort === 'near') nearby.locate();
  nearby.drawn();
  const nearYou = sort === 'near' && nearby.here !== null;
  const distOf = (p: { lat: number; lng: number }) => nearby.distanceTo(p);
  const view = map.getBounds().pad(0.1);
  const centre = map.getCenter();
  const fromCentre = (p: { lat: number; lng: number }) => centre.distanceTo([p.lat, p.lng]);

  let listObs: IceObs[], scope: string;
  if (nearYou) {
    listObs = [...shownObs].sort((a, b) => distOf(a)! - distOf(b)!).slice(0, OBS_MAX);
    scope = `De ${listObs.length} observasjonene nærmest deg.`;
  } else {
    const inView = shownObs.filter((o) => view.contains([o.lat, o.lng]));
    listObs = inView.length > OBS_MAX ? [...inView].sort((a, b) => fromCentre(a) - fromCentre(b)).slice(0, OBS_MAX) : inView;
    scope = !obsDate ? obsStatus
      : !shownObs.length ? `Ingen isobservasjoner i Regobs ${days === 1 ? 'siste døgn' : `siste ${days} døgn`}.`
      : !inView.length ? `${shownObs.length} observasjoner i Norge, ingen i kartutsnittet. Flytt eller zoom ut kartet.`
      : inView.length > OBS_MAX ? `${inView.length} i kartutsnittet: viser de ${OBS_MAX} nærmest midten.`
      : `${inView.length} i kartutsnittet, ${shownObs.length} i hele Norge.`;
  }
  // A stored copy, a failed refresh or a new date loading: say so above what is shown.
  if (obsStatus && obsDate) scope = `${obsStatus} ${scope}`;
  if (sort === 'new' || (sort === 'near' && !nearYou)) listObs.sort((a, b) => b.time - a.time);
  if (sort === 'best') listObs.sort((a, b) => (b.skate ?? -1) - (a.skate ?? -1) || b.time - a.time);

  const nearNote = sort === 'near' ? nearby.note() : '';
  const period = days === 1 ? 'siste døgn' : `siste ${days} døgn`;
  const date = state.date || todayIso();
  el.innerHTML = `
    <div class="surf-top">
      <p class="kicker">Is · ${esc(period)}${date < todayIso() ? ` til ${esc(shortDate(date))}` : ''}</p>
      <label class="ctrl"><span>Sorter</span><select id="ice-sort">
        ${(['new', 'near', 'best'] as const).map((s) => `<option value="${s}"${sort === s ? ' selected' : ''}>${SORT_LABEL[s]}</option>`).join('')}
      </select></label>
    </div>
    <div class="cg-filter" role="radiogroup" aria-label="Hvor gamle observasjoner">
      ${([1, 3, 7] as const).map((d) => `<button type="button" role="radio" data-days="${d}" aria-checked="${days === d}">${d === 1 ? '1 døgn' : `${d} døgn`}${obsDate ? ` <small>${obsWithin(obs, end, d).length}</small>` : ''}</button>`).join('')}
    </div>
    <p class="desc surf-status">${esc(scope)}</p>
    ${nearNote ? `<p class="desc surf-status">${esc(nearNote)}</p>` : ''}
    <div class="splist">${listObs.map((o) => obsHtml(o, distOf(o))).join('')}</div>
    ${ABOUT}
    <p class="wx-src">Isobservasjoner: <a href="https://www.varsom.no/is/" target="_blank" rel="noopener">Varsom</a> / <a href="https://www.regobs.no/" target="_blank" rel="noopener">Regobs</a> (NVE) og observatørene.</p>`;

  const old = end - OLD_MS;
  const markerItems: IceItem[] = shownObs.map((o) => ({ obs: o, warn: iceWarnings(o).length > 0, old: o.time < old }));
  drawIceMarkers(markerItems, openId, popupFor);
}

/* ---------- map popup ---------- */

function popupFor(item: IceItem): HTMLElement {
  count('ice-marker');
  const el = document.createElement('div');
  el.className = 'sp-pop';
  const o = item.obs, l = layersText(o);
  el.innerHTML = `
    <div class="sp-pop-h">${obsBadge(o)}<span class="sp-name"><b>${esc(o.place)}</b><small>${esc(ago(o.time))} · ${esc(o.observer)}</small></span></div>
    ${warnLine(o)}
    <dl class="facts sp-facts">
      <dt>Skøyter</dt><dd>${o.skate ? esc(SKATE_NAME[o.skate]) : '<span class="empty">ikke oppgitt</span>'}</dd>
      ${o.capacity ? `<dt>Bæreevne</dt><dd>${esc(CAPACITY_NAME[o.capacity])}</dd>` : ''}
      ${o.thicknessCm != null ? `<dt>Is</dt><dd>${cmText(o.thicknessCm)}${l ? ` (${esc(l)})` : ''}</dd>` : ''}
      ${o.cover ? `<dt>Isdekke</dt><dd>${esc(o.cover)}</dd>` : ''}
    </dl>
    ${o.comments[0] ? `<p class="ice-note">${esc(o.comments[0].length > 160 ? o.comments[0].slice(0, 157) + '…' : o.comments[0])}</p>` : ''}
    <div class="sp-actions"><button type="button" class="btn primary" data-act="more">Mer</button>
      <a class="btn" href="https://www.regobs.no/registration/${encodeURIComponent(String(o.id))}" target="_blank" rel="noopener">Regobs ↗</a></div>`;
  el.querySelector('[data-act="more"]')!.addEventListener('click', () => {
    closeIcePopup();
    hooks?.onDetails(itemId(item));
  });
  return el;
}

/* ---------- data + events ---------- */

/** Observations for `date`; `note` is "Uten nett · lagret …" for a stored copy. */
export function setIceObs(list: IceObs[], date: string, note: string): void {
  obs = list;
  obsDate = date;
  obsStatus = note.replace(/ · $/, '.');
  renderIce();
}

export function setIceStatus(text: string): void {
  obsStatus = text;
  if (!obs.length) obsDate = '';
  renderIce();
}

/** Open (expand) an observation in the list and scroll it into view. */
export function openIce(id: string): void {
  openId = id;
  renderIce();
  document.querySelector(`#ice .sp[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

const find = (id: string | undefined) => (id ? obs.find((o) => `o${o.id}` === id) : undefined);

export function initIce(h: IceHooks): void {
  hooks = h;
  const el = $('ice');
  el.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t.id === 'ice-sort') {
      const v = (t as HTMLSelectElement).value;
      sort = v === 'near' || v === 'best' ? v : 'new';
      if (sort === 'near') {
        count('ice-sort-near');
        nearby.retry();
      }
      renderIce();
    }
  });
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const d = t.closest<HTMLElement>('[data-days]')?.dataset.days;
    if (d === '1' || d === '3' || d === '7') {
      days = +d as Days;
      if (days !== 3) count(days === 1 ? 'ice-days-1' : 'ice-days-7');
      return renderIce();
    }
    const art = t.closest<HTMLElement>('.sp');
    const id = art?.dataset.id;
    const p = find(id);
    if (!id || !p) return;
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'map') return hooks?.onShowOnMap(p);
    if (act === 'wx') return hooks?.onWeather(p);
    if (t.closest('.sp-h')) {
      openId = openId === id ? null : id;
      if (openId) count('ice-list');
      renderIce();
      if (openId) document.querySelector(`#ice .sp[data-id="${CSS.escape(openId)}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  });
  renderIce();
}
