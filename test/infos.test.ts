import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FINE_CLOUD, FIRST_FINE_CM, FIRST_FINE_H, FIRST_THAW_CM, FIRST_THAW_H, RAIN_H, RAIN_MIN_MM,
  criticalNewSnow, firstFineDay, firstThaw, rainAround, refreeze, type PrecipStep,
} from '../src/domain/precip.ts';
import { INFO_DEFS, infoRows, infos, type InfoInput } from '../src/domain/infos.ts';
import type { SignGroup } from '../src/domain/signs.ts';

const H = 3_600_000;
const DAY = Date.parse('2026-02-10T00:00:00Z'); // the chosen day starts here
const FROM = DAY + 8 * H, TO = DAY + 16 * H;
/** Hourly steps from `a` to `b` hours after DAY (negative = before), with these values. */
const hours = (a: number, b: number, v: Partial<PrecipStep> = {}): PrecipStep[] =>
  Array.from({ length: b - a }, (_, i) => ({ time: DAY + (a + i) * H, hours: 1, temp: -5, precip: 0, snowMm: 0, ...v }));
/** Dry and cold, from 4 days before the day to its end. */
const base = () => hours(-96, 24);
/** Replace the steps in [a, b) hours with `v`. */
const set = (steps: PrecipStep[], a: number, b: number, v: Partial<PrecipStep>) =>
  steps.map((s) => (s.time >= DAY + a * H && s.time < DAY + b * H ? { ...s, ...v } : s));

test('critical new snow: the class follows the unfavourable conditions', () => {
  const end = DAY + 10 * H;
  // 24 h of 1 mm/h snow at −5 °C (1.2 cm/mm) ≈ 28.8 cm, on fresh snow, in light wind: favourable, 30–50 cm.
  const steps = set(base(), -30, -6, { precip: 1, snowMm: 1 });
  const fresh = [{ time: DAY - 31 * H, surface: 'fresh' as const }];
  const calm = steps.map((s) => ({ time: s.time, speed: 5 }));
  const fav = criticalNewSnow(steps, end, calm, fresh)!;
  assert.equal(fav.cls, 'favourable');
  assert.ok(Math.abs(fav.cm - 28.8) < 0.01, `cm ${fav.cm}`);
  assert.ok(fav.ratio > 0.95 && fav.ratio < 0.97);
  // Strong wind and old snow underneath: unfavourable, 10–20 cm.
  const windy = steps.map((s) => ({ time: s.time, speed: 14 }));
  const unfav = criticalNewSnow(steps, end, windy, [{ time: DAY - 31 * H, surface: 'old' }])!;
  assert.equal(unfav.cls, 'unfavourable');
  assert.deepEqual(unfav.factors, ['sterk vind 14 m/s', 'gammel snø under']);
  assert.ok(unfav.ratio > 2.8);
  // A cold snowfall counts too.
  const cold = criticalNewSnow(set(steps, -30, -6, { temp: -12 }), end, calm, fresh)!;
  assert.equal(cold.cls, 'average');
  assert.equal(criticalNewSnow(hours(-10, 0), end, calm, fresh), null); // not covered
});

test('rain around: only rain, not sleet, in the 12 h before and after', () => {
  const ref = DAY + 10 * H;
  const rain = set(base(), 4, 6, { temp: 3, precip: 1, snowMm: 0 });
  assert.deepEqual(rainAround(rain, ref), { before: 2, after: 0, on: true });
  const sleet = set(base(), 4, 6, { temp: 1, precip: 1, snowMm: 0.5 });
  assert.equal(rainAround(sleet, ref)!.on, false);
  assert.equal(rainAround([], ref), null);
});

test('første mildvær: 0 °C on the day after ≥ 10 cm, and the first time since', () => {
  const snowed = set(base(), -30, -20, { precip: 1, snowMm: 1 }); // 12 cm
  const t = firstThaw(set(snowed, 10, 14, { temp: 1 }), DAY, FROM, TO)!;
  assert.ok(t.hit && Math.abs(t.cm - 12) < 1e-9 && t.maxTemp === 1, JSON.stringify(t));
  const why = (steps: PrecipStep[]) => firstThaw(steps, DAY, FROM, TO)?.why;
  assert.equal(why(snowed), 'cold'); // stays below 0
  assert.equal(why(set(set(snowed, -10, -8, { temp: 2 }), 10, 14, { temp: 1 })), 'mildBefore');
  assert.equal(why(set(set(base(), -30, -25, { precip: 1, snowMm: 1 }), 10, 14, { temp: 1 })), 'littleSnow'); // 6 cm
  assert.equal(firstThaw(hours(-10, 24), DAY, FROM, TO), null); // the 48 h aren't covered
});

test('første fine dag: little cloud after ≥ 20 cm, and not fine the day before', () => {
  const snowed = set(base(), -40, -20, { precip: 1, snowMm: 1, cloud: 100 }); // 24 cm
  const cloudy = snowed.map((s) => ({ ...s, cloud: s.cloud ?? 90 }));
  const fine = set(cloudy, 0, 24, { cloud: 10 });
  const f = firstFineDay(fine, DAY, FROM, TO)!;
  assert.ok(f.hit && Math.abs(f.cm - 24) < 1e-9 && f.cloud === 10, JSON.stringify(f));
  const why = (steps: PrecipStep[]) => firstFineDay(steps, DAY, FROM, TO)?.why;
  assert.equal(why(cloudy), 'cloudy');
  assert.equal(why(set(fine, -24, -8, { cloud: 5 })), 'notFirst'); // yesterday was fine already
  assert.equal(why(snowed.map(({ cloud: _, ...s }) => s)), 'noCloud');
  assert.equal(why(set(fine, 9, 12, { precip: 1, snowMm: 1 })), 'snowing');
});

test('nattefrost: good, weak or none', () => {
  const night = (temp: number, cloud?: number) => hours(-6, 6, { temp, cloud });
  const state = (temp: number, cloud?: number) => refreeze(night(temp, cloud), DAY - 6 * H, DAY + 6 * H)!.state;
  assert.equal(state(-4, 20), 'good');
  assert.equal(state(-1, 30), 'weak');
  assert.equal(state(-3, 60), 'weak'); // cloudy: little radiation cooling
  assert.equal(state(-8, 90), 'good'); // that cold, it freezes anyway
  assert.equal(state(1, 10), 'none');
  assert.equal(state(-0.5, 90), 'none');
  assert.equal(state(-3), 'good'); // no cloud data: by temperature
  assert.equal(refreeze([], DAY - 6 * H, DAY + 6 * H), null);
});

const none: SignGroup = { n: 0, score: 0, on: false, kinds: [], labels: [] };
const quiet: InfoInput = {
  cover: 'snow', critical: null, criticalShow: 0.7, rain: null, rainNow: true, firstThaw: null, firstFine: null,
  refreeze: null, dayMild: false, meltFreeze: false, poorTest: none,
};
const keys = (o: Partial<InfoInput>) => infos({ ...quiet, ...o }).map((i) => `${i.key}:${i.level}`);

test('infos: only what applies, red flags first', () => {
  assert.deepEqual(keys({}), []);
  const crit = (ratio: number) => ({ cm: ratio * 20, cls: 'average' as const, range: [20, 30] as [number, number], ratio, factors: ['sterk vind 14 m/s'] });
  assert.deepEqual(keys({ critical: crit(0.6) }), []);
  assert.deepEqual(keys({ critical: crit(0.75) }), ['critical:info']);
  assert.deepEqual(keys({ critical: crit(1.2), poorTest: { ...none, n: 1, score: 0.5 } }), ['critical:warn', 'poorTest:info']);
  assert.match(infos({ ...quiet, critical: crit(1.2) })[0].text, /Kritisk mengde er 20–30 cm ved middels forhold \(sterk vind/);
});

test('infos: bare ground hides the snow infos, not the Regobs ones', () => {
  const poorTest = { ...none, n: 2, score: 1.5, on: true };
  assert.deepEqual(keys({ cover: 'bare', rain: { before: 3, after: 0, on: true }, poorTest }), ['poorTest:warn']);
});

test('infos: refreeze only when it melts and freezes; a good one only on a mild day', () => {
  const weak = { state: 'weak' as const, min: -1, cloud: 40 };
  const good = { state: 'good' as const, min: -6, cloud: 10 };
  assert.deepEqual(keys({ refreeze: weak }), []); // a cold spell
  assert.deepEqual(keys({ refreeze: weak, meltFreeze: true }), ['refreeze:info']);
  assert.deepEqual(keys({ refreeze: good, meltFreeze: true }), []);
  assert.deepEqual(keys({ refreeze: good, meltFreeze: true, dayMild: true }), ['refreeze:ok']);
});

test('info rows: every info has a state and a reason, hit or not', () => {
  const rows = infoRows({
    ...quiet,
    critical: { cm: 8, cls: 'average', range: [20, 30], ratio: 0.4, factors: [] },
    rain: { before: 0.1, after: 0, on: false },
    firstThaw: { hit: false, why: 'littleSnow', cm: 4, maxTemp: 2 },
    firstFine: { hit: false, why: 'noCloud', cm: 25, cloud: null },
    refreeze: { state: 'weak', min: -1, cloud: 40 },
    poorTest: null,
  });
  assert.deepEqual(rows.map((r) => r.key), INFO_DEFS.map((d) => d.key));
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by.critical.state, 'no');
  assert.match(by.critical.text, /8 cm nysnø siste 72 t, 40 % av 20 cm.*Vises fra 70 %/);
  assert.match(by.rainOnSnow.text, /0,1 mm siste 12 t/);
  assert.match(by.firstThaw.text, /4 cm nysnø siste 48 t, under 10 cm/);
  assert.equal(by.firstFine.state, 'unknown');
  assert.match(by.refreeze.text, /Under 0 °C i dag og i går/);
  assert.equal(by.poorTest.state, 'unknown');
  assert.equal(by.firstFine.name, 'Powder bluebird');
  assert.ok(rows.every((r) => r.text.length > 10));
});

test('info texts use the same thresholds as the rules', () => {
  const rule = (k: string) => INFO_DEFS.find((d) => d.key === k)!.rule;
  assert.ok(rule('firstThaw').includes(`${FIRST_THAW_CM} cm nysnø siste ${FIRST_THAW_H} t`));
  assert.ok(rule("firstFine").includes(`under ${FINE_CLOUD} %`) && rule('firstFine').includes(`${FIRST_FINE_CM} cm nysnø siste ${FIRST_FINE_H} t`));
  assert.ok(rule('rainOnSnow').includes(`${String(RAIN_MIN_MM).replace('.', ',')} mm regn de ${RAIN_H} timene`));
  const rows = infoRows({ ...quiet, firstThaw: { hit: false, why: 'littleSnow', cm: 4, maxTemp: 2 }, firstFine: { hit: false, why: 'littleSnow', cm: 4, cloud: 10 } });
  assert.ok(rows.find((r) => r.key === 'firstThaw')!.text.includes(`under ${FIRST_THAW_CM} cm`));
  assert.ok(rows.find((r) => r.key === 'firstFine')!.text.includes(`under ${FIRST_FINE_CM} cm`));
});
