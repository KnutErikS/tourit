import * as L from 'leaflet';
import { map } from '../map';

/** Width of the column of map buttons on the right, px. */
const RIGHT_BUTTONS = 64;

/**
 * Before a marker's popup opens: make it narrow enough to fit beside the map
 * buttons on a phone, and pan it clear of the panel (the side panel covers the
 * map's left side on PC, the bottom sheet its lower part on phones) and of the
 * buttons down the right edge. Register it on 'click' before bindPopup, so it
 * runs before the popup opens and pans the map. Used by the surf and crag markers.
 */
export function placePopupClearOfPanel(marker: L.Marker): void {
  const popup = marker.getPopup();
  const panel = document.getElementById('panel');
  if (!popup) return;
  let left = 0, bottom = 0;
  if (panel && !panel.hidden) {
    const box = map.getContainer().getBoundingClientRect(), r = panel.getBoundingClientRect();
    if (r.width < box.width * 0.9) left = Math.max(0, r.right - box.left);
    else bottom = Math.max(0, box.bottom - r.top);
  }
  // 24 px is the popup's own margin.
  popup.options.maxWidth = Math.max(240, Math.min(300, map.getSize().x - left - RIGHT_BUTTONS - 16 - 24));
  popup.options.autoPanPaddingTopLeft = L.point(left + 16, 16);
  popup.options.autoPanPaddingBottomRight = L.point(RIGHT_BUTTONS, bottom + 16);
}
