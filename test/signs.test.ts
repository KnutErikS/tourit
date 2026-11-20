import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ectClass, signGroup, signsAt, weightFor } from '../src/domain/signs.ts';
import type { RegobsObs } from '../src/types.ts';

const END = Date.parse('2026-02-10T12:00:00Z');
const H = 3_600_000;
const iso = (t: number) => new Date(t).toISOString();
let id = 0;
/** A report `hAgo` hours before END at `height` m with these danger-sign codes. */
const sign = (hAgo: number, codes: number[], height?: number, more: Partial<RegobsObs> = {}): RegobsObs => ({
  RegId: ++id,
  DtObsTime: iso(END - hAgo * H),
  ObsLocation: { Height: height },
  DangerObs: codes.map((c) => ({ DangerSignTID: c })),
  ...more,
});

test('ectClass follows SLF’s four classes', () => {
  assert.equal(ectClass({ PropagationTID: 21 }), 1); // ECTPV
  assert.equal(ectClass({ PropagationTID: 22, TapsFracture: 13 }), 1);
  assert.equal(ectClass({ PropagationTID: 22, TapsFracture: 14 }), 2);
  assert.equal(ectClass({ PropagationTID: 22, TapsFracture: 22 }), 2);
  assert.equal(ectClass({ PropagationTID: 22, TapsFracture: 25 }), 3);
  assert.equal(ectClass({ PropagationTID: 23, TapsFracture: 8 }), 3); // ECTN ≤ 10
  assert.equal(ectClass({ PropagationTID: 23, TapsFracture: 16 }), 4);
  assert.equal(ectClass({ PropagationTID: 24 }), 4); // ECTX
  assert.equal(ectClass({ PropagationTID: 22 }), null);
  assert.equal(ectClass({ PropagationTID: 0, TapsFracture: 5 }), null); // not an ECT
});

test('weight: near the point’s height counts 1, then 0.5 and 0.25; unknown counts 1', () => {
  assert.equal(weightFor(sign(1, [3], 1150), { elev: 1000 }), 1);
  assert.equal(weightFor(sign(1, [3], 1400), { elev: 1000 }), 0.5);
  assert.equal(weightFor(sign(1, [3], 1700), { elev: 1000 }), 0.25);
  assert.equal(weightFor(sign(1, [3]), { elev: 1000 }), 1);
  assert.equal(weightFor(sign(1, [3], 1700), {}), 1);
});

test('weight: an avalanche on the point’s aspect or a neighbour counts 1, others 0.5', () => {
  const east = sign(1, [], 1000, { AvalancheObs: { ValidExposition: '00100000' } });
  assert.equal(weightFor(east, { elev: 1000, sector: 2 }), 1); // Ø
  assert.equal(weightFor(east, { elev: 1000, sector: 1 }), 1); // NØ, neighbour
  assert.equal(weightFor(east, { elev: 1000, sector: 6 }), 0.5); // V
  assert.equal(weightFor(east, { elev: 1600, sector: 6 }), 0.125);
});

test('signsAt: only the last 48 h, by kind; "no signs" and "no activity" are not signs', () => {
  const hits = signsAt(
    [
      sign(10, [3, 14], 1000), // whumpf + cracks
      sign(60, [3], 1000), // too old
      sign(5, [1], 1000), // "Ingen faretegn observert"
      sign(5, [], 1000, { AvalancheActivityObs2: [{ EstimatedNumName: 'Ingen skredaktivitet' }] }),
      sign(5, [9], 1000), // wind-transported snow
    ],
    END,
    { elev: 1000 },
  );
  assert.deepEqual(hits.map((h) => h.kind).sort(), ['cracks', 'whumpf', 'windSnow']);
});

test('signsAt: an avalanche counts from when it happened, not when it was reported', () => {
  const old = sign(2, [], 1000, { AvalancheObs: { DtAvalancheTime: iso(END - 96 * H) } });
  const fresh = sign(2, [], 1000, { AvalancheObs: { DtAvalancheTime: iso(END - 20 * H) } });
  assert.equal(signsAt([old], END, {}).length, 0);
  assert.equal(signsAt([fresh], END, {})[0].kind, 'avalanche');
});

test('signsAt: a poor ECT (class 1–2) is a sign, a good one is not', () => {
  const poor = sign(3, [], 1000, { CompressionTest: [{ PropagationTID: 22, TapsFracture: 12 }] });
  const good = sign(3, [], 1000, { CompressionTest: [{ PropagationTID: 23, TapsFracture: 20 }] });
  assert.deepEqual(signsAt([poor, good], END, {}).map((h) => h.kind), ['poorTest']);
});

test('signGroup: each report once, weights add up, on at 1', () => {
  const near = sign(1, [3, 14], 1000), far1 = sign(1, [3], 1400), far2 = sign(1, [14], 1450), farOnly = sign(1, [3], 1450);
  const g = signGroup(signsAt([near], END, { elev: 1000 }), ['whumpf', 'cracks']);
  assert.deepEqual([g.n, g.score, g.on], [1, 1, true]); // one report with two signs counts once
  assert.equal(signGroup(signsAt([far1, far2], END, { elev: 1000 }), ['whumpf', 'cracks']).on, true); // 0.5 + 0.5
  const off = signGroup(signsAt([farOnly], END, { elev: 1000 }), ['whumpf', 'cracks']);
  assert.deepEqual([off.n, off.score, off.on], [1, 0.5, false]);
  assert.deepEqual(g.labels, ['drønn i snøen', 'skytende sprekker']);
});
