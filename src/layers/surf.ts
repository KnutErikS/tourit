import * as L from 'leaflet';
import type { SurfRating } from '../domain/surf';
import type { SurfSpot } from '../domain/surfSpots';
import { map } from '../map';

/**
 * Surf spots as round badges coloured by the rating for the time shown in the
 * Surf tab, with the estimated wave height inside. Always on the map while surf
 * is chosen (main.ts adds and removes the layer), at every zoom: there are few.
 * Tapping one opens a popup with the spot's waves and wind (built by ui/surf.ts).
 *
 * Markers are made once and only get a new icon when their rating changes, so a
 * popup that is open stays open when the data or the date changes.
 */
export const surfLayer = L.layerGroup();

export interface SurfMarker {
  spot: SurfSpot;
  rating: SurfRating | null;
}

const r1 = (x: number) => (x < 10 ? x.toFixed(1).replace('.', ',') : String(Math.round(x)));
const markers = new Map<string, { marker: L.Marker; html: string }>();

const icon = (html: string) => L.divIcon({ className: 'sm-hit', html, iconSize: [34, 34], iconAnchor: [17, 17] });

export function drawSurfMarkers(items: SurfMarker[], selected: string | null, popup: (spot: SurfSpot) => HTMLElement): void {
  for (const { spot, rating } of items) {
    const score = rating?.score ?? -1;
    // Under 0.3 m counts as flat (domain/surf.ts): 0 rather than a precise-looking "0,1".
    const text = rating?.size == null ? '–' : rating.size < 0.3 ? '0' : r1(rating.size);
    const sel = spot.id === selected;
    const html = `<div class="sm sc${score}${sel ? ' sel' : ''}"><b>${text}</b></div>`;
    const title = `${spot.name}${rating?.size != null ? ` · ca. ${text} m` : ''}`;
    const known = markers.get(spot.id);
    if (!known) {
      const marker = L.marker([spot.lat, spot.lng], { icon: icon(html), title, alt: spot.name, bubblingMouseEvents: false, zIndexOffset: sel ? 500 : 0 });
      // Before bindPopup, so it runs before the popup opens and pans the map.
      marker.on('click', () => clearOfPanel(marker));
      // Built on every open, so it shows the time and data of that moment.
      marker.bindPopup(() => popup(spot), { maxWidth: 300, autoPanPadding: [16, 16] });
      marker.addTo(surfLayer);
      markers.set(spot.id, { marker, html });
    } else if (known.html !== html) {
      known.marker.options.title = title;
      known.marker.setIcon(icon(html));
      known.marker.setZIndexOffset(sel ? 500 : 0);
      known.html = html;
    }
  }
}

/**
 * Pan the popup clear of the panel (the side panel on PC covers the map's left
 * side, the bottom sheet on phones its lower part) and of the map buttons.
 */
/** Width of the column of map buttons on the right, px. */
const RIGHT_BUTTONS = 64;

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
  popup.options.autoPanPaddingTopLeft = L.point(left + 16, 16);
  // Narrow enough to fit beside the map buttons on a phone (24 px is the popup's own margin).
  popup.options.maxWidth = Math.max(240, Math.min(300, map.getSize().x - left - RIGHT_BUTTONS - 16 - 24));
  // The map buttons run down the right edge.
  popup.options.autoPanPaddingBottomRight = L.point(RIGHT_BUTTONS, bottom + 16);
}

/** Close the popup of a spot, if it is open (its content is then out of date). */
export function closeSurfPopup(): void {
  for (const { marker } of markers.values()) marker.closePopup();
}
