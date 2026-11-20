import type { Fetched } from './offline/dataCache';
import type { PointWeather } from './domain/weather';
import type { WindHour, WindLoading } from './domain/wind';
import type * as L from 'leaflet';

/* ---------- NVE avalanche warning API (only the fields we use) ---------- */

export interface NveRegionRaw {
  Id: number;
  Name: string;
  TypeName: string; // 'A' = main forecast region, 'B' = outer
  Polygon?: string[]; // each ring: "lat,lng lat,lng ..."
}

export interface NveProblemRaw {
  AvalancheProblemTypeName?: string;
  AvalancheExtName?: string;
  AvalancheTypeName?: string;
  ValidExpositions?: string; // 8 chars of 0/1, N..NV clockwise
  ExposedHeight1?: number;
  ExposedHeight2?: number;
  ExposedHeightFill?: number; // 1..4, see domain/problems.ts
  AvalCauseName?: string;
  AvalTriggerSensitivityName?: string;
  AvalTriggerSimpleName?: string;
  AvalPropagationName?: string;
  AvalProbabilityName?: string;
  DestructiveSizeExtName?: string;
  DestructiveSizeName?: string;
  TriggerSenitivityPropagationDestuctiveSizeText?: string; // sic, NVE's spelling
}

export interface NveMountainWeather {
  CloudCoverName?: string;
  MeasurementTypes?: {
    Name: string;
    MeasurementSubTypes?: { Name: string; Value?: string | number | null }[];
  }[];
  MeasurementTexts?: { Text?: string }[];
}

export interface NveWarningRaw {
  ValidFrom?: string;
  DangerLevel?: string | number;
  MainText?: string;
  EmergencyWarning?: string;
  AvalancheDanger?: string;
  PublishTime?: string;
  Author?: string;
  AvalancheProblems?: NveProblemRaw[];
  AvalancheAdvices?: { Text?: string }[];
  SnowSurface?: string;
  CurrentWeaklayers?: string;
  LatestAvalancheActivity?: string;
  LatestObservations?: string;
  MountainWeather?: NveMountainWeather | null;
}

export interface NveRegionSummaryRaw {
  Id: number;
  AvalancheWarningList?: NveWarningRaw[];
}

/* ---------- Parsed domain objects ---------- */

export interface Problem {
  raw: NveProblemRaw;
  /** Exposed aspects, index as DIRS. null = all aspects. */
  exp: boolean[] | null;
  /** Is this elevation (m) inside the exposed height band? */
  height: (z: number) => boolean;
}

export interface Warning {
  level: number;
  problems: Problem[];
  w: NveWarningRaw;
}

export type LatLngTuple = [number, number];

export interface Region {
  id: number;
  name: string;
  type: string;
  rings: LatLngTuple[][];
  bounds: L.LatLngBounds;
  warn: Warning | null;
  /** Lee aspects from the wind before the warning date; undefined until loaded, null if no data. */
  wind?: WindLoading | null;
  /**
   * The hourly weather behind `wind` (850 hPa, middle of the region), for the days
   * before and the whole warning date; undefined until loaded, null if no data.
   */
  hours?: WindHour[] | null;
  poly?: L.Polygon;
}

/* ---------- Terrain ---------- */

/** Slope/aspect/elevation for an n×n grid covering one map tile. */
export interface DemTile {
  n: number;
  slope: Float32Array; // degrees
  sector: Uint8Array; // 0..7, index into DIRS
  elev: Float32Array; // metres
  ok: Uint8Array; // 1 where valid
}

export interface TerrainPoint {
  elev: number;
  slope: number;
  sector: number;
}

export interface Picked {
  ll: L.LatLng;
  /** undefined = still loading, null = no data */
  terrain: TerrainPoint | null | undefined;
  /** Weather forecast for the point: undefined = not loaded yet, null = failed (see weatherErr). */
  weather?: Fetched<PointWeather> | null;
  weatherErr?: string;
}

/* ---------- Regobs ---------- */

export interface RegobsAttachment {
  AttachmentMimeType?: string;
  UrlFormats?: Record<string, string>;
  Url?: string;
  RegistrationName?: string;
  Comment?: string;
  Photographer?: string;
}

export interface RegobsObs {
  RegId: number;
  DtObsTime: string;
  ObsLocation?: {
    Latitude?: number;
    Longitude?: number;
    Height?: number;
    Title?: string;
    LocationName?: string;
    MunicipalName?: string;
    ForecastRegionTID?: number | null;
  };
  Observer?: { NickName?: string; CompetenceLevelName?: string };
  AvalancheObs?: {
    DtAvalancheTime?: string | null;
    /** 8 chars of 0/1, N..NV clockwise, like NVE's ValidExpositions. */
    ValidExposition?: string | null;
    /** m; -1 = not given */
    HeightStartZone?: number | null;
  } | null;
  AvalancheActivityObs2?: { EstimatedNumName?: string; DtEnd?: string | null; ValidExposition?: string | null }[];
  DangerObs?: { DangerSignTID?: number }[];
  CompressionTest?: RegobsTest[];
  Attachments?: RegobsAttachment[];
  Summaries?: {
    RegistrationName?: string;
    Summaries?: { Header?: string; Value?: unknown }[];
  }[];
}

/** A stability test in a Regobs report (only the fields we use). */
export interface RegobsTest {
  /** 21 ECTPV, 22 ECTP, 23 ECTN, 24 ECTX; other values are other tests. */
  PropagationTID?: number | null;
  TapsFracture?: number | null;
  TapsFullPropagation?: number | null;
}

export type ObsKind = 'skred' | 'tegn' | 'obs';
