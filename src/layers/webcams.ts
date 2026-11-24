import * as L from 'leaflet';
import { WEBCAM_MIN_ZOOM } from '../config';
import { freshImageUrl, siteOk, type WebcamSite } from '../domain/webcams';
import { map } from '../map';
import { esc } from '../util';

/**
 * Webcams (Vegvesen's road cameras plus a few hand-picked ones) as small camera markers, one per site. The toggle
 * adds `webcamLayer`; the markers inside it only show from WEBCAM_MIN_ZOOM.
 * Tapping one opens the latest image; sites with several cameras get a button
 * per direction.
 */
export const webcamLayer = L.layerGroup();
const markers = L.layerGroup();

const ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5h3.2l1.8-2.5h6l1.8 2.5H20V19H4z"/><circle cx="12" cy="13.3" r="3.2"/></svg>';

export function drawWebcams(sites: WebcamSite[]): void {
  markers.clearLayers();
  for (const s of sites) {
    const ok = siteOk(s);
    const m = L.marker([s.lat, s.lng], {
      icon: L.divIcon({ className: '', html: `<div class="cm${ok ? '' : ' off'}">${ICON}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
      title: `Webkamera · ${s.name}${ok ? '' : ' (ute av drift)'}`,
      zIndexOffset: -100, // under the observations
    });
    m.bindPopup(() => popup(s), { maxWidth: 320, autoPanPadding: [16, 16] });
    m.addTo(markers);
  }
}

function syncZoom(): void {
  const show = map.getZoom() >= WEBCAM_MIN_ZOOM;
  if (show && !webcamLayer.hasLayer(markers)) webcamLayer.addLayer(markers);
  else if (!show && webcamLayer.hasLayer(markers)) webcamLayer.removeLayer(markers);
}
map.on('zoomend', syncZoom);
syncZoom();

/** Built fresh on every open, so the image is the latest one. */
function popup(s: WebcamSite): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cam-pop';
  const dirs = s.views.length > 1
    ? `<div class="cam-dirs">${s.views
        .map((v, i) => `<button type="button" class="cam-dir" data-i="${i}">${esc(v.label || `Kamera ${i + 1}`)}</button>`)
        .join('')}</div>`
    : '';
  el.innerHTML =
    `<div class="cam-h"><b>${esc(s.name)}</b>${s.road ? `<span class="cam-road">${esc(s.road)}</span>` : ''}</div>` +
    dirs +
    '<a class="cam-img" target="_blank" rel="noopener" title="Åpne bildet i full størrelse"><img alt=""></a>' +
    '<p class="cam-msg" hidden></p>' +
    `<p class="cam-note">Bildet kan være gammelt, og noen kamera bytter retning mellom bildene. Foto: ${
      s.link ? `<a href="${esc(s.link)}" target="_blank" rel="noopener">${esc(s.credit)}</a>` : esc(s.credit)
    }</p>`;

  const link = el.querySelector<HTMLAnchorElement>('.cam-img')!;
  const img = link.querySelector('img')!;
  const msg = el.querySelector<HTMLElement>('.cam-msg')!;
  const fail = (text: string) => {
    link.hidden = true;
    msg.hidden = false;
    msg.textContent = text;
  };
  img.addEventListener('error', () => fail('Fikk ikke hentet bildet. Prøv igjen om litt.'));

  const show = (i: number) => {
    const v = s.views[i];
    el.querySelectorAll<HTMLButtonElement>('.cam-dir').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.i! === i)));
    if (!v.ok) return fail('Kameraet er ute av drift (meldt av Vegvesen).');
    const url = freshImageUrl(v.url);
    link.href = url;
    link.hidden = false;
    msg.hidden = true;
    img.alt = `Webkamera ${s.name}${v.label ? `, ${v.label.toLowerCase()}` : ''}`;
    img.src = url;
  };
  el.querySelectorAll<HTMLButtonElement>('.cam-dir').forEach((b) => b.addEventListener('click', () => show(+b.dataset.i!)));
  show(Math.max(0, s.views.findIndex((v) => v.ok)));
  return el;
}
