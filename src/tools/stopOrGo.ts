import type * as L from 'leaflet';
import { regionAt } from '../domain/geo';
import { matchesProblem } from '../domain/problems';
import { INSTABILITY, signGroup, type SignKind } from '../domain/signs';
import { stopOrGo, type StopOrGoResult } from '../domain/stopOrGo';
import { zoneAt } from '../route/runout';
import { state } from '../state';
import { slopeAround } from '../terrain/window';
import type { TerrainPoint } from '../types';
import { regionSigns } from './signs';

export interface StopOrGoAssessment extends StopOrGoResult {
  /** Labels of the instability signs that moved the level up ("drønn i snøen", …); empty when they didn't. */
  signs: string[];
  /** Region the point is in. */
  regionName: string | null;
}

/**
 * Stop or Go for one point (the tapped point, or your position): danger level
 * and avalanche problems of its region, the steepness around it, NVE's runout
 * bands at it, and Regobs signs of instability in the region, weighted for the
 * point's height and aspect (domain/signs.ts). At level 3 and above, poor ECT
 * results count as a sign too (Rule 20).
 */
export async function assessStopOrGo(ll: L.LatLng, terrain: TerrainPoint | null | undefined): Promise<StopOrGoAssessment> {
  const region = regionAt(state.regions, ll);
  const w = region?.warn ?? null;
  const level = w?.level ?? 0;

  const hits = regionSigns(region, terrain);
  const kinds: SignKind[] = level >= 3 ? [...INSTABILITY, 'poorTest'] : INSTABILITY;
  const signs = hits ? signGroup(hits, kinds) : null;

  // No listed problem: treat the whole region as core zone (the cautious choice).
  // No terrain yet (still loading, or your position): null, which also counts as inside.
  const inCore = !w?.problems.length ? true : terrain ? w.problems.some((p) => matchesProblem(p, terrain.sector, terrain.elev)) : null;

  // Runout counts from level 4, and from level 3 when unknown signs could lift it there.
  // undefined = the map couldn't be read (offline outside a saved area): unknown, not "outside".
  const [win, zone] = await Promise.all([
    slopeAround(ll).catch(() => null),
    level >= 3 ? zoneAt(ll).catch(() => undefined) : Promise.resolve(null),
  ]);

  const res = stopOrGo({
    level,
    inCore,
    // null = the day's observations aren't loaded (still loading, failed, or offline and not stored).
    signs: signs ? signs.on : null,
    steepTrack: win?.track ?? terrain?.slope ?? null,
    steepSlope: win?.slope ?? terrain?.slope ?? null,
    // NVE's steep classes are not runout; the steepness itself is checked against the limit.
    inRunout: zone === undefined ? null : zone !== null && zone !== 'steep',
  });
  return { ...res, signs: signs?.on ? signs.labels : [], regionName: region?.name ?? null };
}
