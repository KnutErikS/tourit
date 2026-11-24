export type RGB = [number, number, number];

/** Where "Meld feil eller send tips" goes (the build number is added to the text). */
export const CONTACT_URL = 'https://github.com/KnutErikS/tourit/issues/new';

/** External services. All are public, CORS-enabled and need no API key. */
export const NVE_API = 'https://api01.nve.no/hydrology/forecast/avalanche/v6.3.2/api';
export const REGOBS_API = 'https://api.regobs.no/v5';
/** Kartverket's place-name register (Sentralt stedsnavnregister), for search. */
export const STEDSNAVN_API = 'https://ws.geonorge.no/stedsnavn/v1';
/** MET Norway (yr's data): point forecasts. Open data, CC BY 4.0; see src/api/met.ts for the terms. */
export const MET_API = 'https://api.met.no/weatherapi';
/** Open-Meteo: cloud cover per height and freezing level (ICON model). Free for non-commercial use, CC BY 4.0. */
export const OPEN_METEO_API = 'https://api.open-meteo.com/v1';
/**
 * Statens vegvesen's open map services (GeoServer). The DATEX 3.1 workspace has
 * the road webcams as a WFS layer; no registration or key. NLOD licence: credit Statens vegvesen.
 */
export const VEGVESEN_WFS = 'https://ogckart-sn1.atlas.vegvesen.no/datex_3_1/wfs';
export const DTM_URL = 'https://hoydedata.no/arcgis/rest/services/DTM/ImageServer/exportImage';
export const BRATT_URL = 'https://gis3.nve.no/arcgis/rest/services/wmts/Bratthet_2024/MapServer';
export const BRATT_TILE_URL = `${BRATT_URL}/tile/{z}/{y}/{x}`;
/**
 * NVE's "Bratthet med utløp" (what varsom.no and the Varsom app show): the same
 * steepness classes plus modelled runout below them in three blues. Runout is
 * modelled from the alpha angle (Lied & Bakkehøi): short = 32° (half of all
 * avalanches go further), medium = 27° (one in four), long = 23° (one in twenty).
 * See https://www.varsom.no/snoskredskolen/skredterreng/bratthet-og-utlopsomradekart/
 */
export const BRATT_UTLOP_URL = 'https://gis3.nve.no/arcgis/rest/services/wmts/Bratthet_med_utlop_2024/MapServer';
export const BRATT_UTLOP_TILE_URL = `${BRATT_UTLOP_URL}/tile/{z}/{y}/{x}`;

export type RunoutClass = 'short' | 'medium' | 'long';
/** The exact tile colours (the tiles have no antialiasing), darkest = shortest = most avalanches reach it. */
export const RUNOUT: Record<RunoutClass, { rgb: RGB; label: string; share: string }> = {
  short: { rgb: [0, 77, 168], label: 'Kort utløp', share: 'halvparten av skredene går lenger' },
  medium: { rgb: [76, 155, 255], label: 'Middels utløp', share: 'ett av fire skred går lenger' },
  long: { rgb: [154, 177, 230], label: 'Langt utløp', share: 'ett av tjue skred går lenger' },
};
/**
 * NVE's seNorge snow maps (modelled, 1 km grid, also a few days ahead) as a
 * WMS with a TIME parameter: the same service senorge.no draws from.
 */
export const SNOW_WMS_URL = 'https://kart.nve.no/enterprise/services/seNorgeGrid_png/ImageServer/WMSServer';
export const BASEMAP_URL =
  'https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png';
export const BASEMAP_ATTRIBUTION = '© <a href="https://www.kartverket.no" target="_blank" rel="noopener">Kartverket</a>';
/**
 * Kartverket's topo map is empty over Svalbard, so there we draw Norsk
 * Polarinstitutt's base map on top (CC BY 4.0). Same Web Mercator tile grid.
 * It only has tiles over land/glaciers (sea tiles are 404) and nothing past zoom 15.
 */
export const SVALBARD_BASEMAP_URL =
  'https://geodata.npolar.no/arcgis/rest/services/Basisdata/NP_Basiskart_Svalbard_WMTS_3857/MapServer/tile/{z}/{y}/{x}';
export const SVALBARD_BASEMAP_ATTRIBUTION =
  '© <a href="https://www.npolar.no" target="_blank" rel="noopener">Norsk Polarinstitutt</a>';
/** The service's full extent, [[south, west], [north, east]]. Tiles are only requested inside it. */
export const SVALBARD_BOUNDS: [[number, number], [number, number]] = [[73.73, 7.46], [81.16, 36.06]];
export const SVALBARD_MAX_NATIVE = 15;

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
/** Webcams show from this zoom (all of Norway at once is just clutter). */
export const WEBCAM_MIN_ZOOM = 7;

/** A day from last season with plenty of warnings, used by the demo button. */
export const DEMO = { date: '2026-03-14', center: [69.55, 20.1] as [number, number], zoom: 10 };

/** Zoom limits per tile source (beyond these, Leaflet scales up the last native zoom). */
export const BASEMAP_MAX_NATIVE = 17;
export const BRATT_MAX_NATIVE = 16;
export const DEM_MAX_NATIVE = 15;
/** seNorge is a 1 km grid: past this zoom, scale up instead of asking for more images. */
export const SNOW_MAX_NATIVE = 11;

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
