import { toMgrs } from '../domain/mgrs';
import { $ } from '../util';

/**
 * Coordinate chip on the map: the picked point (terrain facts + MGRS) or your own
 * position (live while position is on). The MGRS starts folded to a small button;
 * tapping it reveals the full grid reference and copies it.
 */

export type CoordSource = 'pick' | 'position';
let source: CoordSource | null = null;
let current = '';

const COPY_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/></svg>';

export const coordSource = () => source;

/**
 * Show the chip. `info` is trusted HTML (terrain facts) shown before the MGRS button.
 * A new picked point, or switching source, folds the MGRS again; live position updates keep it as is.
 */
export function showCoord(src: CoordSource, lat: number, lng: number, accuracy?: number, info = ''): void {
  const mgrs = toMgrs(lat, lng);
  const el = $('coord');
  if (!mgrs) {
    clearCoord();
    return;
  }
  const fresh = src === 'pick' || src !== source;
  if (fresh) setOpen(false);
  source = src;
  current = mgrs;
  el.querySelector('.c-label')!.textContent = src === 'position' ? 'Min posisjon' : 'Valgt punkt';
  el.querySelector('.c-mgrs')!.textContent = mgrs;
  el.querySelector('.c-acc')!.textContent = accuracy != null ? `± ${Math.round(accuracy)} m` : '';
  // The verdict (ui/pointChip.ts) is only for a picked point, and a new point starts without one.
  if (fresh) setCoordVerdict('');
  setCoordInfo(info);
  el.hidden = false;
}

/** Replace the terrain facts (e.g. once the terrain at the picked point has loaded). */
export function setCoordInfo(html: string): void {
  $('coord').querySelector('.c-info')!.innerHTML = html;
}

/**
 * The answer for the picked point (danger level, problem hit, Stop or Go) as trusted HTML;
 * '' hides it. Tapping it opens the warning.
 */
export function setCoordVerdict(html: string): void {
  const v = $('coord').querySelector<HTMLElement>('.c-verdict')!;
  v.innerHTML = html;
  v.hidden = !html;
  $('coord').classList.toggle('has-verdict', !!html);
}

function setOpen(open: boolean): void {
  const box = $('coord');
  const btn = box.querySelector<HTMLElement>('.c-copy')!;
  box.classList.toggle('open', open);
  btn.title = open ? 'Kopier MGRS' : 'Vis og kopier MGRS';
}

/** Hide the chip; with `src`, only if it currently shows that source. */
export function clearCoord(src?: CoordSource): void {
  if (src && source !== src) return;
  source = null;
  current = '';
  $('coord').hidden = true;
}

/** Older copy method, for browsers/webviews where the Clipboard API is blocked. */
export function legacyCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

async function copy(): Promise<void> {
  if (!current) return;
  setOpen(true);
  const box = $('coord');
  const btn = box.querySelector<HTMLElement>('.c-copy')!;
  let ok = false;
  try {
    await navigator.clipboard.writeText(current);
    ok = true;
  } catch {
    ok = legacyCopy(current);
  }
  if (ok) {
    btn.dataset.state = 'ok';
    btn.setAttribute('aria-label', 'Kopiert');
  } else {
    // Last resort: select the coordinate so it can be copied by hand.
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(box.querySelector('.c-mgrs')!);
    sel?.removeAllRanges();
    sel?.addRange(range);
    btn.dataset.state = 'err';
    btn.setAttribute('aria-label', 'Kunne ikke kopiere – teksten er markert');
  }
  setTimeout(() => {
    delete btn.dataset.state;
    btn.setAttribute('aria-label', 'Kopier MGRS');
  }, 1500);
}

/** `onVerdict`: tap on the verdict (opens the warning for the point). */
export function initCoords(onVerdict: () => void): void {
  const el = $('coord');
  el.innerHTML = `
    <button type="button" class="c-verdict" title="Åpne skredvarselet for punktet" hidden></button>
    <span class="c-label"></span>
    <span class="c-info"></span>
    <button type="button" class="c-copy" aria-label="Kopier MGRS" title="Vis og kopier MGRS">
      <span class="c-sys">MGRS</span><b class="c-mgrs"></b>${COPY_ICON}
    </button>
    <span class="c-acc"></span>
    <button type="button" class="c-close" aria-label="Skjul koordinat" title="Skjul">×</button>`;
  el.querySelector('.c-copy')!.addEventListener('click', () => void copy());
  el.querySelector('.c-close')!.addEventListener('click', () => clearCoord());
  el.querySelector('.c-verdict')!.addEventListener('click', onVerdict);
}
