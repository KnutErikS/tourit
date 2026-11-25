import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cluster } from '../src/layers/cluster.ts';

const pt = (x: number, y: number, id = `${x},${y}`) => ({ id, x, y });
const at = (p: { x: number; y: number }) => p;

test('points within the radius share a cluster, at their mean position', () => {
  const c = cluster([pt(0, 0), pt(10, 0), pt(20, 0)], at, 44);
  assert.equal(c.length, 1);
  assert.equal(c[0].items.length, 3);
  assert.equal(c[0].x, 10);
});

test('points further apart than the radius stay apart', () => {
  const c = cluster([pt(0, 0), pt(100, 0), pt(0, 100)], at, 44);
  assert.equal(c.length, 3);
});

test('a cell boundary does not split close points', () => {
  // 43 and 45 lie in different 44 px cells but 2 px apart.
  assert.equal(cluster([pt(43, 0), pt(45, 0)], at, 44).length, 1);
});

test('every point ends up in exactly one cluster, and the same input gives the same clusters', () => {
  const pts = Array.from({ length: 2000 }, (_, i) => pt((i * 37) % 997, (i * 61) % 503, String(i)));
  const a = cluster(pts, at, 44), b = cluster(pts, at, 44);
  assert.equal(a.reduce((n, c) => n + c.items.length, 0), pts.length);
  assert.equal(new Set(a.flatMap((c) => c.items.map((p) => p.id))).size, pts.length);
  assert.deepEqual(a.map((c) => c.items.map((p) => p.id)), b.map((c) => c.items.map((p) => p.id)));
  // Dense points collapse into far fewer badges.
  assert.ok(a.length < pts.length / 4, `${a.length} clusters`);
});
