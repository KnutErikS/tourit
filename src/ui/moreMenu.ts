import * as L from 'leaflet';
import { map } from '../map';

/**
 * Touch screens: bigger map buttons (44 px, Apple's minimum), no +/− (pinch
 * zooms), and the less used buttons — save area, saved areas, share link —
 * folded into a "⋯" menu at the bottom of the column, with text labels.
 * The buttons are moved as they are, so their own click handlers and badges
 * keep working. With a mouse nothing changes.
 */

const COARSE = window.matchMedia('(pointer: coarse)');
const ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
const LABEL = 'Flere valg';

export function initMoreMenu(): void {
  if (!COARSE.matches) return;
  document.body.classList.add('touch-ctl');
  const corner = document.querySelector('.leaflet-top.leaflet-right');
  const bars = [...(corner?.querySelectorAll<HTMLElement>(':scope > .offctl:not(.rtctl), :scope > .sharectl') ?? [])];
  if (!bars.length) return;

  let btn: HTMLAnchorElement, menu: HTMLElement;
  let isOpen = false;
  const setOpen = (open: boolean) => {
    isOpen = open;
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    btn.classList.toggle('on', open);
  };

  const MoreControl = L.Control.extend({
    onAdd(): HTMLElement {
      const bar = L.DomUtil.create('div', 'leaflet-bar morectl');
      bar.innerHTML = `<a href="#" role="button" aria-haspopup="menu" aria-expanded="false" aria-label="${LABEL}" title="${LABEL}">${ICON}</a>
        <div class="more-menu" role="menu" aria-label="${LABEL}" hidden></div>`;
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.disableScrollPropagation(bar);
      btn = bar.querySelector('a')!;
      menu = bar.querySelector('.more-menu')!;
      for (const b of bars) {
        b.querySelectorAll('a').forEach((a) => a.setAttribute('role', 'menuitem'));
        menu.appendChild(b);
      }
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        setOpen(!isOpen);
      });
      // A choice closes the menu (after the button's own handler has run).
      menu.addEventListener('click', (e) => {
        if ((e.target as Element).closest('a')) setTimeout(() => setOpen(false));
      });
      return bar;
    },
  });
  new MoreControl({ position: 'topright' }).addTo(map);

  document.addEventListener('pointerdown', (e) => {
    if (isOpen && !(e.target as Element).closest('.morectl')) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) {
      setOpen(false);
      btn.focus();
    }
  });
  map.on('movestart', () => isOpen && setOpen(false));
}
