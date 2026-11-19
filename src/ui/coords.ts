import { toMgrs } from '../domain/mgrs';
import { $ } from '../util';

/**
 * Coordinate chip on the map: MGRS of the picked point or of your own position
 * (live while position is on). Tap the coordinate to copy it.
 */

export type CoordSource = 'pick' | 'position';
let source: CoordSource | null = null;
let current = '';

const COPY_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/></svg>';

export const coordSource = () => source;

export function showCoord(src: CoordSource, lat: number, lng: number, accuracy?: number): void {
  const mgrs = toMgrs(lat, lng);
  const el = $('coord');
  if (!mgrs) {
    clearCoord();
    return;
  }
  source = src;
  current = mgrs;
  el.querySelector('.c-label')!.textContent = src === 'position' ? 'Min posisjon' : 'Valgt punkt';
  el.querySelector('.c-mgrs')!.textContent = mgrs;
  el.querySelector('.c-acc')!.textContent = accuracy != null ? `± ${Math.round(accuracy)} m` : '';
  el.hidden = false;
}

/** Hide the chip; with `src`, only if it currently shows that source. */
export function clearCoord(src?: CoordSource): void {
  if (src && source !== src) return;
  source = null;
  current = '';
  $('coord').hidden = true;
}

async function copy(): Promise<void> {
  if (!current) return;
  const btn = $('coord').querySelector<HTMLElement>('.c-copy')!;
  try {
    await navigator.clipboard.writeText(current);
    btn.dataset.state = 'ok';
    btn.setAttribute('aria-label', 'Kopiert');
  } catch {
    btn.dataset.state = 'err';
    btn.setAttribute('aria-label', 'Kunne ikke kopiere');
  }
  setTimeout(() => {
    delete btn.dataset.state;
    btn.setAttribute('aria-label', 'Kopier MGRS');
  }, 1500);
}

export function initCoords(): void {
  const el = $('coord');
  el.innerHTML = `
    <span class="c-label"></span>
    <button type="button" class="c-copy" aria-label="Kopier MGRS" title="Kopier MGRS">
      <span class="c-sys">MGRS</span><b class="c-mgrs"></b>${COPY_ICON}
    </button>
    <span class="c-acc"></span>
    <button type="button" class="c-close" aria-label="Skjul koordinat" title="Skjul">×</button>`;
  el.querySelector('.c-copy')!.addEventListener('click', () => void copy());
  el.querySelector('.c-close')!.addEventListener('click', () => clearCoord());
}
