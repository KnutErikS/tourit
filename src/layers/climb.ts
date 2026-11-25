import * as L from 'leaflet';
import type { ClimbRating } from '../domain/climb';
import type { Crag } from '../domain/crags';
import { map } from '../map';

/**
 * Climbing crags as small rounded squares: coloured by the climbing rating once
 * the weather for the crag is in (crags in the current view), grey before.
 * Always on the map while climbing is chosen (main.ts adds and removes the layer).
 * Tapping one opens a popup (built by ui/climb.ts). Markers are made once and only
 * get a new icon when their rating changes, so an open popup stays open.
 */
export const climbLayer = L.layerGroup();

export interface ClimbMarker {
  crag: Crag;
  rating: ClimbRating | null;
}

const markers = new Map<string, { marker: L.Marker; html: string }>();
const icon = (html: string) => L.divIcon({ className: 'cg-hit', html, iconSize: [28, 28], iconAnchor: [14, 14] });
/** Width of the column of map buttons on the right, px. */
const RIGHT_BUTTONS = 64;

/** Draw the crags in `items`; markers for crags no longer in it are removed (style filter). */
export function drawClimbMarkers(items: ClimbMarker[], selected: string | null, popup: (crag: Crag) => HTMLElement): void {
  const keep = new Set<string>();
  for (const { crag, rating } of items) {
    keep.add(crag.id);
    const sel = crag.id === selected;
    const html = `<div class="cg sc${rating ? rating.score : -1}${sel ? ' sel' : ''}">${rating ? `<b>${rating.score}</b>` : ''}</div>`;
    const known = markers.get(crag.id);
    if (!known) {
      const marker = L.marker([crag.lat, crag.lng], { icon: icon(html), title: crag.name, alt: crag.name, bubblingMouseEvents: false, zIndexOffset: sel ? 500 : 0 });
      marker.on('click', () => clearOfPanel(marker)); // before bindPopup: runs before the popup pans the map
      marker.bindPopup(() => popup(crag), { maxWidth: 300, autoPanPadding: [16, 16] });
      marker.addTo(climbLayer);
      markers.set(crag.id, { marker, html });
    } else if (known.html !== html) {
      known.marker.setIcon(icon(html));
      known.marker.setZIndexOffset(sel ? 500 : 0);
      known.html = html;
    }
  }
  for (const [id, { marker }] of markers) {
    if (keep.has(id)) continue;
    marker.remove();
    markers.delete(id);
  }
}

/** Pan the popup clear of the side panel (PC), the bottom sheet (phone) and the map buttons. */
function clearOfPanel(marker: L.Marker): void {
  const popup = marker.getPopup();
  const panel = document.getElementById('panel');
  if (!popup) return;
  let left = 0, bottom = 0;
  if (panel && !panel.hidden) {
    const box = map.getContainer().getBoundingClientRect(), r = panel.getBoundingClientRect();
    if (r.width < box.width * 0.9) left = Math.max(0, r.right - box.left);
    else bottom = Math.max(0, box.bottom - r.top);
  }
  popup.options.maxWidth = Math.max(240, Math.min(300, map.getSize().x - left - RIGHT_BUTTONS - 16 - 24));
  popup.options.autoPanPaddingTopLeft = L.point(left + 16, 16);
  popup.options.autoPanPaddingBottomRight = L.point(RIGHT_BUTTONS, bottom + 16);
}

export function closeClimbPopup(): void {
  map.closePopup();
}
