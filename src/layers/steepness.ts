import * as L from 'leaflet';
import { BRATT_MAX_NATIVE, BRATT_TILE_URL, BRATT_URL } from '../config';
import { esc } from '../util';

/** NVE's official steepness map (the same layer varsom.no uses). */
export const steepnessLayer = L.tileLayer(BRATT_TILE_URL, {
  minZoom: 5,
  maxNativeZoom: BRATT_MAX_NATIVE,
  maxZoom: 17,
  opacity: 0.5,
  pane: 'terrain',
  attribution: 'Bratthet © <a href="https://www.nve.no" target="_blank" rel="noopener">NVE</a>',
});

interface ArcgisLegend {
  layers?: { legend?: { label: string; contentType: string; imageData: string }[] }[];
}

/**
 * NVE labels its classes "1"–"7"; show the slope range instead. Class 1 (under 27°)
 * is transparent on the map, so it is left out of the legend. Ranges as on varsom.no.
 */
const CLASS_DEGREES: Record<string, string | null> = {
  '1': null,
  '2': '27–30°',
  '3': '30–35°',
  '4': '35–40°',
  '5': '40–45°',
  '6': '45–50°',
  '7': '50°+',
};

/** Fetch the legend straight from NVE's MapServer and render it into `el`. */
export async function renderSteepnessLegend(el: HTMLElement): Promise<void> {
  try {
    const r = await fetch(`${BRATT_URL}/legend?f=json`);
    const j = (await r.json()) as ArcgisLegend;
    // Validate before building data: URLs from the response.
    const items = (j.layers?.[0]?.legend ?? []).filter(
      (it) => /^image\/(png|jpeg|gif)$/.test(it.contentType) && /^[A-Za-z0-9+/=]+$/.test(it.imageData),
    );
    if (!items.length) throw new Error('empty legend');
    el.innerHTML = items
      .filter((it) => CLASS_DEGREES[it.label] !== null)
      .map((it) => {
        const label = CLASS_DEGREES[it.label] ?? it.label; // unknown class: keep NVE's own label
        return `<span><img alt="" src="data:${it.contentType};base64,${it.imageData}">${esc(label)}</span>`;
      })
      .join('');
  } catch {
    el.innerHTML = '<span class="empty">27° til over 45°, i trinn som på varsom.no.</span>';
  }
}
