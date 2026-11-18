import * as L from 'leaflet';
import { BRATT_MAX_NATIVE, BRATT_TILE_URL, BRATT_URL } from '../config';
import { esc } from '../util';

/** NVE's official steepness map (the same layer varsom.no uses). */
export const steepnessLayer = L.tileLayer(BRATT_TILE_URL, {
  minZoom: 5,
  maxNativeZoom: BRATT_MAX_NATIVE,
  maxZoom: 17,
  opacity: 0.75,
  pane: 'terrain',
  attribution: 'Bratthet © <a href="https://www.nve.no" target="_blank" rel="noopener">NVE</a>',
});

interface ArcgisLegend {
  layers?: { legend?: { label: string; contentType: string; imageData: string }[] }[];
}

/** Fetch the legend straight from NVE's MapServer and render it into `el`. */
export async function renderSteepnessLegend(el: HTMLElement): Promise<void> {
  try {
    const r = await fetch(`${BRATT_URL}/legend?f=json`);
    const j = (await r.json()) as ArcgisLegend;
    const items = j.layers?.[0]?.legend ?? [];
    if (!items.length) throw new Error('empty legend');
    el.innerHTML = items
      .map((it) => `<span><img alt="" src="data:${it.contentType};base64,${it.imageData}">${esc(it.label)}</span>`)
      .join('');
  } catch {
    el.innerHTML = '<span class="empty">27° til over 45°, i trinn som på varsom.no.</span>';
  }
}
