import * as L from 'leaflet';
import { regionAt } from '../domain/geo';
import { matchesProblem, problemKind } from '../domain/problems';
import { aof, dce, exposedSectors, munter, slabsClass, slabsRisk, type Group, type Munter, type SlabsClass } from '../domain/risk';
import { MSA_RADIUS_M, SLOPE_MIN_DEG, SLOPE_RADIUS_M, WINDOW_M, neighbourhood, slopeWindow } from '../domain/slopeWindow';
import { state } from '../state';
import { cumulative } from '../terrain/elevation';
import { gridAround, tilesAround } from '../terrain/window';

/**
 * SLABS and Munter along a route (domain/risk.ts). Two steps, so a new date
 * or group setting doesn't read the terrain again:
 * 1. `terrainAlong`: the terrain every STEP m (slow: DEM windows).
 * 2. `scoreRoute`: the day's warning at each spot, and both scores (fast).
 */

/** Look at the route this often, metres: finer than the 40 m SLABS looks at. */
const STEP = 25;
/** At most this many spots; longer routes are looked at less often. */
const MAX_SAMPLES = 600;
/** Never read more zoom-14 DEM tiles than this for one route. */
const MAX_TILES = 150;

export interface TerrainSample {
  /** Metres from the start. */
  d: number;
  ll: L.LatLng;
  elev: number;
  /** Which way it faces (0–7), null on flat ground. */
  sector: number | null;
  /** SLABS MSA40, degrees. */
  msa: number;
  steepBySector: number[];
  /** Steepest part of the slope (as Stop or Go's "hele henget"), degrees. */
  steepest: number;
}

function samples(pts: L.LatLng[]): { d: number; ll: L.LatLng }[] {
  const cum = cumulative(pts);
  const step = Math.max(STEP, (cum.at(-1) ?? 0) / MAX_SAMPLES);
  const out = [{ d: 0, ll: pts[0] }];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], len = cum[i] - cum[i - 1];
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push({ d: cum[i - 1] + t * len, ll: L.latLng(a.lat + (b.lat - a.lat) * t, a.lng + (b.lng - a.lng) * t) });
    }
  }
  return out;
}

/**
 * The terrain along the route (null where the DEM has no data). Throws when
 * the route is too long to read politely, or nothing could be read.
 */
export async function terrainAlong(
  pts: L.LatLng[],
  signal?: AbortSignal,
  onProgress?: (share: number) => void,
): Promise<(TerrainSample | null)[]> {
  if (pts.length < 2) return [];
  const smp = samples(pts);
  const tiles = new Set(smp.flatMap((s) => tilesAround(s.ll, MSA_RADIUS_M + WINDOW_M).map((t) => `${t.x}/${t.y}`)));
  if (tiles.size > MAX_TILES) throw new Error('ruta er for lang til å regne ut SLABS og Munter');

  const out: (TerrainSample | null)[] = [];
  let failed = 0;
  for (let i = 0; i < smp.length; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const { d, ll } = smp[i];
    try {
      const near = await gridAround(ll, MSA_RADIUS_M + WINDOW_M);
      const nb = neighbourhood(near);
      if (nb.msa == null || nb.elev == null) {
        out.push(null);
        continue;
      }
      const track = slopeWindow(near).track ?? nb.msa;
      // The whole slope only matters where it is steep enough to be one (as in Stop or Go).
      const steepest = track >= SLOPE_MIN_DEG ? (slopeWindow(await gridAround(ll, SLOPE_RADIUS_M + WINDOW_M)).slope ?? track) : track;
      out.push({ d, ll, elev: nb.elev, sector: nb.sector, msa: nb.msa, steepBySector: nb.steepBySector, steepest });
    } catch {
      failed++;
      out.push(null);
    }
    if (i % 10 === 9) {
      onProgress?.((i + 1) / smp.length);
      await new Promise((r) => setTimeout(r)); // let the page breathe
    }
  }
  if (failed === smp.length) throw new Error(navigator.onLine ? 'fikk ikke lest terrengmodellen' : 'uten nett');
  return out;
}

export interface RiskSample {
  d: number;
  ll: L.LatLng;
  /** Danger level at the spot (0 = no warning). */
  level: number;
  slabs: { risk: number; cls: SlabsClass } | null;
  munter: Munter | null;
}

/** Both scores at each spot, for the chosen day's warnings and your group. */
export function scoreRoute(terrain: (TerrainSample | null)[], group: Group): RiskSample[] {
  return terrain.flatMap((s): RiskSample[] => {
    if (!s) return [];
    const w = regionAt(state.regions, s.ll)?.warn;
    if (!w || w.level < 1) return [{ d: s.d, ll: s.ll, level: 0, slabs: null, munter: null }];
    const probs = w.problems;
    const exposed = exposedSectors(probs);
    const inCore = !probs.length ? true : s.sector == null ? null : probs.some((p) => matchesProblem(p, s.sector!, s.elev));
    const risk = slabsRisk({ msa: s.msa, level: w.level, dce: dce(probs.map((p) => p.raw), s.elev), aof: aof(s.steepBySector, exposed) });
    return [{
      d: s.d,
      ll: s.ll,
      level: w.level,
      slabs: { risk, cls: slabsClass(risk) },
      munter: munter({
        level: w.level,
        steepest: s.steepest,
        sector: s.sector,
        inCore,
        allAspects: exposed.every(Boolean),
        wet: probs.some((p) => problemKind(p.raw).k === 'wet'),
        group,
      }),
    }];
  });
}

export interface RouteRiskSummary {
  /** Danger levels met along the route, highest first; empty = no warning anywhere on it. */
  levels: number[];
  /** Metres of route in each SLABS class. */
  elevatedM: number;
  highM: number;
  /** Metres where Munter's residual risk is over 1 (or a level rule is broken). */
  munterM: number;
  /** Highest residual risk on the route. */
  maxRR: number;
}

/** Each spot stands for the stretch to the next one. */
export function summarize(s: RiskSample[]): RouteRiskSummary {
  let elevatedM = 0, highM = 0, munterM = 0, maxRR = 0;
  s.forEach((x, i) => {
    const len = i + 1 < s.length ? s[i + 1].d - x.d : 0;
    if (x.slabs?.cls === 'high') highM += len;
    else if (x.slabs?.cls === 'elevated') elevatedM += len;
    if (x.munter && !x.munter.ok) munterM += len;
    if (x.munter) maxRR = Math.max(maxRR, x.munter.rr);
  });
  const levels = [...new Set(s.map((x) => x.level).filter((l) => l > 0))].sort((a, b) => b - a);
  return { levels, elevatedM, highM, munterM, maxRR };
}
