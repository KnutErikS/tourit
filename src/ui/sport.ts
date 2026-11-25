import { state, type Sport } from '../state';
import { $ } from '../util';

/**
 * Ski or surf. The choice decides which layers, tabs and settings the panel
 * shows: elements marked `data-sport="ski"` or `data-sport="surf"` in
 * index.html only show for their sport (CSS keys off `body[data-sport]`);
 * unmarked ones (map, Vær tab, webcams) are shared. Remembered on the device,
 * not put in shared links.
 */

const KEY = 'tourit.sport';
const SPORTS: Sport[] = ['ski', 'surf'];

function stored(): Sport {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'surf' ? 'surf' : 'ski';
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
