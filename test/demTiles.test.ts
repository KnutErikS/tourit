import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, tileBytes, type ElevationGrid } from '../src/terrain/analyze.ts';
import { TileCache } from '../src/terrain/tileCache.ts';

/** A rough (n+2)² terrain: a few tilted planes and bumps, so slopes span 0–60° and every aspect. */
function terrain(n: number, cell: number): ElevationGrid {
  const W = n + 2, px = new Float32Array(W * W);
  for (let r = 0; r < W; r++)
    for (let c = 0; c < W; c++)
      px[r * W + c] = 900 + 0.9 * cell * c * Math.sin(r / 7) + 40 * Math.sin(c / 3) * Math.cos(r / 4) + 0.37 * r * cell + ((r * 31 + c * 17) % 7) * 0.13;
  return { width: W, height: W, pixels: [px], mask: null };
}

const N = 64, CELL = 4.5;
// res/ytop for ~62° N in Web Mercator (only the latitude correction uses them).
const RES = CELL / Math.cos((62 * Math.PI) / 180), YTOP = 8_859_000;
const grid = terrain(N, CELL);
const precise = analyze(grid, RES, YTOP, N);
const compact = analyze(grid, RES, YTOP, N, true);

test('compact tiles take half the memory', () => {
  assert.equal(precise.compact, false);
  assert.equal(compact.compact, true);
  assert.equal(tileBytes(precise), N * N * 10);
  assert.equal(tileBytes(compact), N * N * 5);
});

test('the test terrain covers steep and gentle cells', () => {
  const s = [...precise.slope].filter((_, i) => precise.ok[i]);
  assert.ok(Math.min(...s) < 15 && Math.max(...s) > 45, `${Math.min(...s)}–${Math.max(...s)}`);
});

test('compact gives the same answer as precise for every whole-degree slope threshold', () => {
  for (let i = 0; i < N * N; i++) {
    assert.equal(compact.ok[i], precise.ok[i]);
    assert.equal(compact.sector[i], precise.sector[i]);
    for (let t = 0; t <= 60; t++) assert.equal(compact.slope[i] >= t, precise.slope[i] >= t, `cell ${i}, ${precise.slope[i]}° vs ${t}°`);
  }
});

test('compact gives the same answer as precise for whole-metre height limits', () => {
  for (let i = 0; i < N * N; i++) {
    if (!precise.ok[i]) continue;
    const z = precise.elev[i];
    for (const h of [Math.floor(z) - 1, Math.floor(z), Math.ceil(z), Math.ceil(z) + 1]) {
      assert.equal(compact.elev[i] >= h, z >= h);
      assert.equal(compact.elev[i] < h, z < h);
    }
  }
});

test('elevations below sea level round down too', () => {
  const W = 3, px = new Float32Array(W * W).fill(-12.4);
  const t = analyze({ width: W, height: W, pixels: [px], mask: null }, 10, 0, 1, true);
  assert.equal(t.elev[0], -13);
});

/* ---------- the tile cache ---------- */

const sized = (bytes: number) => Promise.resolve(bytes);
const settle = () => new Promise((r) => setTimeout(r));

test('cache: evicts least recently used once over budget', async () => {
  const c = new TileCache<number>(250, (v) => v);
  c.set('a', sized(100));
  c.set('b', sized(100));
  await settle();
  c.get('a'); // a is now the most recently used
  c.set('c', sized(100));
  await settle();
  assert.equal(c.get('b'), undefined, 'b was least recently used');
  assert.ok(c.get('a') && c.get('c'));
  assert.equal(c.bytes, 200);
});

test('cache: never evicts the entry just stored, even if it alone is over budget', async () => {
  const c = new TileCache<number>(50, (v) => v);
  c.set('big', sized(100));
  await settle();
  assert.ok(c.get('big'));
  assert.equal(c.bytes, 100);
});

test('cache: pending entries are kept, failed ones dropped', async () => {
  const c = new TileCache<number>(10, (v) => v);
  let resolve!: (v: number) => void;
  c.set('slow', new Promise<number>((r) => (resolve = r)));
  c.set('x', sized(100));
  const bad = Promise.reject(new Error('HTTP 500'));
  bad.catch(() => {});
  c.set('bad', bad);
  await settle();
  assert.ok(c.get('slow'), 'pending entry survives eviction');
  assert.equal(c.get('bad'), undefined);
  resolve(5);
  await settle();
  assert.equal(c.bytes, 5 + 100 - 100, 'x went when slow was counted');
});
