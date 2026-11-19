import * as L from 'leaflet';
import { DANGER, DNAME } from '../config';
import { map } from '../map';
import { state } from '../state';
import type { Region } from '../types';
import { esc } from '../util';

/** Forecast region polygons, filled by danger level. */
export const regionGroup = L.layerGroup();

function regionStyle(r: Region): L.PathOptions {
  const lvl = r.warn ? r.warn.level : 0;
  const z = map.getZoom();
  const sel = state.selected === r;
  return {
    pane: 'regions',
    color: sel ? '#0b1220' : lvl ? DANGER[lvl] : '#7d8894',
    weight: sel ? 3 : lvl ? 1.5 : 1,
    dashArray: r.type === 'B' ? '4 4' : undefined,
    fillColor: DANGER[lvl],
    // Nearly transparent once the terrain layer takes over.
    fillOpacity: lvl ? (z >= 10 ? 0.04 : 0.38) : 0.06,
    opacity: 0.9,
  };
}

export function drawRegions(regions: Region[]): void {
  regionGroup.clearLayers();
  for (const r of regions) {
    r.poly = L.polygon(r.rings, regionStyle(r)).addTo(regionGroup);
    r.poly.bindTooltip(
      () => `${esc(r.name)} · ${r.warn ? r.warn.level + ' ' + DNAME[r.warn.level] : 'ikke vurdert'}`,
      { sticky: true },
    );
  }
}

export function restyleRegions(): void {
  state.regions.forEach((r) => r.poly?.setStyle(regionStyle(r)));
}
