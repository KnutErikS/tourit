import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadingBefore, mergeSteps, newSnowCm, rapidLoading, thaw, type PrecipStep } from '../src/domain/precip.ts';

const END = Date.parse('2026-02-10T10:00:00Z');
const H = 3_600_000;
/** A step starting `hAgo` hours before END. */
const step = (hAgo: number, hours: number, snowMm: number, temp = -5, precip = snowMm): PrecipStep => ({
  time: END - hAgo * H,
  hours,
  temp,
  precip,
  snowMm,
});
/** Hourly steps covering the 48 h before END, all dry and cold. */
const dry = () => Array.from({ length: 48 }, (_, i) => step(48 - i, 1, 0));

test('rask oppbygging: 3 h in a row at ≥ 2.5 mm/h as snow', () => {
  const three = [step(10, 1, 2.5), step(9, 1, 3), step(8, 1, 2.6)];
  assert.equal(rapidLoading(three, END).byRun, true);
  assert.equal(rapidLoading(three.slice(0, 2), END).on, false);
  const gap = [step(10, 1, 3), step(9, 1, 3), step(7, 1, 3)];
  assert.equal(rapidLoading(gap, END).runH, 2);
  // MET's 6-hour steps: 15 mm of snow in 6 h is 2.5 mm/h for 6 h.
  assert.equal(rapidLoading([step(20, 6, 15)], END).runH, 6);
});

test('rask oppbygging: ≥ 25 mm water in the last 24 h, rain included', () => {
  const rain = [step(12, 6, 0, 2, 13), step(6, 6, 0, 2, 13)];
  const r = rapidLoading(rain, END);
  assert.equal(r.byWater, true);
  assert.equal(r.water24, 26);
  // The same 26 mm, but 30–42 h ago: not in the last 24 h.
  assert.equal(rapidLoading([step(42, 6, 0, 2, 13), step(36, 6, 0, 2, 13)], END).byWater, false);
});

test('newSnowCm: colder snow is lighter, partial steps count by the part inside', () => {
  assert.equal(newSnowCm([step(5, 1, 10, -5)], END - 48 * H, END), 12);
  assert.equal(newSnowCm([step(5, 1, 10, -12)], END - 48 * H, END), 15);
  const partial = newSnowCm([step(50, 6, 10, -5)], END - 48 * H, END); // 4 of 6 h inside
  assert.ok(Math.abs(partial - 8) < 1e-9, `partial ${partial}`);
});

test('loadingBefore: needs the 48 h covered; > 15 cm is heavy snow', () => {
  assert.equal(loadingBefore([step(1, 1, 5)], END), null);
  const quiet = loadingBefore(dry(), END)!;
  assert.deepEqual([quiet.heavySnow, quiet.rapid.on], [false, false]);
  const snowy = dry().map((s, i) => (i >= 30 ? { ...s, snowMm: 1, precip: 1 } : s)); // 18 mm at −5 °C ≈ 21.6 cm
  assert.equal(loadingBefore(snowy, END)!.heavySnow, true);
});

test('thaw: above 0 °C, or at least 0.5 mm rain; null without steps', () => {
  const from = END, to = END + 8 * H;
  const at = (hAfter: number, temp: number, precip = 0, snowMm = 0) => ({ time: END + hAfter * H, hours: 1, temp, precip, snowMm });
  assert.equal(thaw([at(1, -3), at(4, -1)], from, to)!.on, false);
  const warm = thaw([at(1, -3), at(4, 1.5)], from, to)!;
  assert.deepEqual([warm.on, warm.warm, warm.maxTemp], [true, true, 1.5]);
  assert.equal(thaw([at(2, -0.5, 1, 0.2)], from, to)!.rain, true); // 0.8 mm not as snow
  assert.equal(thaw([at(2, -0.5, 0.3, 0)], from, to)!.on, false);
  assert.equal(thaw([], from, to), null);
});

/* ---------- mergeSteps: history, then the forecast ---------- */

{
  const t0 = Date.UTC(2026, 0, 10, 0);
  const step = (h: number, temp: number) => ({ time: t0 + h * H, hours: 1, temp, precip: 1, snowMm: 1 });

  test('mergeSteps: history up to where the forecast starts, then the forecast', () => {
    const history = [0, 1, 2, 3, 4, 5].map((h) => step(h, -10));
    const forecast = [3, 4, 5, 6].map((h) => step(h, -1));
    const m = mergeSteps(history, forecast);
    assert.deepEqual(m.map((s) => (s.time - t0) / H), [0, 1, 2, 3, 4, 5, 6]);
    assert.deepEqual(m.map((s) => s.temp), [-10, -10, -10, -1, -1, -1, -1]);
  });

  test('mergeSteps: without a forecast, all of the history counts', () => {
    const history = [0, 1, 2].map((h) => step(h, -5));
    assert.equal(mergeSteps(history, []).length, 3);
  });

  test('mergeSteps: a 6 h forecast step still wins over the hours it covers', () => {
    const history = [0, 1, 2].map((h) => step(h, -5));
    const m = mergeSteps(history, [{ time: t0 + 2 * H, hours: 6, temp: 0, precip: 6, snowMm: 0 }]);
    assert.deepEqual(m.map((s) => (s.time - t0) / H), [0, 1, 2]);
    assert.equal(m[2].hours, 6);
  });
}
