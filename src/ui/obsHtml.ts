import { KIND_LABEL, images, obsKind } from '../domain/observations';
import type { RegobsObs } from '../types';
import { esc } from '../util';

export const obsTime = (o: RegobsObs): string =>
  new Date(o.DtObsTime).toLocaleString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Flatten Regobs' nested summary values into a readable string. */
function genericValue(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(genericValue).filter(Boolean).join('; ');
  if (typeof v === 'object') return Object.values(v).map(genericValue).filter(Boolean).join(', ');
  return '';
}

export function obsSummary(o: RegobsObs, max = 99): string {
  const rows: [string, string][] = [];
  (o.Summaries ?? []).forEach((sm) =>
    (sm.Summaries ?? []).forEach((g) => {
      const v = genericValue(g.Value);
      if (v) rows.push([g.Header || sm.RegistrationName || '', v]);
    }),
  );
  return rows
    .slice(0, max)
    .map(([h, v]) => `<div><span>${esc(h)}:</span> ${esc(v.length > 220 ? v.slice(0, 217) + '…' : v)}</div>`)
    .join('');
}

export function thumbsHTML(o: RegobsObs, n = 6): string {
  const imgs = images(o).slice(0, n);
  if (!imgs.length) return '';
  return (
    `<div class="thumbs">` +
    imgs
      .map((a) => {
        const f = a.UrlFormats ?? {};
        const big = f.Large || f.Original || a.Url;
        const th = f.Thumbnail || f.Medium || a.Url;
        const cap = [a.RegistrationName, a.Comment, a.Photographer && '© ' + a.Photographer].filter(Boolean).join(' · ');
        return `<a href="${esc(big)}" target="_blank" rel="noopener" title="${esc(cap)}"><img src="${esc(th)}" alt="${esc(cap || 'Bilde fra Regobs')}" loading="lazy"></a>`;
      })
      .join('') +
    `</div>`
  );
}

export function obsHead(o: RegobsObs): string {
  const loc = o.ObsLocation ?? {}, k = obsKind(o);
  const place = loc.Title || loc.LocationName || loc.MunicipalName || '';
  const who = o.Observer
    ? (o.Observer.NickName ?? '') +
      (o.Observer.CompetenceLevelName ? ` (${o.Observer.CompetenceLevelName.replace(/\s*\(.*\)/, '')})` : '')
    : '';
  return `<div class="ob-h"><span><b>${esc(obsTime(o))}</b>${place ? ' · ' + esc(place) : ''}${loc.Height ? ' · ' + loc.Height + ' moh.' : ''}</span><span class="ob-tag ${k}">${KIND_LABEL[k]}</span></div>
    ${who ? `<div class="ob-h"><span>${esc(who)}</span></div>` : ''}`;
}

export function popupHTML(o: RegobsObs): string {
  return `${obsHead(o)}<div class="ob-sum" style="margin:6px 0">${obsSummary(o, 8)}</div>${thumbsHTML(o, 8)}
    <div style="margin-top:6px"><a class="pop-link" href="https://www.regobs.no/registration/${o.RegId}" target="_blank" rel="noopener">Åpne i Regobs ↗</a></div>`;
}

const LIST_MAX = 25;

export function obsListHTML(list: RegobsObs[]): string {
  if (!list.length) return '<p class="empty">Ingen snøobservasjoner fra Regobs i regionen de siste tre døgnene.</p>';
  return (
    `<div class="obslist">` +
    list
      .slice(0, LIST_MAX)
      .map((o) => `<div class="ob" tabindex="0" data-regid="${o.RegId}">${obsHead(o)}<div class="ob-sum">${obsSummary(o, 3)}</div>${thumbsHTML(o, 6)}</div>`)
      .join('') +
    (list.length > LIST_MAX ? `<p class="empty">Viser ${LIST_MAX} av ${list.length}. Resten ligger som prikker i kartet.</p>` : '') +
    `</div>`
  );
}

/** Make list items clickable / Enter-able. Links inside (images) keep their default behaviour. */
export function wireObsList(root: HTMLElement, onOpen: (regId: number) => void): void {
  root.querySelectorAll<HTMLElement>('.ob[data-regid]').forEach((el) => {
    const open = (e: Event) => {
      if ((e.target as HTMLElement).closest('a')) return;
      onOpen(Number(el.dataset.regid));
    };
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') open(e);
    });
  });
}
