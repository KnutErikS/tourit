/**
 * "Steepest part" of the terrain around a point, as Stop or Go and the GRM
 * mean it: the steepest ~20 × 20 m spot, not the steepest single DEM cell
 * (a single 4–9 m cell can be a boulder or a DEM artefact).
 *
 * Works on a square grid of slope values centred on the point:
 * 1. Box-average the slope over WINDOW_M × WINDOW_M (summed-area table).
 * 2. track: the steepest box centred within TRACK_M of the point.
 * 3. slope: the steepest box on the slope above and below you. Flood-fill
 *    from that steepest box near you (not the exact point, so one gentle map
 *    cell under your feet doesn't hide the slope) through cells that are
 *    - at least SLOPE_MIN_DEG steep,
 *    - facing the same way, within ASPECT_TOL_DEG ("facing" is the downhill
 *      direction averaged over the same box, so small bumps don't turn it),
 *    - in a strip STRIP_M either side of the fall line where you are,
 *    - at most SLOPE_RADIUS_M from the point.
 *    The strip is what makes it "your" slope: without it, some rock step or
 *    stream bank on the same mountainside, typically ~130 m off to the side,
 *    set the result. If the steepest box near you is gentler than
 *    SLOPE_MIN_DEG there is no slope, and `slope` equals `track`.
 *
 * Without elevation (`elev`) there is no facing direction, so neither the
 * aspect rule nor the strip applies.
 *
 * WINDOW_M comes from SLF; TRACK_M, SLOPE_MIN_DEG, SLOPE_RADIUS_M,
 * ASPECT_TOL_DEG and STRIP_M are our own choices. Pure: no runtime imports.
 */

export const WINDOW_M = 20;
export const TRACK_M = 10;
export const SLOPE_MIN_DEG = 20;
export const SLOPE_RADIUS_M = 150;
export const ASPECT_TOL_DEG = 45;
/** Half-width of the strip along the fall line, metres (the strip is 50 m wide). */
export const STRIP_M = 25;

export interface SlopeGrid {
  /** Cells per side (odd, the point is the middle cell). */
  size: number;
  /** Ground size of one cell, metres. */
  cell: number;
  /** Slope per cell, degrees, row-major. Rows run north → south, columns west → east. */
  slope: Float32Array;
  /** 1 where the slope is valid. */
  ok: Uint8Array;
  /**
   * Elevation per cell, metres (valid where `ok`). Gives the facing direction;
   * without it the slope search follows steepness only, whatever way it faces.
   */
  elev?: Float32Array;
}

export interface SlopeWindow {
  /** Steepest 20 × 20 m around the point itself. */
  track: number | null;
  /** Steepest 20 × 20 m on the slope the point is on. */
  slope: number | null;
  /** Area of the connected slope that was searched, m². */
  slopeArea: number;
}

/** Mean of `v` over a (2h+1)² box around every cell, using only cells where `ok`; NaN where none are. */
function boxMeanOf(v: Float32Array, ok: Uint8Array, n: number, h: number): Float32Array {
  const W = n + 1;
  const sum = new Float64Array(W * W), cnt = new Float64Array(W * W);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const i = r * n + c, k = ok[i] ? 1 : 0;
      const j = (r + 1) * W + c + 1;
      sum[j] = (k ? v[i] : 0) + sum[j - 1] + sum[j - W] - sum[j - W - 1];
      cnt[j] = k + cnt[j - 1] + cnt[j - W] - cnt[j - W - 1];
    }
  const out = new Float32Array(n * n);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const r0 = Math.max(0, r - h), r1 = Math.min(n, r + h + 1), c0 = Math.max(0, c - h), c1 = Math.min(n, c + h + 1);
      const s = sum[r1 * W + c1] - sum[r0 * W + c1] - sum[r1 * W + c0] + sum[r0 * W + c0];
      const k = cnt[r1 * W + c1] - cnt[r0 * W + c1] - cnt[r1 * W + c0] + cnt[r0 * W + c0];
      out[r * n + c] = k ? s / k : NaN;
    }
  return out;
}

/** Mean slope over a (2h+1)² box around every cell, ignoring invalid cells; NaN where none are valid. */
export function boxMean(g: SlopeGrid, h: number): Float32Array {
  return boxMeanOf(g.slope, g.ok, g.size, h);
}

/**
 * Downhill direction per cell as (east, north) components of the gradient,
 * from central differences of `elev`, averaged over a (2h+1)² box. NaN where
 * unknown. atan2(east, north) is the aspect, clockwise from north.
 */
export function downhill(g: SlopeGrid & { elev: Float32Array }, h: number): { e: Float32Array; n: Float32Array } {
  const n = g.size;
  const e = new Float32Array(n * n), no = new Float32Array(n * n), ok = new Uint8Array(n * n);
  for (let r = 1; r < n - 1; r++)
    for (let c = 1; c < n - 1; c++) {
      const i = r * n + c;
      if (!(g.ok[i - 1] && g.ok[i + 1] && g.ok[i - n] && g.ok[i + n])) continue;
      const riseE = (g.elev[i + 1] - g.elev[i - 1]) / (2 * g.cell);
      const riseS = (g.elev[i + n] - g.elev[i - n]) / (2 * g.cell);
      e[i] = -riseE; // rising to the east = facing west
      no[i] = riseS; // rising to the south = facing north
      ok[i] = 1;
    }
  return { e: boxMeanOf(e, ok, n, h), n: boxMeanOf(no, ok, n, h) };
}

export function slopeWindow(g: SlopeGrid): SlopeWindow {
  const n = g.size, mid = (n - 1) / 2;
  const h = Math.max(0, Math.round(WINDOW_M / g.cell / 2 - 0.5));
  const box = boxMean(g, h);

  // track: the steepest box near the point; it is also where the slope search starts.
  const rt = TRACK_M / g.cell;
  let track = -Infinity, seed = -1;
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      if ((r - mid) ** 2 + (c - mid) ** 2 > rt * rt) continue;
      const v = box[r * n + c];
      if (v > track) {
        track = v;
        seed = r * n + c;
      }
    }
  if (!Number.isFinite(track)) return { track: null, slope: null, slopeArea: 0 };

  let slope = track, cells = 0;
  if (track >= SLOPE_MIN_DEG) {
    // Facing direction where the search starts (a unit vector, east/north);
    // unknown (no elevation, or flat) = no aspect rule and no strip.
    const dir = g.elev ? downhill({ ...g, elev: g.elev }, h) : null;
    const len0 = dir ? Math.hypot(dir.e[seed], dir.n[seed]) : 0;
    const ref = len0 > 1e-6 ? { e: dir!.e[seed] / len0, n: dir!.n[seed] / len0 } : null;
    const minCos = Math.cos((ASPECT_TOL_DEG * Math.PI) / 180);
    const sr = Math.floor(seed / n), sc = seed % n;
    const onSlope = (j: number, r: number, c: number): boolean => {
      if (!ref) return true;
      // Distance across the fall line through the start (rows run south, so north is -row).
      const east = (c - sc) * g.cell, north = (sr - r) * g.cell;
      if (Math.abs(east * ref.n - north * ref.e) > STRIP_M) return false;
      const a = dir!.e[j], b = dir!.n[j], len = Math.hypot(a, b);
      return len > 0 && (a * ref.e + b * ref.n) / len >= minCos; // NaN → false
    };

    const rs = SLOPE_RADIUS_M / g.cell;
    const seen = new Uint8Array(n * n);
    const stack = [seed];
    seen[seed] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      cells++;
      if (box[i] > slope) slope = box[i];
      const r = Math.floor(i / n), c = i % n;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
        const j = rr * n + cc;
        if (seen[j] || !g.ok[j] || g.slope[j] < SLOPE_MIN_DEG) continue;
        if ((rr - mid) ** 2 + (cc - mid) ** 2 > rs * rs) continue;
        if (!onSlope(j, rr, cc)) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
  }
  return { track, slope, slopeArea: cells * g.cell * g.cell };
}
