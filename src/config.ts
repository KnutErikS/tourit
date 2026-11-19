/** External services. All are public, CORS-enabled and need no API key. */
export const NVE_API = 'https://api01.nve.no/hydrology/forecast/avalanche/v6.3.2/api';
export const REGOBS_API = 'https://api.regobs.no/v5';
/** Kartverket's place-name register (Sentralt stedsnavnregister), for search. */
export const STEDSNAVN_API = 'https://ws.geonorge.no/stedsnavn/v1';
export const DTM_URL = 'https://hoydedata.no/arcgis/rest/services/DTM/ImageServer/exportImage';
export const BRATT_URL = 'https://gis3.nve.no/arcgis/rest/services/wmts/Bratthet_2024/MapServer';
export const BRATT_TILE_URL = `${BRATT_URL}/tile/{z}/{y}/{x}`;
export const BASEMAP_URL =
  'https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png';

export type RGB = [number, number, number];

/** Danger level colours (0 = not assessed). */
export const DANGER: Record<number, string> = {
  0: '#9aa5b1', 1: '#4fae54', 2: '#f5cc12', 3: '#f28a1a', 4: '#d92b20', 5: '#2a1a1a',
};
export const DANGER_RGB: Record<number, RGB> = {
  1: [79, 174, 84], 2: [245, 204, 18], 3: [242, 138, 26], 4: [217, 43, 32], 5: [60, 10, 30],
};
export const DNAME: Record<number, string> = {
  0: 'Ikke vurdert', 1: 'Liten', 2: 'Moderat', 3: 'Betydelig', 4: 'Stor', 5: 'Meget stor',
};

/** Aspect sectors, clockwise from north. Index matches NVE's ValidExpositions string. */
export const DIRS = ['N', 'NØ', 'Ø', 'SØ', 'S', 'SV', 'V', 'NV'] as const;
export const ASP_RGB: RGB[] = [
  [37, 99, 235], [124, 58, 237], [217, 70, 239], [244, 63, 94],
  [234, 88, 12], [234, 179, 8], [22, 163, 74], [8, 145, 178],
];

/** Zoom levels where the computed terrain layers start. */
export const SKRED_MIN_ZOOM = 10;
export const ASPECT_MIN_ZOOM = 11;

/** A day from last season with plenty of warnings, used by the demo button. */
export const DEMO = { date: '2026-03-14', center: [69.55, 20.1] as [number, number], zoom: 10 };

/** Zoom limits per tile source (beyond these, Leaflet scales up the last native zoom). */
export const BASEMAP_MAX_NATIVE = 17;
export const BRATT_MAX_NATIVE = 16;
export const DEM_MAX_NATIVE = 15;

/**
 * Cache Storage name for saved map areas. Must match CACHE in public/sw.js.
 * Bump both if the stored format ever changes.
 */
export const OFFLINE_CACHE = 'tourit-tiles-v1';

/**
 * 3D terrain (MapLibre raster-dem, Terrarium encoding): AWS Terrain Tiles,
 * which use Kartverket's DTM 10 over Norway. Static files on S3, so the 3D
 * view puts no load on hoydedata.no. Only used with network.
 */
export const TERRAIN_3D_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const TERRAIN_3D_MAX_ZOOM = 15;
