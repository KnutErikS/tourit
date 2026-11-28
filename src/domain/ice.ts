/**
 * Ice for skating: the ice observations people report in Regobs (what Varsom
 * shows under "Is", geo hazard 70), on lakes and the sea; river reports (ice
 * runs, drifting slush) are left out. Turned into small plain objects here; the
 * Skøyter tab and its markers (ui/ice.ts, layers/ice.ts) only draw these.
 *
 * Pure: no imports, so `node --test` can load it.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/* ---------- Regobs ---------- */

/** The fields of a Regobs ice registration we read (Search, geo hazard 70). */
export interface RegobsIceRaw {
  RegId: number;
  DtObsTime: string;
  ObsLocation?: {
    Latitude?: number;
    Longitude?: number;
    Height?: number | null;
    LocationName?: string | null;
    Title?: string | null;
    MunicipalName?: string | null;
  } | null;
  Observer?: { NickName?: string | null; CompetenceLevelName?: string | null } | null;
  ObserverGroupName?: string | null;
  IceCoverObs?: {
    IceCoverTID?: number | null;
    IceCoverName?: string | null;
    IceSkateabilityTID?: number | null;
    IceSkateabilityName?: string | null;
    IceCapacityTID?: number | null;
    IceCapacityName?: string | null;
    Comment?: string | null;
  } | null;
  IceThickness?: {
    IceThicknessLayers?: { IceLayerName?: string | null; IceLayerTID?: number | null; IceLayerThickness?: number | null }[] | null;
    /** Metres, like the layers. */
    IceThicknessSum?: number | null;
    SnowDepth?: number | null;
    SlushSnow?: number | null;
    Comment?: string | null;
  } | null;
  DangerObs?: { DangerSignTID?: number | null; DangerSignName?: string | null; Comment?: string | null }[] | null;
  Incident?: { ActivityInfluencedName?: string | null; Comment?: string | null } | null;
  GeneralObservation?: { ObsComment?: string | null } | null;
  Attachments?: { UrlFormats?: { Thumbnail?: string; Large?: string } | null; Copyright?: string | null; Photographer?: string | null }[] | null;
}

/** Regobs' skateability (Ice_IceSkateabilityKDV) on the app's 0–5 scale: 10 Ikke skøytbart → 1 … 50 Drømmeforhold → 5. */
export const SKATE_NAME: Record<number, string> = {
  1: 'Ikke skøytbart', 2: 'Under tvil skøytbart', 3: 'Normale skøyteforhold', 4: 'Meget gode skøyteforhold', 5: 'Drømmeforhold',
};

/** Regobs' carrying capacity (Ice_IceCapacityKDV): 10 Liten … 40 Uten bæreevne → 1–4. */
export const CAPACITY_NAME: Record<number, string> = {
  1: 'Liten fare for å gå gjennom', 2: 'Normal fare for å gå gjennom', 3: 'Stor fare for å gå gjennom', 4: 'Uten bæreevne',
};

/** Danger signs that are not a warning: "Ikke gitt" and "Ingen faretegn observert" (Ice_DangerSignKDV). */
const NO_SIGN = new Set([0, 700, 701]);
const NONE_SEEN = 701;

export interface IceLayer {
  name: string;
  cm: number | null;
}

export interface IceObs {
  /** Regobs' RegId. */
  id: number;
  /** Observation time, ms. */
  time: number;
  lat: number;
  lng: number;
  /** "Orrevatnet", or Regobs' place text ("Klepp / Rogaland") when the observer gave none. */
  place: string;
  municipality: string | null;
  observer: string;
  /** "Ukjent", "*", "**" …: Regobs' competence level. */
  competence: string | null;
  cover: string | null;
  /** 1–5 from the observer's skateability, null when not given. */
  skate: number | null;
  /** 1–4 from the observer's carrying capacity, null when not given. */
  capacity: number | null;
  thicknessCm: number | null;
  layers: IceLayer[];
  snowCm: number | null;
  slushCm: number | null;
  /** Danger signs seen (names, with the observer's comment). */
  signs: string[];
  /** The observer said no danger signs were seen. */
  noSigns: boolean;
  /** "Skøyteløper" etc. when someone went through or was hurt. */
  incident: string | null;
  comments: string[];
  images: { thumb: string; large: string; credit: string }[];
}

const cm = (m: number | null | undefined): number | null =>
  m == null || !Number.isFinite(m) || m < 0 ? null : Math.round(m * 1000) / 10; // 0.105 m → 10.5 cm
const tid = (v: number | null | undefined, step: number, max: number): number | null =>
  v && v > 0 && v % step === 0 && v / step <= max ? v / step : null;
const text = (s: string | null | undefined): string => (s ?? '').trim();

/** One Regobs ice registration as an IceObs, or null without a position. */
export function parseIceObs(r: RegobsIceRaw): IceObs | null {
  const loc = r.ObsLocation ?? {};
  const lat = loc.Latitude, lng = loc.Longitude;
  const time = Date.parse(r.DtObsTime);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(time)) return null;
  const cover = r.IceCoverObs ?? null;
  const thick = r.IceThickness ?? null;
  const signs: string[] = [];
  let noSigns = false;
  for (const d of r.DangerObs ?? []) {
    const id = d.DangerSignTID ?? 0;
    if (id === NONE_SEEN) noSigns = true;
    if (NO_SIGN.has(id)) continue;
    const c = text(d.Comment).replace(/^Område:\s*[^.]*\.\s*Beskrivelse:\s*/, '');
    signs.push(c ? `${text(d.DangerSignName)}: ${c}` : text(d.DangerSignName));
  }
  const comments = [cover?.Comment, thick?.Comment, r.GeneralObservation?.ObsComment].map(text).filter(Boolean);
  const layers = (thick?.IceThicknessLayers ?? [])
    .map((l) => ({ name: text(l.IceLayerName) || 'Is', cm: cm(l.IceLayerThickness) }))
    .filter((l) => l.cm !== null || l.name !== 'Ikke gitt');
  const images = (r.Attachments ?? []).flatMap((a) =>
    a.UrlFormats?.Thumbnail && a.UrlFormats.Large ? [{ thumb: a.UrlFormats.Thumbnail, large: a.UrlFormats.Large, credit: text(a.Photographer) || text(a.Copyright) }] : []);
  const coverName = text(cover?.IceCoverName);
  return {
    id: r.RegId,
    time,
    lat: lat!,
    lng: lng!,
    place: text(loc.LocationName) || text(loc.Title) || text(loc.MunicipalName) || 'Ukjent sted',
    municipality: text(loc.MunicipalName) || null,
    observer: text(r.Observer?.NickName) || text(r.ObserverGroupName) || 'Ukjent',
    competence: text(r.Observer?.CompetenceLevelName) || null,
    cover: coverName && coverName !== 'Ikke gitt' && coverName !== 'Ukjent' ? coverName : null,
    skate: tid(cover?.IceSkateabilityTID, 10, 5),
    capacity: tid(cover?.IceCapacityTID, 10, 4),
    thicknessCm: cm(thick?.IceThicknessSum) || null,
    layers,
    snowCm: cm(thick?.SnowDepth) || null,
    slushCm: cm(thick?.SlushSnow) || null,
    signs,
    noSigns,
    incident: r.Incident ? text(r.Incident.ActivityInfluencedName) || 'Hendelse' : null,
    comments,
    images,
  };
}

/** Ice cover on a river (Ice_IceCoverKDV 40 "Isgang i elv", 41 "Drivende sarr på elv"): not for skating. */
const RIVER_COVER = new Set([40, 41]);
export const onRiver = (r: RegobsIceRaw) => RIVER_COVER.has(r.IceCoverObs?.IceCoverTID ?? 0);

/** Every registration with a position and not on a river, newest first. */
export function parseIceObsList(list: RegobsIceRaw[]): IceObs[] {
  return list.flatMap((r) => (onRiver(r) ? [] : parseIceObs(r) ?? [])).sort((a, b) => b.time - a.time);
}

/**
 * Reasons to take care, from what the observer reported: high risk of going
 * through, danger signs, or an incident. Shown as a red ring on the marker and
 * a warning in the list, whatever the skateability.
 */
export function iceWarnings(o: IceObs): string[] {
  const out: string[] = [];
  if (o.incident) out.push(`Hendelse: ${o.incident}`);
  if (o.capacity !== null && o.capacity >= 3) out.push(CAPACITY_NAME[o.capacity]);
  out.push(...o.signs);
  return out;
}

/** The observations made in the `days` before `end` (ms), newest first. */
export function obsWithin(list: IceObs[], end: number, days: number): IceObs[] {
  const from = end - days * DAY;
  return list.filter((o) => o.time <= end && o.time > from);
}
