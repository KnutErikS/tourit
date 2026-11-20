/**
 * The terrain horizon around a point: for each compass direction, how high
 * (degrees) the surrounding terrain reaches, as seen from the point. The sun
 * only reaches the point when it is above this horizon.
 *
 * Marches out along HORIZON_DIRS directions from R_MIN to R_MAX metres, with
 * steps of STEP_MIN m, growing to STEP_SHARE of the distance further out.
 * Terrain up to NEAR_MAX m comes from the `near` sampler (fine DEM), beyond
 * it from `far` (coarse DEM). The earth's curvature lowers distant terrain,
 * and refraction lifts it a little back (coefficient REFRACTION_K): at 20 km
 * together ~27 m.
 *
 * Terrain closer than R_MIN is left out: that is the slope you stand on,
 * which the sun-on-slope angle already handles.
 *
 * Pure: no runtime imports.
 */

export const HORIZON_DIRS = 180; // every 2°
export const R_MIN = 50;
export const R_MAX = 20_000;
export const NEAR_MAX = 4_000;
const STEP_MIN = 15;
const STEP_SHARE = 0.02;
const EARTH_R = 6_371_000;
export const REFRACTION_K = 0.13;

/** Elevation (m) at `east`/`north` metres from the point; NaN where unknown. */
export type Sampler = (east: number, north: number) => number;

/** Horizon angle per direction, degrees; index i is azimuth i × 360 / length, clockwise from north. */
export type Horizon = Float32Array;

/** The horizon seen from height `z0` (m) at the point. */
export function computeHorizon(near: Sampler, far: Sampler, z0: number, dirs = HORIZON_DIRS): Horizon {
  const out = new Float32Array(dirs);
  for (let i = 0; i < dirs; i++) {
    const az = ((i * 360) / dirs) * (Math.PI / 180);
    const se = Math.sin(az), sn = Math.cos(az);
    let best = -90;
    for (let r = R_MIN; r <= R_MAX; r += Math.max(STEP_MIN, r * STEP_SHARE)) {
      const e = r * se, n = r * sn;
      let z = r <= NEAR_MAX ? near(e, n) : NaN;
      if (!Number.isFinite(z)) z = far(e, n);
      if (!Number.isFinite(z)) continue;
      const drop = ((r * r) / (2 * EARTH_R)) * (1 - REFRACTION_K);
      const a = (Math.atan2(z - drop - z0, r) * 180) / Math.PI;
      if (a > best) best = a;
    }
    out[i] = best;
  }
  return out;
}

/** The horizon angle towards azimuth `az` (degrees from north), interpolated between directions. */
export function horizonAt(h: Horizon, az: number): number {
  const n = h.length, x = ((((az % 360) + 360) % 360) * n) / 360;
  const i = Math.floor(x) % n, t = x - Math.floor(x);
  return h[i] * (1 - t) + h[(i + 1) % n] * t;
}
