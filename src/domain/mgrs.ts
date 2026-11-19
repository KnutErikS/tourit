import { forward } from 'mgrs';

/**
 * MGRS (military grid / used by Norwegian rescue services) for a WGS84 point,
 * 1 m precision, formatted with spaces: "34W DC 12345 67890".
 * Uses the proj4js `mgrs` package (handles the Norway/Svalbard UTM zone exceptions).
 * Returns null outside MGRS coverage (UTM: 80°S–84°N).
 */
export function toMgrs(lat: number, lng: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -80 || lat > 84) return null;
  let raw: string;
  try {
    raw = forward([lng, lat], 5);
  } catch {
    return null;
  }
  const m = /^(\d{1,2}[C-HJ-NP-X])([A-HJ-NP-Z]{2})(\d+)$/.exec(raw);
  if (!m || m[3].length % 2) return raw;
  const half = m[3].length / 2;
  return `${m[1]} ${m[2]} ${m[3].slice(0, half)} ${m[3].slice(half)}`;
}
