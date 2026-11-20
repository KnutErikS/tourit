import type { DemTile } from '../types';

/**
 * Slope (Horn's method), aspect sector and elevation for one map tile, from a
 * decoded elevation grid. Pure: type imports only, so `node --test` can load it.
 *
 * Two ways to store the result (see DemTile):
 * - precise: Float32 slope (degrees) and elevation (m), 10 bytes per cell.
 *   For the tiles that point analysis reads (terrainAt, the 20 × 20 m slope
 *   window, SLABS): box means of slope must not be biased.
 * - compact: slope in whole degrees and elevation in whole metres, both
 *   rounded down, 5 bytes per cell. For the tiles only drawn on the map,
 *   which compare slope and height with whole numbers (27/30/35°, NVE's
 *   heights in whole metres). Rounding down gives exactly the same answers
 *   there: floor(v) >= t  ⇔  v >= t  for a whole number t.
 */

/** What `analyze` needs from a decoded LERC image. */
export interface ElevationGrid {
  width: number;
  height: number;
  pixels: ArrayLike<number>[];
  mask: ArrayLike<number> | null;
}

/** Bytes a tile takes in memory (for the tile cache's budget). */
export const tileBytes = (t: DemTile): number => t.slope.byteLength + t.elev.byteLength + t.sector.byteLength + t.ok.byteLength;

/**
 * Analyse an (n+2)×(n+2) grid (one cell of border for the 3×3 kernel) into n×n
 * cells. `res` is the cell size in Web Mercator metres, `ytop` the Mercator y
 * of the top edge of the grid.
 */
export function analyze(d: ElevationGrid, res: number, ytop: number, n: number, compact = false): DemTile {
  const W = d.width, Z = d.pixels[0], M = d.mask;
  const N = n * n;
  const slope = compact ? new Uint8Array(N) : new Float32Array(N);
  const elev = compact ? new Int16Array(N) : new Float32Array(N);
  const sector = new Uint8Array(N), ok = new Uint8Array(N);
  const out: DemTile = { n, slope, sector, elev, ok, compact };
  if (W !== n + 2 || d.height !== n + 2) return out;

  // Compact elevation is Int16: the range check keeps it well inside (Norway tops out at 2469 m).
  const good = (i: number) => (!M || M[i]) && Z[i] > -500 && Z[i] < 9000;
  for (let r = 0; r < n; r++) {
    // Ground distance between cells shrinks with latitude in Web Mercator.
    const ym = ytop - (r + 1.5) * res;
    const g = res * Math.cos(Math.atan(Math.sinh(ym / 6378137)));
    for (let c = 0; c < n; c++) {
      const i = (r + 1) * W + (c + 1), o = r * n + c;
      const a = i - W - 1, b = i - W, cc = i - W + 1, dd = i - 1, f = i + 1, gg = i + W - 1, h = i + W, ii = i + W + 1;
      if (!(good(i) && good(a) && good(b) && good(cc) && good(dd) && good(f) && good(gg) && good(h) && good(ii))) continue;
      const dzx = (Z[cc] + 2 * Z[f] + Z[ii] - (Z[a] + 2 * Z[dd] + Z[gg])) / (8 * g); // rise towards east
      const dzr = (Z[gg] + 2 * Z[h] + Z[ii] - (Z[a] + 2 * Z[b] + Z[cc])) / (8 * g); // rise towards south (row dir)
      const deg = (Math.atan(Math.hypot(dzx, dzr)) * 180) / Math.PI;
      // Typed arrays truncate on store, which is rounding down for these non-negative / Int16 values;
      // Math.floor makes it explicit (and right for elevations below 0).
      slope[o] = compact ? Math.floor(deg) : deg;
      let asp = (Math.atan2(-dzx, dzr) * 180) / Math.PI;
      if (asp < 0) asp += 360;
      sector[o] = Math.floor(((asp + 22.5) % 360) / 45);
      elev[o] = compact ? Math.floor(Z[i]) : Z[i];
      ok[o] = 1;
    }
  }
  return out;
}
