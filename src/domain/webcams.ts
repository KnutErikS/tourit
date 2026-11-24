/**
 * Statens vegvesen's road webcams, from their open WFS (DATEX 3.1 layer
 * `CctvSimple_v2`, NLOD licence: credit "Statens vegvesen"). No key, CORS-enabled.
 *
 * One site often has several cameras pointing different ways: the camera id is
 * `<site>_<n>` (e.g. 3000938_1, 3000938_2). We group them into one site, so the
 * map gets one marker per place and the popup lets you flip between directions.
 */

/** One camera (one direction) at a site. */
export interface WebcamView {
  id: string;
  /** Button text when a site has several cameras, e.g. "Mot Bjerkvik"; '' = "Kamera n". */
  label: string;
  /** Latest still image (JPEG). */
  url: string;
  /** false when Vegvesen reports the camera as faulty. */
  ok: boolean;
}

export interface WebcamSite {
  id: string;
  name: string;
  road: string;
  lat: number;
  lng: number;
  views: WebcamView[];
  /** Who the images belong to, shown under the image ("Foto: …"). */
  credit: string;
  /** The owner's own webcam page, linked from the popup. */
  link?: string;
}

/** The fields we ask the WFS for (keeps the answer at about half the size). */
export const WEBCAM_FIELDS = [
  'CAMERA_ID', 'DESCRIPTION', 'ORIENTATION_DESCRIPTION', 'ROAD_NUMBER',
  'STATUS_STILL_IMAGE_AVAILABILITY', 'STILL_IMAGE_URL', 'GEOM',
] as const;

interface CamFeature {
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: Record<string, unknown> | null;
}
export interface CamCollection {
  features?: CamFeature[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Site id from a camera id: "3000938_2" → "3000938". */
export const siteIdOf = (cameraId: string): string => cameraId.replace(/_\d+$/, '');

/**
 * GeoJSON from the WFS → sites, each with its views sorted by camera number.
 * Features without an id, an image URL or a usable point are skipped.
 */
export function parseWebcams(fc: CamCollection): WebcamSite[] {
  const sites = new Map<string, WebcamSite>();
  for (const f of fc.features ?? []) {
    const p = f.properties ?? {};
    const id = str(p.CAMERA_ID);
    const url = str(p.STILL_IMAGE_URL);
    const c = f.geometry?.type === 'Point' ? f.geometry.coordinates : null;
    if (!id || !/^https:\/\//.test(url) || !Array.isArray(c)) continue;
    const [lng, lat] = c as number[];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const siteId = siteIdOf(id);
    let site = sites.get(siteId);
    if (!site) {
      site = { id: siteId, name: str(p.DESCRIPTION) || 'Webkamera', road: str(p.ROAD_NUMBER), lat, lng, views: [], credit: 'Statens vegvesen' };
      sites.set(siteId, site);
    }
    if (site.views.some((v) => v.id === id)) continue;
    const direction = str(p.ORIENTATION_DESCRIPTION);
    site.views.push({
      id,
      label: direction ? `Mot ${direction}` : '',
      url,
      ok: str(p.STATUS_STILL_IMAGE_AVAILABILITY) !== 'videoOrImagesUnavailableDueToCameraFault',
    });
  }
  const num = (v: WebcamView) => Number(/_(\d+)$/.exec(v.id)?.[1] ?? 0);
  for (const s of sites.values()) s.views.sort((a, b) => num(a) - num(b));
  return [...sites.values()];
}

/** A site with at least one working camera. */
export const siteOk = (s: WebcamSite): boolean => s.views.some((v) => v.ok);

/**
 * The image URL with a cache-buster that changes once a minute, so the browser
 * doesn't show a copy it fetched earlier (Vegvesen's own map does the same).
 */
export function freshImageUrl(url: string, now = Date.now()): string {
  // Appended as text, not via URLSearchParams: romsdal.com's server needs its
  // bare `?OpenElement` kept as it is.
  return `${url}${url.includes('?') ? '&' : '?'}cacheBuster=${Math.floor(now / 60_000)}`;
}
