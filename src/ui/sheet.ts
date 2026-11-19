import { $ } from '../util';

/**
 * Phones: the side panel is a bottom sheet you can drag by its header.
 *
 *   half  – default, 55 % of the screen
 *   full  – fullscreen
 *   hide  – dragged/flicked down from half: hides the panel (burger brings it back)
 *
 * Tapping the grab bar toggles half ⇄ full. Buttons, inputs and tabs in the
 * header keep working; only the header's empty areas and the grab bar drag.
 * On larger screens nothing here is active.
 */

const PHONE = window.matchMedia('(max-width: 640px)');
type Snap = 'half' | 'full';
let snap: Snap = 'half';

function apply(s: Snap): void {
  snap = s;
  const p = $('panel');
  p.style.height = '';
  p.classList.toggle('sheet-full', s === 'full');
  const g = $('grabber');
  const label = s === 'full' ? 'Gjør panelet mindre' : 'Vis panelet i fullskjerm';
  g.setAttribute('aria-expanded', String(s === 'full'));
  g.setAttribute('aria-label', label);
  g.title = label;
}

/** Back to the default size (e.g. when the panel is hidden and shown again). */
export function resetSheet(): void {
  apply('half');
}

export function initSheet(onHide: () => void): void {
  const p = $('panel');
  const header = p.querySelector('header')!;
  const grab = $('grabber');

  let dragging = false, moved = false, fromGrabber = false;
  let startY = 0, startH = 0, startSnap: Snap = 'half';
  let lastY = 0, lastT = 0, velocity = 0; // px per ms, positive = downwards

  header.addEventListener('pointerdown', (e) => {
    if (!PHONE.matches || e.button > 0) return;
    const t = e.target as HTMLElement;
    fromGrabber = !!t.closest('#grabber');
    if (!fromGrabber && t.closest('button, input, select, a, label, [role="tab"]')) return;
    dragging = true;
    moved = false;
    startY = lastY = e.clientY;
    lastT = e.timeStamp;
    velocity = 0;
    startH = p.getBoundingClientRect().height;
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
    if (moved) p.style.height = `${Math.max(64, Math.min(window.innerHeight, startH - dy))}px`;
  });

  const end = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    p.classList.remove('sheet-dragging');
    if (header.hasPointerCapture(e.pointerId)) header.releasePointerCapture(e.pointerId);

    if (!moved) {
      if (fromGrabber && e.type === 'pointerup') apply(snap === 'full' ? 'half' : 'full');
      return;
    }
    const H = window.innerHeight;
    const h = p.getBoundingClientRect().height;
    let target: Snap | 'hide';
    if (velocity < -0.5) target = 'full';
    else if (velocity > 0.5) target = startSnap === 'full' ? 'half' : 'hide';
    else target = h > H * 0.75 ? 'full' : h < H * 0.3 ? 'hide' : 'half';

    if (target === 'hide') {
      apply('half');
      onHide();
    } else apply(target);
  };
  header.addEventListener('pointerup', end);
  header.addEventListener('pointercancel', end);

  // Keyboard: Enter/Space on the grab bar (a click with detail 0) toggles the size.
  grab.addEventListener('click', (e) => {
    if (e.detail === 0) apply(snap === 'full' ? 'half' : 'full');
  });

  PHONE.addEventListener('change', () => apply('half'));
  apply('half');
}
