import * as L from 'leaflet';
import { NVE_API } from '../config';
import { parseProblem } from '../domain/problems';
import type { LatLngTuple, NveRegionRaw, NveRegionSummaryRaw, Region, Warning } from '../types';
import { type Fetched, withStored } from '../offline/dataCache';
import { getJson } from '../util';

/** All forecast regions with polygons. Warnings are attached later. Stored for use without network. */
export async function fetchRegions(): Promise<Region[]> {
  const { data } = await withStored('regions', 'all', () =>
    getJson<NveRegionRaw[]>(`${NVE_API}/Region/0`).catch((e) => {
      throw new Error('Regioner: ' + (e as Error).message);
    }),
  );
  return data
    .map((d) => {
      const rings = (d.Polygon ?? []).map((s) =>
        String(s)
          .trim()
          .split(/\s+/)
          .map((pair) => pair.split(',').map(Number))
          .filter((p): p is LatLngTuple => p.length === 2 && p.every(Number.isFinite)),
      );
      return {
        id: d.Id,
        name: d.Name,
        type: d.TypeName,
        rings,
        warn: null,
        bounds: L.latLngBounds(rings.flat()),
      } satisfies Region;
    })
    .filter((r) => r.rings.length);
}

/**
 * Warnings for one date (YYYY-MM-DD), keyed by region id. The answer is stored
 * on the device; without network the stored one comes back with `savedAt`.
 */
export async function fetchWarnings(date: string): Promise<Fetched<Map<number, Warning>>> {
  const { data, savedAt } = await withStored('warnings', date, () =>
    // Language 1 = Norwegian. no-cache: a refetch must not get a stale copy from the HTTP cache.
    getJson<NveRegionSummaryRaw[]>(`${NVE_API}/RegionSummary/Detail/1/${date}/${date}`, { cache: 'no-cache' }).catch((e) => {
      throw new Error('Varsler: ' + (e as Error).message);
    }),
  );
  return { data: parseWarnings(data, date), savedAt };
}

function parseWarnings(data: NveRegionSummaryRaw[], date: string): Map<number, Warning> {
  const byId = new Map<number, Warning>();
  for (const reg of data) {
    const list = reg.AvalancheWarningList ?? [];
    const w = list.find((x) => String(x.ValidFrom ?? '').slice(0, 10) === date) ?? list[0];
    if (!w) continue;
    byId.set(reg.Id, {
      level: parseInt(String(w.DangerLevel), 10) || 0,
      problems: (w.AvalancheProblems ?? []).map(parseProblem),
      w,
    });
  }
  return byId;
}
