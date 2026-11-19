import * as L from 'leaflet';
import { map } from '../map';
import { saveView, shareUrl } from '../viewState';
import { legacyCopy } from './coords';

/**
 * "Del kartvisning": shares a link to the current view (position, zoom, layers,
 * date). Phones get the system share sheet; elsewhere the link is copied.
 */

const ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>';
const LABEL = 'Del lenke til kartvisningen';

async function share(btn: HTMLAnchorElement): Promise<void> {
  saveView();
  const url = shareUrl();
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title: document.title, url });
      return;
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return; // user closed the sheet
    }
  }
  let ok = false;
  try {
    await navigator.clipboard.writeText(url);
    ok = true;
  } catch {
    ok = legacyCopy(url);
  }
  if (!ok) {
    window.prompt('Kopier lenken:', url);
    return;
  }
  btn.classList.add('follow');
  btn.title = 'Lenke kopiert';
  btn.setAttribute('aria-label', 'Lenke kopiert');
  setTimeout(() => {
    btn.classList.remove('follow');
    btn.title = LABEL;
    btn.setAttribute('aria-label', LABEL);
  }, 1500);
}

const ShareControl = L.Control.extend({
  onAdd(): HTMLElement {
    // Reuses the locate button's look (.locctl).
    const bar = L.DomUtil.create('div', 'leaflet-bar locctl sharectl');
    bar.innerHTML = `<a href="#" role="button" title="${LABEL}" aria-label="${LABEL}">${ICON}</a>`;
    L.DomEvent.disableClickPropagation(bar);
    const btn = bar.querySelector('a')!;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      void share(btn);
    });
    return bar;
  },
});

export function initShare(): void {
  new ShareControl({ position: 'topright' }).addTo(map);
}
