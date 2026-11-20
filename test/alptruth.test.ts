import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alptruth, type AlptruthInput, type ClueKey } from '../src/domain/alptruth.ts';
import type { SignGroup } from '../src/domain/signs.ts';

const none: SignGroup = { n: 0, score: 0, on: false, kinds: [], labels: [] };
const group = (n: number, score: number, labels: string[]): SignGroup => ({ n, score, on: score >= 1, kinds: [], labels });

/** A quiet day: warning level 2, gentle terrain, no new snow, no signs, cold. */
const quiet: AlptruthInput = {
  level: 2,
  signs: { avalanche: none, loading: none, unstable: none, thaw: none },
  steep: 22,
  zone: null,
  loading: { newSnowCm: 4, heavySnow: false, rapid: { on: false, runH: 0, byRun: false, water24: 2, byWater: false } },
  lee: false,
  thaw: { on: false, warm: false, maxTemp: -4, rainMm: 0, rain: false },
};
const run = (o: Partial<AlptruthInput>, mine = {}) => alptruth({ ...quiet, ...o }, mine);
const clue = (r: ReturnType<typeof alptruth>, k: ClueKey) => r.clues.find((c) => c.key === k)!;

test('a quiet day: no clues; terrain trap is yours to judge', () => {
  const r = run({});
  assert.equal(r.count, 0);
  assert.equal(r.red, false);
  assert.deepEqual(
    r.clues.map((c) => [c.key, c.auto]),
    [['A', false], ['L', false], ['P', false], ['T', null], ['R', false], ['U', false], ['Th', false]],
  );
});

test('R: level 3 or higher; unknown without a warning', () => {
  assert.equal(clue(run({ level: 3 }), 'R').auto, true);
  assert.equal(clue(run({ level: 0 }), 'R').auto, null);
});

test('P: 30° where you are, or NVE’s steep terrain or runout; unknown without terrain', () => {
  assert.equal(clue(run({ steep: 31 }), 'P').auto, true);
  const runout = clue(run({ zone: 'medium' }), 'P');
  assert.equal(runout.auto, true);
  assert.match(runout.why[0], /utløpssone/);
  assert.equal(clue(run({ steep: null, zone: undefined }), 'P').auto, null);
});

test('L: heavy new snow, rask oppbygging, a lee slope or Regobs loading signs', () => {
  const rapid = { on: true, runH: 4, byRun: true, water24: 12, byWater: false };
  const r = clue(run({ loading: { newSnowCm: 9, heavySnow: false, rapid } }), 'L');
  assert.equal(r.auto, true);
  assert.match(r.why.join(' '), /Rask oppbygging: 4 t på rad/);
  assert.equal(clue(run({ lee: true }), 'L').auto, true);
  const signs = { ...quiet.signs!, loading: group(1, 1, ['fersk vindtransportert snø']) };
  assert.equal(clue(run({ signs }), 'L').auto, true);
  assert.equal(clue(run({ loading: null, lee: null, signs: null }), 'L').auto, null);
});

test('A and U: weighted Regobs signs; far-away reports are shown but don’t turn it on', () => {
  const near = { ...quiet.signs!, avalanche: group(2, 1.5, ['ferske skred']) };
  assert.equal(clue(run({ signs: near }), 'A').auto, true);
  const far = { ...quiet.signs!, unstable: group(1, 0.25, ['drønn i snøen']) };
  const u = clue(run({ signs: far }), 'U');
  assert.equal(u.auto, false);
  assert.match(u.why[0], /Drønn i snøen: 1 melding.*langt fra/);
  assert.equal(clue(run({ signs: null }), 'A').auto, null);
});

test('Th: above 0 °C or rain during the day', () => {
  const t = clue(run({ thaw: { on: true, warm: true, maxTemp: 2, rainMm: 0, rain: false } }), 'Th');
  assert.equal(t.auto, true);
  assert.match(t.why[0], /Over 0 °C/);
});

test('your ticks win over the data, and 3 clues turn it red', () => {
  const base = run({ level: 3, steep: 33 }); // R + P
  assert.deepEqual([base.count, base.red], [2, false]);
  const withTrap = run({ level: 3, steep: 33 }, { T: true });
  assert.deepEqual([withTrap.count, withTrap.red], [3, true]);
  assert.equal(clue(withTrap, 'T').mine, true);
  const untick = run({ level: 3, steep: 33 }, { T: true, P: false });
  assert.equal(clue(untick, 'P').on, false);
  assert.equal(clue(untick, 'P').auto, true);
  assert.equal(untick.count, 2);
});
