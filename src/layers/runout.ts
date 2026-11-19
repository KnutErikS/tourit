import { BRATT_TILE_URL, BRATT_UTLOP_TILE_URL, RUNOUT, type RunoutClass } from '../config';
import { esc } from '../util';
import { steepnessLayer } from './steepness';

/**
 * Runout areas, as an option on the steepness layer. NVE serves the steepness
 * map with and without runout as two tile caches with the same steepness
 * colours, so turning runout on just swaps the tile URL: no extra layer on top.
 */

let shown = false;

/** Show the steepness map with or without the runout bands. */
export function setRunout(on: boolean): void {
  if (on === shown) return;
  shown = on;
  steepnessLayer.setUrl(on ? BRATT_UTLOP_TILE_URL : BRATT_TILE_URL);
}

const CLASSES = Object.keys(RUNOUT) as RunoutClass[];

/** The three blues, with how many avalanches go beyond each. */
export function renderRunoutLegend(el: HTMLElement): void {
  el.innerHTML = CLASSES.map((k) => {
    const c = RUNOUT[k];
    return `<span title="${esc(c.share)}"><i class="sw" style="background:rgb(${c.rgb.join(',')})"></i>${esc(c.label)}</span>`;
  }).join('');
}
