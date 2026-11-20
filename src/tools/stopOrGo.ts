import type * as L from 'leaflet';
import { regionAt } from '../domain/geo';
import { instabilitySigns, regionObs } from '../domain/observations';
import { matchesProblem } from '../domain/problems';
import { signsEnd, stopOrGo, type StopOrGoResult } from '../domain/stopOrGo';
import { zoneAt } from '../route/runout';
import { state } from '../state';
import { slopeAround } from '../terrain/window';
import type { TerrainPoint } from '../types';

export interface StopOrGoAssessment extends StopOrGoResult {
  /** Labels of the instability signs that moved the level up ("Drønn i snøen", …). */
  signs: string[];
  /** Region the point is in. */
  regionName: string | null;
}

/**
 * Stop or Go for one point (the tapped point, or your position): danger level
 * and avalanche problems of its region, the steepness around it, NVE's runout
 * bands at it, and Regobs signs of instability in the region.
 */
export async function assessStopOrGo(ll: L.LatLng, terrain: TerrainPoint | null | undefined): Promise<StopOrGoAssessment> {
  const region = regionAt(state.regions, ll);
  const w = region?.warn ?? null;
  const level = w?.level ?? 0;

  const signs = region ? instabilitySigns(regionObs(state.obs, state.regions, region), signsEnd(state.date)).map((s) => s.label) : [];
  const uniqueSigns = [...new Set(signs)];

  // No listed problem: treat the whole region as core zone (the cautious choice).
  // No terrain yet (still loading, or your position): null, which also counts as inside.
  const inCore = !w?.problems.length ? true : terrain ? w.problems.some((p) => matchesProblem(p, terrain.sector, terrain.elev)) : null;

  const [win, zone] = await Promise.all([
    slopeAround(ll).catch(() => null),
    level >= 4 ? zoneAt(ll).catch(() => null) : Promise.resolve(null),
  ]);

  const res = stopOrGo({
    level,
    inCore,
    signs: uniqueSigns.length > 0,
    steepTrack: win?.track ?? terrain?.slope ?? null,
    steepSlope: win?.slope ?? terrain?.slope ?? null,
    inRunout: zone !== null && zone !== 'steep',
  });
  return { ...res, signs: uniqueSigns, regionName: region?.name ?? null };
}
