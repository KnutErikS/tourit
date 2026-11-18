import * as L from 'leaflet';
import { KIND_LABEL, images, obsKind } from '../domain/observations';
import { map } from '../map';
import type { ObsKind, RegobsObs } from '../types';
import { popupHTML, obsTime } from '../ui/obsHtml';

/** Regobs observations as coloured dots. */
export const obsGroup = L.layerGroup();
const markers = new Map<number, L.Marker>();

const Z_ORDER: Record<ObsKind, number> = { obs: 0, tegn: 1, skred: 2 };

export function drawObservations(obs: RegobsObs[]): void {
  obsGroup.clearLayers();
  markers.clear();
  obs
    .slice()
    .sort((a, b) => Z_ORDER[obsKind(a)] - Z_ORDER[obsKind(b)])
    .forEach((o) => {
      const loc = o.ObsLocation;
      if (!loc || !Number.isFinite(loc.Latitude) || !Number.isFinite(loc.Longitude)) return;
      const k = obsKind(o), hasImg = images(o).length > 0;
      const m = L.marker([loc.Latitude!, loc.Longitude!], {
        icon: L.divIcon({ className: '', html: `<div class="om ${k}${hasImg ? ' img' : ''}"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] }),
        zIndexOffset: Z_ORDER[k] * 100, // avalanches on top
        title: `${KIND_LABEL[k]} · ${obsTime(o)}`,
      });
      m.bindPopup(() => popupHTML(o), { maxWidth: 320 });
      m.addTo(obsGroup);
      markers.set(o.RegId, m);
    });
}

/** Zoom to an observation and open its popup (used by the list in the warning tab). */
export function focusObservation(regId: number, ensureVisible: () => void): void {
  const m = markers.get(regId);
  if (!m) return;
  ensureVisible();
  map.setView(m.getLatLng(), Math.max(map.getZoom(), 12));
  m.openPopup();
}
