import * as L from 'leaflet';
import type { ObsKind, Region, RegobsAttachment, RegobsObs } from '../types';
import { regionAt } from './geo';

const NO_ACTIVITY = /ingen skredaktivitet/i;

export const KIND_LABEL: Record<ObsKind, string> = { skred: 'Skred', tegn: 'Faretegn', obs: 'Observasjon' };

/** Avalanche > danger sign > anything else. */
export function obsKind(o: RegobsObs): ObsKind {
  if (o.AvalancheObs) return 'skred';
  if ((o.AvalancheActivityObs2 ?? []).some((a) => !NO_ACTIVITY.test(a.EstimatedNumName ?? ''))) return 'skred';
  // DangerSignTID ending in 01 = "Ingen faretegn observert"
  if ((o.DangerObs ?? []).some((d) => d.DangerSignTID && d.DangerSignTID % 100 !== 1)) return 'tegn';
  return 'obs';
}

export const images = (o: RegobsObs): RegobsAttachment[] =>
  (o.Attachments ?? []).filter((a) => !a.AttachmentMimeType || /^image\//.test(a.AttachmentMimeType));

const hasPos = (o: RegobsObs) => Number.isFinite(o.ObsLocation?.Latitude) && Number.isFinite(o.ObsLocation?.Longitude);

/** Observations in a region, avalanches first, then newest first. */
export function regionObs(all: RegobsObs[], regions: Region[], r: Region | null): RegobsObs[] {
  if (!r) return [];
  const order: Record<ObsKind, number> = { skred: 0, tegn: 1, obs: 2 };
  return all
    .filter((o) => {
      const loc = o.ObsLocation;
      if (!loc) return false;
      if (loc.ForecastRegionTID === r.id) return true;
      return loc.ForecastRegionTID == null && hasPos(o) && regionAt(regions, L.latLng(loc.Latitude!, loc.Longitude!)) === r;
    })
    .sort(
      (a, b) =>
        order[obsKind(a)] - order[obsKind(b)] || new Date(b.DtObsTime).getTime() - new Date(a.DtObsTime).getTime(),
    );
}
