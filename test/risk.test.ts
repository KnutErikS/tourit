import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ELEVATED, HIGH, MSA_KNOTS, aof, dce, dceFor, exposedSectors, logInterp, munter, rf1, rf2, slabsClass, slabsRisk, type MunterInput,
} from '../src/domain/risk.ts';
import { neighbourhood, type SlopeGrid } from '../src/domain/slopeWindow.ts';
import type { NveProblemRaw } from '../src/types.ts';

const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test('logInterp: the knots, log-linear between, flat beyond', () => {
  near(logInterp(MSA_KNOTS, 30), 9.6);
  near(logInterp(MSA_KNOTS, 22.5), Math.sqrt(1 * 2.9)); // halfway in log space
  near(logInterp(MSA_KNOTS, 10), 1);
  near(logInterp(MSA_KNOTS, 60), 210);
});

test('SLABS cut-offs: Stop or Go’s limits land near "elevated"', () => {
  const at = (msa: number, level: number) => slabsRisk({ msa, level, dce: 0, aof: 1 }) / ELEVATED;
  near(at(35, 3), 1); // the anchor
  assert.ok(at(40, 2) > 0.7 && at(40, 2) < 1, `level 2, 40°: ${at(40, 2)}`);
  assert.ok(at(30, 4) > 0.7 && at(30, 4) < 1, `level 4, 30°: ${at(30, 4)}`);
  near(HIGH / ELEVATED, 4.3);
  assert.equal(slabsClass(slabsRisk({ msa: 30, level: 3, dce: 0, aof: 1 })), 'low');
  assert.equal(slabsClass(slabsRisk({ msa: 38, level: 3, dce: 500, aof: 1 })), 'high');
  assert.equal(slabsClass(slabsRisk({ msa: 38, level: 3, dce: -500, aof: 0 })), 'low'); // far below the heights, other aspects
});

test('DCE: metres into the critical heights, negative outside', () => {
  const p = (fill: number, h1: number, h2 = 0): NveProblemRaw => ({ ExposedHeightFill: fill, ExposedHeight1: h1, ExposedHeight2: h2 });
  assert.equal(dceFor(p(1, 700), 900), 200); // above 700
  assert.equal(dceFor(p(1, 700), 500), -200);
  assert.equal(dceFor(p(2, 400), 300), 100); // below 400
  assert.equal(dceFor(p(4, 300, 800), 500), 200); // between: 200 from the nearest edge
  assert.equal(dceFor(p(4, 300, 800), 900), -100);
  assert.equal(dceFor(p(3, 300, 800), 200), 100); // below 300 or above 800
  assert.equal(dceFor(p(3, 300, 800), 500), -200);
  assert.equal(dceFor(p(0, 0), 500), null); // all heights
  assert.equal(dce([p(1, 700), p(2, 400)], 600), -100); // the most critical problem
  assert.equal(dce([], 600), 500);
});

test('AOF: share of the steep terrain facing the warning’s aspects', () => {
  const exposed = exposedSectors([{ exp: [true, true, false, false, false, false, false, true] }]);
  assert.equal(aof([10, 0, 0, 0, 30, 0, 0, 0], exposed), 0.25);
  assert.equal(aof([0, 0, 0, 0, 0, 0, 0, 0], exposed), 0);
  assert.ok(exposedSectors([{ exp: null }]).every(Boolean));
  assert.ok(exposedSectors([]).every(Boolean));
});

test('Munter factors', () => {
  // bergundsteigen 4/2001: 35–39° → 2, around 35° → 3, 30–34° → 4; whole degrees.
  // Under 30° → 8 is our choice.
  assert.deepEqual([42, 40, 39, 37, 36, 35, 34, 32, 30, 29, 25].map(rf1), [1, 1, 2, 2, 2, 3, 4, 4, 4, 8, 8]);
  assert.deepEqual([39.6, 39.4, 35.4, 34.6, 34.4, 29.6, 29.4].map(rf1), [1, 2, 3, 3, 4, 4, 8]);
  const base = { sector: 0, inCore: true, allAspects: false, wet: false };
  assert.equal(rf2(base), 1); // north
  assert.equal(rf2({ ...base, sector: 2 }), 2); // east: outside NW–N–NE, inside WNW–N–ESE
  assert.equal(rf2({ ...base, sector: 4 }), 3); // south
  assert.equal(rf2({ ...base, inCore: false }), 4);
  assert.equal(rf2({ ...base, sector: 4, wet: true }), 1); // void in wet snow
  assert.equal(rf2({ ...base, sector: 4, allAspects: true }), 1);
  assert.equal(rf2({ ...base, inCore: false, allAspects: true }), 4); // outside the heights still counts
});

test('Munter: residual risk and the level rules', () => {
  const m = (o: Partial<MunterInput>) => munter({ level: 3, steepest: 37, sector: 0, inCore: true, allAspects: false, wet: false, group: 'small', ...o });
  const north = m({});
  assert.deepEqual([north.rr, north.ok], [2, false]); // 8 / (2 · 1 · 2)
  const south = m({ sector: 4 });
  assert.ok(south.ok && Math.abs(south.rr - 8 / 12) < 1e-9);
  const tooSteep = m({ steepest: 42, sector: 4, group: 'smallSpaced', inCore: false });
  assert.equal(tooSteep.ok, false); // 8 / (1 · 4 · 3) < 1, but level 3 needs a 1st-class factor
  assert.match(tooSteep.rule!, /under 40°/);
  assert.equal(m({ level: 4, steepest: 32, inCore: false, group: 'smallSpaced' }).ok, false); // 30–34° → 4 now, but level 4 needs under 30°
  assert.match(m({ level: 4, steepest: 32 }).rule!, /under 30°/);
  // Level 4 under 30°: 16 / (8 · 1 · 2) = 1, acceptable.
  const flat4 = m({ level: 4, steepest: 25 });
  assert.deepEqual([flat4.rf1, flat4.rr, flat4.ok, flat4.rule], [8, 1, true, undefined]);
  // The bergundsteigen/Powderguide example: level 3, ~34°, NE (no 2nd-class factor), small group → 8 / (4 · 1 · 2) = 1, acceptable.
  const ex = m({ steepest: 34, sector: 1, group: 'small' });
  assert.deepEqual([ex.rf1, ex.rr, ex.ok], [4, 1, true]);
  assert.equal(m({ steepest: 34, sector: 1, group: 'smallSpaced' }).rr, 8 / 12);
  const l2 = m({ level: 2, steepest: 42 }); // no level rule at 2, but 4 / (1 · 1 · 2) = 2
  assert.deepEqual([l2.rr, l2.ok, l2.rule], [2, false, undefined]);
});

test('neighbourhood: 85th percentile, steep cells by aspect, facing direction', () => {
  // 21 × 21 cells of 5 m (radius 40 m covers the middle 17 × 17), a north-facing 30° plane.
  const size = 21, cell = 5, N = size * size;
  const slope = new Float32Array(N).fill(30), ok = new Uint8Array(N).fill(1), sector = new Uint8Array(N); // all sector 0 (N)
  const elev = new Float32Array(N);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) elev[r * size + c] = Math.tan((30 * Math.PI) / 180) * cell * r; // rises to the south
  // A steeper strip in the east part, facing east.
  for (let r = 0; r < size; r++) for (let c = 14; c < size; c++) ((slope[r * size + c] = 45), (sector[r * size + c] = 2));
  const g: SlopeGrid = { size, cell, slope, ok, elev, sector };
  const nb = neighbourhood(g);
  assert.equal(nb.msa, 45); // over 15 % of the circle is the 45° strip
  assert.equal(nb.sector, 0);
  assert.ok(nb.steepBySector[0] > 0 && nb.steepBySector[2] > 0 && nb.steepBySector[4] === 0);
});
