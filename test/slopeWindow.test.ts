import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxMean, slopeWindow, type SlopeGrid } from '../src/domain/slopeWindow.ts';

/** size × size grid with 5 m cells, slope from f(row, col). */
function grid(size: number, f: (r: number, c: number) => number): SlopeGrid {
  const slope = new Float32Array(size * size), ok = new Uint8Array(size * size).fill(1);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) slope[r * size + c] = f(r, c);
  return { size, cell: 5, slope, ok };
}

const D = Math.PI / 180;

/** size × size grid from an elevation function z(row, col) (rows run north → south), slope by central differences. */
function fromElev(size: number, cell: number, z: (r: number, c: number) => number): SlopeGrid {
  const N = size * size, elev = new Float32Array(N), slope = new Float32Array(N), ok = new Uint8Array(N);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) elev[r * size + c] = z(r, c);
  for (let r = 1; r < size - 1; r++)
    for (let c = 1; c < size - 1; c++) {
      const gx = (z(r, c + 1) - z(r, c - 1)) / (2 * cell), gy = (z(r + 1, c) - z(r - 1, c)) / (2 * cell);
      slope[r * size + c] = Math.atan(Math.hypot(gx, gy)) / D;
      ok[r * size + c] = 1;
    }
  return { size, cell, slope, ok, elev };
}
/** Rise per 5 m cell for a slope of `deg`. */
const rise = (deg: number) => Math.tan(deg * D) * 5;

test('boxMean of a flat field is the field', () => {
  const b = boxMean(grid(11, () => 25), 2);
  assert.ok(b.every((v) => Math.abs(v - 25) < 1e-6));
});

test('a single steep cell is averaged away (20 × 20 m, not one cell)', () => {
  const w = slopeWindow(grid(81, (r, c) => (r === 40 && c === 40 ? 60 : 10)));
  assert.ok(w.track! < 15, `track ${w.track}`);
});

test('track sees only the point, slope follows the connected steep slope', () => {
  // 32° where the point is, a 42° band 100 m up (rows 15–25), all connected through ≥ 20°.
  const w = slopeWindow(grid(81, (r) => (r >= 15 && r <= 25 ? 42 : 32)));
  assert.ok(Math.abs(w.track! - 32) < 0.5, `track ${w.track}`);
  assert.ok(w.slope! > 41, `slope ${w.slope}`);
});

test('a steep slope beyond flat ground is not "the slope you are on"', () => {
  // Flat (10°) at the point, 45° band 100 m away.
  const w = slopeWindow(grid(81, (r) => (r >= 15 && r <= 25 ? 45 : 10)));
  assert.equal(w.slope, w.track);
  assert.equal(w.slopeArea, 0);
});

test('the search starts from the steepest spot near you, not the exact map cell', () => {
  // 15° under your feet (rows 39+), 30° from 10 m up (rows 20–38), a 42° band above (rows < 20).
  // The 15° cell alone would never start the search; the 30° patch within 10 m does.
  const w = slopeWindow(grid(81, (r) => (r >= 39 ? 15 : r >= 20 ? 30 : 42)));
  assert.ok(w.track! >= 20 && w.track! < 30, `track ${w.track}`);
  assert.ok(w.slope! > 41, `slope ${w.slope}`);
});

test('terrain facing another way (a gully wall beside you) is not your slope', () => {
  // North-facing 30° slope; 75 m to the east a wall rising to the east (≈ 57°, facing north-west).
  const g = fromElev(81, 5, (r, c) => rise(30) * r + rise(55) * Math.max(0, c - 55));
  const w = slopeWindow(g);
  assert.ok(Math.abs(w.track! - 30) < 0.5, `track ${w.track}`);
  assert.ok(w.slope! < 40, `slope ${w.slope}`); // only the bend into the wall counts
  // Without elevation there is no facing direction, and the wall counts.
  assert.ok(slopeWindow({ ...g, elev: undefined }).slope! > 55);
});

test('a steeper band facing the same way is still your slope', () => {
  // North-facing throughout: 30° where you are, 45° from 100 m to the north.
  const w = slopeWindow(fromElev(81, 5, (r) => (r >= 20 ? rise(30) * r : rise(30) * 20 - rise(45) * (20 - r))));
  assert.ok(Math.abs(w.track! - 30) < 0.5, `track ${w.track}`);
  assert.ok(w.slope! > 44, `slope ${w.slope}`);
});

test('only the strip along your fall line counts, not a steep spot off to the side', () => {
  // North-facing 30° slope (rises to the south). A 10 m rock step over 20 m, 50 m uphill (rows 50–54):
  // across the whole slope, it is in your strip; on a patch 90–185 m to the east, it is beside you.
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  const step = (r: number) => 10 * clamp((r - 50) / 4);
  const inStrip = slopeWindow(fromElev(81, 5, (r) => rise(30) * r + step(r)));
  assert.ok(inStrip.slope! > 43, `in strip ${inStrip.slope}`);
  const beside = fromElev(81, 5, (r, c) => rise(30) * r + step(r) * clamp((c - 58) / 4) * clamp((77 - c) / 4));
  const w = slopeWindow(beside);
  assert.ok(Math.abs(w.slope! - 30) < 0.5, `beside ${w.slope}`);
  assert.ok(w.slopeArea < 20_000, `area ${w.slopeArea}`); // ~50 m × 300 m, not the whole 150 m circle
  // Without elevation there is no fall line, so the step beside you counts.
  assert.ok(slopeWindow({ ...beside, elev: undefined }).slope! > 43);
});

test('no valid cells gives nulls', () => {
  const g = grid(21, () => 30);
  g.ok.fill(0);
  assert.deepEqual(slopeWindow(g), { track: null, slope: null, slopeArea: 0 });
});
