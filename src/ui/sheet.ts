import { $ } from '../util';

/**
 * Phones: the side panel is a bottom sheet you can drag by its header.
 *
 *   peek  – a thin strip with the grab bar: the map gets almost the whole screen
 *   half  – 55 % of the screen
 *   full  – fullscreen
 *   hide  – flicked down from peek: hides the panel (burger brings it back)
 *
 * Dragging snaps to the nearest size; a flick goes one step up or down.
 * Tapping the grab bar goes peek → half → full → half. Buttons, inputs and tabs in the header keep working; only the
 * header's empty areas and the grab bar drag. Peek or half is remembered
 * between visits. On larger screens nothing here is active.
 */

export const PHONE = window.matchMedia('(max-width: 640px)');
type Snap = 'peek' | 'half' | 'full';
const SNAP_KEY = 'tourit.sheet';
let snap: Snap = 'half';
/** Peek height in px (above the home-indicator inset, which the panel's padding adds). */
const PEEK_H = 30;

const LABEL: Record<Snap, string> = {
  peek: 'Vis mer av panelet',
  half: 'Vis panelet i fullskjerm',
  full: 'Gjør panelet mindre',
};
const NEXT: Record<Snap, Snap> = { peek: 'half', half: 'full', full: 'half' };

/** Height the sheet can grow to: the page (body), which is taller than innerHeight in the iPhone Home Screen app. */
const pageHeight = () => document.body.clientHeight;

function apply(s: Snap): void {
  snap = s;
  const p = $('panel');
  p.classList.toggle('sheet-full', s === 'full');
  p.classList.toggle('sheet-peek', s === 'peek');
  // Peek: a pixel height, so it animates.
  p.style.height = s === 'peek' && PHONE.matches ? `${PEEK_H}px` : '';
  const g = $('grabber');
  g.setAttribute('aria-expanded', String(s !== 'peek'));
  g.setAttribute('aria-label', LABEL[s]);
  g.title = LABEL[s];
  if (s !== 'full') {
    try {
      localStorage.setItem(SNAP_KEY, s);
    } catch {
      /* not remembered */
    }
  }
}

/** Fullscreen → half, so the map shows again (e.g. after a search). Peek and half stay. */
export function resetSheet(): void {
  if (snap === 'full') apply('half');
}

/** Back to half, without remembering it (the panel is being hidden; the burger reopens it at half). */
export function halfSheet(): void {
  const keep = snap;
  apply('half');
  try {
    localStorage.setItem(SNAP_KEY, keep === 'full' ? 'half' : keep);
  } catch {
    /* ignore */
  }
}

/** Peek → half, so the content shows (e.g. a tab was picked). */
export function expandSheet(): void {
  if (snap === 'peek') apply('half');
}

export function initSheet(onHide: () => void): void {
  const p = $('panel');
  const header = p.querySelector('header')!;
  const grab = $('grabber');

  let dragging = false, moved = false, fromGrabber = false;
  let startY = 0, startH = 0, startSnap: Snap = 'half'; // startH: content height (style.height), without the bottom inset padding
  let lastY = 0, lastT = 0, velocity = 0; // px per ms, positive = downwards

  header.addEventListener('pointerdown', (e) => {
    if (!PHONE.matches || e.button > 0) return;
    const t = e.target as HTMLElement;
    fromGrabber = !!t.closest('#grabber');
    if (!fromGrabber && t.closest('button, input, select, a, label, [role="tab"], .search')) return;
    dragging = true;
    moved = false;
    startY = lastY = e.clientY;
    lastT = e.timeStamp;
    velocity = 0;
    startH = p.getBoundingClientRect().height - parseFloat(getComputedStyle(p).paddingBottom);
    startSnap = snap;
    header.setPointerCapture(e.pointerId);
    p.classList.add('sheet-dragging');
  });

  header.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > 5) moved = true;
    const dt = e.timeStamp - lastT;
    if (dt > 0) velocity = 0.7 * velocity + 0.3 * ((e.clientY - lastY) / dt);
    lastY = e.clientY;
    lastT = e.timeStamp;
    if (moved) {
      // While dragging, the content shows under the header even if it started at peek.
      p.classList.remove('sheet-peek');
      p.style.height = `${Math.max(0, Math.min(pageHeight(), startH - dy))}px`;
    }
  });

  const end = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    p.classList.remove('sheet-dragging');
    if (header.hasPointerCapture(e.pointerId)) header.releasePointerCapture(e.pointerId);

    if (!moved) {
      if (fromGrabber && e.type === 'pointerup') apply(NEXT[snap]);
      return;
    }
    const H = pageHeight();
    const h = p.getBoundingClientRect().height;
    const peekH = PEEK_H, halfH = H * 0.55;
    let target: Snap | 'hide';
    if (velocity < -0.5) target = startSnap === 'peek' ? 'half' : 'full';
    else if (velocity > 0.5) target = startSnap === 'full' ? 'half' : startSnap === 'half' ? 'peek' : 'hide';
    else target = h > (halfH + H) / 2 ? 'full' : h > (peekH + halfH) / 2 ? 'half' : h > peekH * 0.6 ? 'peek' : 'hide';

    if (target === 'hide') {
      onHide(); // main.ts puts the sheet back to half, for when the burger brings it back
    } else apply(target);
  };
  header.addEventListener('pointerup', end);
  header.addEventListener('pointercancel', end);

  // Keyboard: Enter/Space on the grab bar (a click with detail 0) steps the size.
  grab.addEventListener('click', (e) => {
    if (e.detail === 0) apply(NEXT[snap]);
  });

  let start: Snap = 'half';
  try {
    if (localStorage.getItem(SNAP_KEY) === 'peek') start = 'peek';
  } catch {
    /* ignore */
  }
  PHONE.addEventListener('change', () => apply(start === 'peek' && PHONE.matches ? 'peek' : 'half'));
  apply(start);
}
