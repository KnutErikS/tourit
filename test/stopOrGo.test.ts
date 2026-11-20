import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signsEnd, stopOrGo, usedLevel, type StopOrGoInput } from '../src/domain/stopOrGo.ts';

const base: StopOrGoInput = { level: 3, inCore: true, signs: false, steepTrack: 30, steepSlope: 30, inRunout: false };
const run = (o: Partial<StopOrGoInput>) => stopOrGo({ ...base, ...o });

test('usedLevel: one lower outside the core zone, one higher with signs, kept within 1–5', () => {
  assert.equal(usedLevel(3, true, false), 3);
  assert.equal(usedLevel(3, false, false), 2);
  assert.equal(usedLevel(3, true, true), 4);
  assert.equal(usedLevel(3, false, true), 3);
  assert.equal(usedLevel(1, false, false), 1);
  assert.equal(usedLevel(5, true, true), 5);
  assert.equal(usedLevel(0, true, true), 0);
});

test('unknown core zone (no terrain yet) counts as inside, with a reason', () => {
  assert.equal(usedLevel(3, null, false), 3);
  assert.equal(usedLevel(3, null, true), 4);
  const r = run({ level: 3, inCore: null, steepSlope: 36 });
  assert.equal(r.used, 3);
  assert.equal(r.status, 'stop');
  assert.deepEqual(r.adjustments.map((x) => x.dir), ['same']);
  assert.match(r.adjustments[0].text, /Kjenner ikke himmelretning/);
});

test('signsEnd: end of a past day, now for today and for future days', () => {
  const now = new Date('2026-02-10T14:30:00').getTime();
  assert.equal(signsEnd('2026-02-08', now), new Date('2026-02-08T23:59:59').getTime());
  assert.equal(signsEnd('2026-02-10', now), now);
  // Planning tomorrow: the 48 h window must still include what was reported today.
  assert.equal(signsEnd('2026-02-11', now), now);
});

test('no warning gives none', () => {
  assert.equal(run({ level: 0 }).status, 'none');
});

test('level 1: no limit, caution on spots of 40° and more', () => {
  assert.equal(run({ level: 1, steepTrack: 39 }).status, 'go');
  assert.equal(run({ level: 1, steepTrack: 42 }).status, 'caution');
});

test('level 2 uses the track, limit 40°', () => {
  assert.equal(run({ level: 2, steepTrack: 36, steepSlope: 45 }).status, 'go');
  assert.equal(run({ level: 2, steepTrack: 38.5 }).status, 'caution');
  assert.equal(run({ level: 2, steepTrack: 40 }).status, 'stop');
});

test('level 3 uses the whole slope, limit 35°', () => {
  const r = run({ level: 3, steepTrack: 28, steepSlope: 36 });
  assert.equal(r.status, 'stop');
  assert.equal(r.area, 'slope');
  assert.equal(r.limit, 35);
  assert.equal(run({ level: 3, steepSlope: 31 }).status, 'go');
});

test('level 3 outside the core zone is judged as level 2', () => {
  const r = run({ level: 3, inCore: false, steepTrack: 36, steepSlope: 38 });
  assert.equal(r.used, 2);
  assert.equal(r.status, 'go');
});

test('signs of instability move level 2 up to 3', () => {
  const r = run({ level: 2, signs: true, steepTrack: 30, steepSlope: 37 });
  assert.equal(r.used, 3);
  assert.equal(r.status, 'stop');
});

test('level 4: below 30° and out of runout zones', () => {
  assert.equal(run({ level: 4, steepSlope: 25 }).status, 'go');
  assert.equal(run({ level: 4, steepSlope: 25, inRunout: true }).status, 'stop');
  assert.equal(run({ level: 4, steepSlope: 31 }).status, 'stop');
});

test('missing terrain gives none, with a reason', () => {
  const r = run({ steepTrack: null, steepSlope: null });
  assert.equal(r.status, 'none');
  assert.match(r.reasons[0], /terrengdata/);
});

test('adjustments: one row per change of level, with its direction', () => {
  const r = run({ level: 3, inCore: false, signs: true, steepSlope: 33 });
  assert.deepEqual(r.adjustments.map((x) => x.dir), ['down', 'up']);
  assert.equal(r.used, 3);
  assert.deepEqual(run({}).adjustments, []);
});
