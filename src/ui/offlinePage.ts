import * as L from 'leaflet';
import { regionAt } from '../domain/geo';
import { map } from '../map';
import { deleteArea, downloadArea, offlineSupported, requestPersistence, storageInfo, type Progress } from '../offline/download';
import { type SavedArea, isComplete, listAreas, putArea } from '../offline/store';
import { type AreaSpec, boundsOf, estimate } from '../offline/tiles';
import { state } from '../state';
import { $, esc } from '../util';

/**
 * "Lagrede områder": a save button and a download icon on the map. The icon
 * opens a page listing saved areas; the save button opens the same page with
 * the save form, and draws the area that will be saved on the map.
 */

const MAX_TILES = 25_000;
const WARN_BYTES = 500e6;

const ICON_SAVE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M12 8v8M8 12h8"/></svg>';
const ICON_DOWNLOADS =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';

const fmtBytes = (b: number) =>
  b >= 1e9 ? (b / 1e9).toFixed(1).replace('.', ',') + ' GB' : b >= 1e6 ? Math.round(b / 1e6) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' kB';
const fmtNum = (n: number) => n.toLocaleString('nb-NO');
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });

let mode: 'list' | 'save' = 'list';
let rect: L.Rectangle | null = null;
let job: { areaId: string; progress: Progress; abort: AbortController } | null = null;
let confirmDelete: string | null = null;
let badge: HTMLElement | null = null;

const page = () => $('offline');

/* ---------- area on screen ---------- */

/** Map bounds not covered by the side panels (or bottom sheets on mobile). */
function visibleBounds(): L.LatLngBounds {
  const box = map.getContainer().getBoundingClientRect();
  let left = 0, right = box.width, top = 0, bottom = box.height;
  for (const el of [$('panel'), page()]) {
    if (el.hidden) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cx = (r.left + r.right) / 2 - box.left, cy = (r.top + r.bottom) / 2 - box.top;
    if (r.width < box.width * 0.9) {
      if (cx < box.width / 2) left = Math.max(left, r.right - box.left);
      else right = Math.min(right, r.left - box.left);
    } else if (cy > box.height / 2) bottom = Math.min(bottom, r.top - box.top);
  }
  const m = 16;
  if (right - left < 80 || bottom - top < 80) return map.getBounds();
  return L.latLngBounds(map.containerPointToLatLng([left + m, bottom - m]), map.containerPointToLatLng([right - m, top + m]));
}

function readForm(): AreaSpec & { name: string } {
  return {
    name: ($<HTMLInputElement>('off-name').value || '').trim(),
    bounds: boundsOf(visibleBounds()),
    maxZoom: +$<HTMLSelectElement>('off-maxz').value,
    bratt: $<HTMLInputElement>('off-bratt').checked,
    terrain: $<HTMLInputElement>('off-terrain').checked,
  };
}

function updatePreview(): void {
  if (mode !== 'save' || page().hidden) return;
  const spec = readForm();
  const b = L.latLngBounds(spec.bounds);
  if (!rect) rect = L.rectangle(b, { color: '#1f4f86', weight: 2, dashArray: '6 4', fill: false, interactive: false }).addTo(map);
  else rect.setBounds(b);

  const { tiles, bytes } = estimate(spec);
  const el = $('off-estimate');
  const btn = $<HTMLButtonElement>('off-go');
  const tooBig = tiles > MAX_TILES;
  el.className = 'off-est' + (tooBig ? ' bad' : bytes > WARN_BYTES ? ' warn' : '');
  el.innerHTML = tooBig
    ? `<b>${fmtNum(tiles)} kartfliser</b> er for mye. Zoom inn, eller velg lavere maks zoom.`
    : `<b>${fmtNum(tiles)} kartfliser</b> · ca. ${fmtBytes(bytes)}${bytes > WARN_BYTES ? ' · stort område' : ''}`;
  btn.disabled = tooBig || !!job;
}

function clearPreview(): void {
  rect?.remove();
  rect = null;
}

/* ---------- rendering ---------- */

function areaMeta(a: SavedArea): string {
  const layers = ['kart', a.bratt && 'bratthet', a.terrain && 'terreng'].filter(Boolean).join(' · ');
  // Stored in localStorage, which other sites on the same origin could touch: keep it to numbers/escaped text.
  return `${esc(fmtDay(a.createdAt))} · zoom til ${Math.round(Number(a.maxZoom)) || '?'} · ${layers}`;
}

function areaHTML(a: SavedArea): string {
  const running = job?.areaId === a.id;
  const p = running ? job!.progress : null;
  const complete = isComplete(a);
  let status: string;
  if (p) {
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    status = `<div class="off-bar"><i style="width:${pct}%"></i></div>
      <div class="off-sub">Laster ned ${fmtNum(p.done)} av ${fmtNum(p.total)} · ${fmtBytes(p.bytes)}${p.failed ? ` · ${fmtNum(p.failed)} feilet` : ''}</div>`;
  } else if (complete) {
    status = `<div class="off-sub">${fmtNum(a.tiles)} kartfliser · ${fmtBytes(a.bytes)}</div>`;
  } else {
    status = `<div class="off-sub warn">Ufullstendig: ${fmtNum(a.stored)} av ${fmtNum(a.tiles)} kartfliser${a.failed ? ` (${fmtNum(a.failed)} feilet)` : ''} · ${fmtBytes(a.bytes)}</div>`;
  }
  const actions = running
    ? `<button class="btn" data-act="abort">Avbryt</button>`
    : `<button class="btn" data-act="show">Vis i kartet</button>
       ${!complete ? `<button class="btn primary" data-act="resume"${job ? ' disabled' : ''}>Fullfør</button>` : ''}
       <button class="btn${confirmDelete === a.id ? ' danger' : ''}" data-act="delete"${job ? ' disabled' : ''}>${confirmDelete === a.id ? 'Bekreft sletting' : 'Slett'}</button>`;
  return `<article class="off-area" data-id="${esc(a.id)}">
    <div class="off-title"><b>${esc(a.name)}</b>${complete && !running ? '<span class="off-ok">Lagret</span>' : ''}</div>
    <div class="off-sub">${areaMeta(a)}</div>
    ${status}
    <div class="off-actions">${actions}</div>
  </article>`;
}

function renderList(): void {
  const areas = listAreas();
  $('off-list').innerHTML = areas.length
    ? areas.map(areaHTML).join('')
    : '<p class="empty">Ingen lagrede områder ennå. Flytt kartet til et område du bruker ofte, og trykk «Lagre område».</p>';
  if (badge) {
    badge.textContent = areas.length ? String(areas.length) : '';
    badge.hidden = !areas.length;
  }
}

async function renderStorage(): Promise<void> {
  const info = await storageInfo();
  $('off-storage').textContent = info
    ? `Appen bruker ${fmtBytes(info.usage)} på denne enheten${info.quota ? ` (av ${fmtBytes(info.quota)} tilgjengelig)` : ''}.` +
      (info.persisted ? ' Lagringen er beskyttet mot automatisk opprydding.' : ' Nettleseren kan rydde bort lagrede områder hvis det blir lite plass.')
    : '';
}

function renderMode(): void {
  $('off-new').hidden = mode !== 'save';
  $('off-new-btn').hidden = mode === 'save';
  if (mode === 'save') {
    const nameEl = $<HTMLInputElement>('off-name');
    if (!nameEl.value) {
      const r = regionAt(state.regions, map.getCenter());
      nameEl.value = r ? r.name : `Område ${listAreas().length + 1}`;
    }
    $<HTMLSelectElement>('off-maxz').value = String(map.getZoom() < 10 ? 14 : 15);
    updatePreview();
  } else {
    clearPreview();
  }
}

/* ---------- actions ---------- */

export function openOffline(m: 'list' | 'save'): void {
  window.dispatchEvent(new CustomEvent('tourit:page', { detail: 'offline' }));
  mode = m;
  confirmDelete = null;
  page().hidden = false;
  renderMode();
  renderList();
  void renderStorage();
}

function closeOffline(): void {
  page().hidden = true;
  mode = 'list';
  clearPreview();
}

async function run(area: SavedArea): Promise<void> {
  const abort = new AbortController();
  job = { areaId: area.id, progress: { done: 0, total: area.tiles, failed: 0, bytes: 0 }, abort };
  renderList();
  updatePreview();
  void requestPersistence();
  let lastRender = 0;
  try {
    await downloadArea(
      area,
      (p) => {
        if (job) job.progress = p;
        if (Date.now() - lastRender > 250) {
          lastRender = Date.now();
          renderList();
        }
      },
      abort.signal,
    );
  } finally {
    job = null;
    renderList();
    updatePreview();
    void renderStorage();
  }
}

function startSave(): void {
  const spec = readForm();
  const { tiles } = estimate(spec);
  if (tiles > MAX_TILES || job) return;
  const area: SavedArea = {
    ...spec,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: spec.name || `Område ${listAreas().length + 1}`,
    createdAt: new Date().toISOString(),
    tiles,
    stored: 0,
    failed: 0,
    bytes: 0,
  };
  putArea(area);
  $<HTMLInputElement>('off-name').value = '';
  mode = 'list';
  renderMode();
  void run(area);
}

async function onListClick(e: Event): Promise<void> {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
  const card = btn?.closest<HTMLElement>('.off-area');
  if (!btn || !card) return;
  const area = listAreas().find((a) => a.id === card.dataset.id);
  if (!area) return;
  switch (btn.dataset.act) {
    case 'show':
      map.fitBounds(L.latLngBounds(area.bounds));
      break;
    case 'resume':
      void run(area);
      break;
    case 'abort':
      job?.abort.abort();
      break;
    case 'delete':
      if (confirmDelete !== area.id) {
        confirmDelete = area.id;
        renderList();
        return;
      }
      confirmDelete = null;
      btn.disabled = true;
      btn.textContent = 'Sletter…';
      await deleteArea(area.id);
      renderList();
      void renderStorage();
      return;
  }
  if (confirmDelete) {
    confirmDelete = null;
    renderList();
  }
}

/* ---------- setup ---------- */

const OfflineControl = L.Control.extend({
  onAdd(): HTMLElement {
    const bar = L.DomUtil.create('div', 'leaflet-bar offctl');
    bar.innerHTML = `<a href="#" role="button" id="ctl-save" title="Lagre område" aria-label="Lagre område">${ICON_SAVE}</a>
      <a href="#" role="button" id="ctl-offline" title="Lagrede områder" aria-label="Lagrede områder">${ICON_DOWNLOADS}<span class="offbadge" hidden></span></a>`;
    L.DomEvent.disableClickPropagation(bar);
    const save = bar.querySelector<HTMLElement>('#ctl-save')!;
    const list = bar.querySelector<HTMLElement>('#ctl-offline')!;
    badge = list.querySelector('.offbadge');
    save.addEventListener('click', (e) => {
      e.preventDefault();
      openOffline('save');
    });
    list.addEventListener('click', (e) => {
      e.preventDefault();
      if (!page().hidden && mode === 'list') closeOffline();
      else openOffline('list');
    });
    return bar;
  },
});

export function initOffline(): void {
  if (!offlineSupported()) return;
  page().innerHTML = `
    <header class="off-head">
      <h2>Lagrede områder</h2>
      <button class="btn" id="off-close" aria-label="Lukk">Lukk</button>
    </header>
    <div class="off-body">
      <button class="btn primary" id="off-new-btn">Lagre nytt område</button>
      <section class="off-new" id="off-new" hidden>
        <p class="desc">Området innenfor den stiplede rammen lagres på denne enheten. Flytt eller zoom kartet for å endre det.</p>
        <label class="off-field"><span>Navn</span><input id="off-name" type="text" maxlength="60" autocomplete="off"></label>
        <label class="off-field"><span>Detaljer til</span>
          <select id="off-maxz">
            <option value="12">zoom 12 · oversikt</option>
            <option value="13">zoom 13</option>
            <option value="14">zoom 14 · tur</option>
            <option value="15">zoom 15 · detaljert</option>
            <option value="16">zoom 16</option>
            <option value="17">zoom 17 · maks</option>
          </select></label>
        <label class="off-check"><input type="checkbox" checked disabled> Kart (Kartverket)</label>
        <label class="off-check"><input type="checkbox" id="off-bratt" checked> Bratthet og utløp (NVE)</label>
        <label class="off-check"><input type="checkbox" id="off-terrain" checked> Terreng for skredlag og himmelretning</label>
        <div class="off-est" id="off-estimate"></div>
        <div class="off-actions"><button class="btn primary" id="off-go">Last ned</button><button class="btn" id="off-cancel">Avbryt</button></div>
      </section>
      <div class="off-list" id="off-list"></div>
      <p class="foot" id="off-storage"></p>
      <p class="foot">Lagrede områder brukes automatisk når du ser på kartet, også uten nett. Skredvarsler og observasjoner hentes fortsatt fra nett.</p>
    </div>`;

  $('off-close').addEventListener('click', closeOffline);
  $('off-new-btn').addEventListener('click', () => openOffline('save'));
  $('off-cancel').addEventListener('click', () => {
    mode = 'list';
    renderMode();
  });
  $('off-go').addEventListener('click', startSave);
  for (const id of ['off-maxz', 'off-bratt', 'off-terrain']) $(id).addEventListener('change', updatePreview);
  $('off-list').addEventListener('click', (e) => void onListClick(e));
  map.on('moveend', updatePreview);
  window.addEventListener('tourit:page', (e) => (e as CustomEvent).detail !== 'offline' && !page().hidden && closeOffline());

  new OfflineControl({ position: 'topright' }).addTo(map);
  renderList();
}
