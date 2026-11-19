import { $ } from '../util';

/**
 * Compass on the right side of the map, shared by 2D and 3D. The rose turns
 * with the map so the red needle always points to north. Clicking it asks the
 * active map to turn back to north (only the 3D map can rotate; 2D is always
 * north-up).
 */

const SVG = `<svg viewBox="0 0 48 48" aria-hidden="true">
  <g class="rose">
    <circle cx="24" cy="24" r="21" class="ring"/>
    ${Array.from({ length: 8 }, (_, k) => {
      const a = (k * 45 * Math.PI) / 180, r1 = 21, r2 = k % 2 ? 18.5 : 17;
      return `<line x1="${24 + r1 * Math.sin(a)}" y1="${24 - r1 * Math.cos(a)}" x2="${24 + r2 * Math.sin(a)}" y2="${24 - r2 * Math.cos(a)}" class="tick"/>`;
    }).join('')}
    <path d="M24 6 L29 24 L19 24 Z" class="north"/>
    <path d="M24 42 L29 24 L19 24 Z" class="south"/>
    <circle cx="24" cy="24" r="2.2" class="hub"/>
    <text x="24" y="16.5" text-anchor="middle" class="n">N</text>
  </g>
</svg>`;

let bearing = 0;
let canRotate = false;

function update(): void {
  const el = $('compass');
  el.querySelector<SVGGElement>('.rose')!.style.transform = `rotate(${-bearing}deg)`;
  const north = Math.abs(((bearing % 360) + 360) % 360) < 0.5;
  el.classList.toggle('rotated', !north);
  const label = !canRotate
    ? 'Kompass: kartet vender mot nord'
    : north
      ? 'Kompass: kartet vender mot nord'
      : 'Kompass: trykk for å snu kartet mot nord';
  el.title = label;
  el.setAttribute('aria-label', label);
}

/** Map bearing in degrees clockwise from north (0 = north-up). */
export function setCompassBearing(b: number, rotatable: boolean): void {
  bearing = b;
  canRotate = rotatable;
  update();
}

const PHONE = window.matchMedia('(max-width: 640px)');

/**
 * On phones, place the compass right under `anchorSelector` (the 3D button),
 * measured from the live layout so it follows the map buttons above it.
 * On larger screens the CSS position (bottom right) is used.
 */
function placeCompass(anchorSelector: string): void {
  const el = $('compass');
  const anchor = document.querySelector(anchorSelector);
  if (!PHONE.matches || !anchor) {
    el.style.top = el.style.right = '';
    return;
  }
  const r = anchor.getBoundingClientRect();
  if (!r.height) return; // not laid out yet
  const gap = 10;
  el.style.top = `${Math.round(r.bottom + gap)}px`;
  // Centre the compass under the button.
  el.style.right = `${Math.round(window.innerWidth - (r.left + r.right) / 2 - el.offsetWidth / 2)}px`;
}

export function initCompass(onResetNorth: () => void, anchorSelector: string): void {
  const el = $('compass');
  el.innerHTML = SVG;
  el.addEventListener('click', () => onResetNorth());
  update();
  const place = () => placeCompass(anchorSelector);
  requestAnimationFrame(place);
  window.addEventListener('resize', place);
  PHONE.addEventListener('change', place);
}
