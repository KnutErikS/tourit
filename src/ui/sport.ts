import { state, type Sport } from '../state';
import { $ } from '../util';

/**
 * Ski, surf or climbing. The choice decides which layers, tabs and settings the
 * panel shows: elements marked `data-sport="…"` in index.html (one sport, or
 * several separated by spaces) only show for those sports (CSS keys off
 * `body[data-sport]`); unmarked ones (map, Vær tab, webcams) are shared. Remembered on the device,
 * not put in shared links.
 */

const KEY = 'tourit.sport';
const SPORTS: Sport[] = ['ski', 'surf', 'climb'];

function stored(): Sport {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'surf' || v === 'climb' ? v : 'ski';
  } catch {
    return 'ski';
  }
}

function apply(s: Sport): void {
  state.sport = s;
  document.body.dataset.sport = s;
  for (const k of SPORTS) $(`sport-${k}`).setAttribute('aria-pressed', String(k === s));
}

/** Before the layers are bound, so the other sport's layers never flash on the map. */
export function initSport(onChange: (s: Sport) => void): void {
  apply(stored());
  for (const k of SPORTS)
    $(`sport-${k}`).addEventListener('click', () => {
      if (state.sport === k) return;
      apply(k);
      try {
        localStorage.setItem(KEY, k);
      } catch {
        /* storage unavailable: just don't remember */
      }
      onChange(k);
    });
}
