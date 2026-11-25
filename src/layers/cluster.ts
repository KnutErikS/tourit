/**
 * Greedy distance clustering of points in screen pixels: each point joins the
 * first cluster whose seed lies within `radius` px, or starts a new one. With a
 * hash grid of `radius`-sized cells only the 3 × 3 cells around a point are
 * looked at, so it is O(n). The same input order gives the same clusters, and
 * clustering all points (not just those in view) keeps them from reshuffling
 * when the map is panned.
 *
 * Pure: no imports, so `node --test` can load it.
 */

export interface Cluster<T> {
  items: T[];
  /** Mean position of the members, px. */
  x: number;
  y: number;
}

export function cluster<T>(items: T[], at: (item: T) => { x: number; y: number }, radius: number): Cluster<T>[] {
  type Seed = { c: Cluster<T>; x: number; y: number; sx: number; sy: number };
  const grid = new Map<string, Seed[]>();
  const seeds: Seed[] = [];
  const r2 = radius * radius;
  for (const item of items) {
    const p = at(item);
    const gx = Math.floor(p.x / radius), gy = Math.floor(p.y / radius);
    let best: Seed | null = null, bestD = r2;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const s of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
          const d = (s.x - p.x) ** 2 + (s.y - p.y) ** 2;
          if (d <= bestD) (best = s), (bestD = d);
        }
    if (best) {
      best.c.items.push(item);
      best.sx += p.x;
      best.sy += p.y;
      continue;
    }
    // The seed stays where it started, so the grid lookup stays valid as members join.
    const seed: Seed = { c: { items: [item], x: p.x, y: p.y }, x: p.x, y: p.y, sx: p.x, sy: p.y };
    seeds.push(seed);
    const key = `${gx},${gy}`;
    (grid.get(key) ?? grid.set(key, []).get(key)!).push(seed);
  }
  for (const s of seeds) {
    s.c.x = s.sx / s.c.items.length;
    s.c.y = s.sy / s.c.items.length;
  }
  return seeds.map((s) => s.c);
}
