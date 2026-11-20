import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHorizon, horizonAt, HORIZON_DIRS } from '../src/domain/horizon.ts';
import { daylight, sunDay, sunOnSlope } from '../src/domain/sun.ts';

const flat = () => 100;

test('flat terrain: the horizon dips a little below level (eye height, earth curvature)', () => {
  const h = computeHorizon(flat, flat, 102);
  assert.equal(h.length, HORIZON_DIRS);
  assert.ok(h.every((a) => a < 0 && a > -0.5), `range ${Math.min(...h)}–${Math.max(...h)}`);
});

test('a ridge 1 km to the north, 500 m high, blocks ~29° to the north only', () => {
  const ridge = (_e: number, n: number) => (n > 950 && n < 1050 ? 600 : 100);
  const h = computeHorizon(ridge, flat, 100);
  const north = horizonAt(h, 0), south = horizonAt(h, 180), east = horizonAt(h, 90);
  assert.ok(north > 26 && north < 29, `north ${north}`);
  assert.ok(south < 0.5, `south ${south}`);
  assert.ok(east < 0.5, `east ${east}`);
});

test('far terrain comes from the far sampler beyond 4 km, near terrain from the near one', () => {
  const far = (e: number) => (e > 9000 && e < 11_000 ? 1100 : 100);
  // The near sampler must not be asked beyond 4 km: a 9999 m wall there would show.
  const nearOnlyClose = (e: number) => (e > 5000 ? 9999 : 100);
  const east = horizonAt(computeHorizon(nearOnlyClose, far, 100), 90);
  assert.ok(east > 6 && east < 6.5, `1000 m, front at 9 km ≈ 6,3° less curvature, got ${east}`);
  // … and up to 4 km it is: a 1000 m wall at 3 km ≈ 18,4°.
  const nearWall = (e: number) => (e > 3000 && e < 3200 ? 1100 : 100);
  const east2 = horizonAt(computeHorizon(nearWall, flat, 100), 90);
  assert.ok(east2 > 17 && east2 < 19, `got ${east2}`);
});

test('unknown terrain (NaN) is skipped', () => {
  const none = () => NaN;
  assert.ok(computeHorizon(none, none, 0).every((a) => a === -90));
});

test('horizonAt interpolates and wraps around north', () => {
  const h = new Float32Array(4).fill(0);
  h[0] = 10; // north
  assert.equal(horizonAt(h, 0), 10);
  assert.equal(horizonAt(h, 45), 5);
  assert.equal(horizonAt(h, 315), 5);
  assert.equal(horizonAt(h, 360 + 45), 5);
});

test('sun with a horizon: a high wall hides it, a low one changes nothing', () => {
  const day = sunDay('2026-03-14', 69.6, 20.2);
  const open = sunOnSlope(day, 30, 180);
  assert.ok(open.spans.length > 0);
  assert.deepEqual(sunOnSlope(day, 30, 180, () => -90).spans, open.spans);
  assert.equal(sunOnSlope(day, 30, 180, () => 45).spans.length, 0);
  const dl = daylight(day, () => 45);
  assert.ok(dl.sun.length > 0 && dl.overTerrain!.length === 0 && dl.overTerrainMin === 0);
  assert.equal(daylight(day).overTerrain, undefined);
});
