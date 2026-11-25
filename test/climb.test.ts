import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeText, gradeValue, matchesStyle, MIN_CRAGS, parseCrags, readSnapshot, styleOf, styleText, type Crag, type OsmElement } from '../src/domain/crags.ts';
import { bestClimbOfDay, cellOf, rainBefore, rateClimb, toClimbHours, type ClimbHour } from '../src/domain/climb.ts';

const H = 3_600_000;

test('styleOf reads yes / no / counts', () => {
  assert.equal(styleOf('yes'), true);
  assert.equal(styleOf('12'), true);
  assert.equal(styleOf('limited'), true);
  assert.equal(styleOf('no'), false);
  assert.equal(styleOf(undefined), null);
});

test('gradeValue orders Norwegian and French grades', () => {
  const nor = ['6-', '5+', '7', '4', '6'].sort((a, b) => gradeValue(a, 'norwegian') - gradeValue(b, 'norwegian'));
  assert.deepEqual(nor, ['4', '5+', '6-', '6', '7']);
  const fr = ['6a+', '5c', '7a', '6a'].sort((a, b) => gradeValue(a, 'french') - gradeValue(b, 'french'));
  assert.deepEqual(fr, ['5c', '6a', '6a+', '7a']);
  assert.ok(Number.isNaN(gradeValue('A2', 'norwegian')));
});

const els: OsmElement[] = [
  // A crag relation with three routes: style and grades come from the routes.
  { type: 'relation', id: 1, center: { lat: 59.9, lon: 10.5 }, tags: { type: 'site', site: 'climbing', climbing: 'crag', name: 'Kolsåstoppen' },
    members: [{ type: 'node', ref: 11 }, { type: 'way', ref: 12 }, { type: 'node', ref: 13 }] },
  { type: 'node', id: 11, tags: { climbing: 'route_bottom', 'climbing:grade:norwegian': '6-', 'climbing:sport': 'yes' } },
  { type: 'way', id: 12, tags: { climbing: 'route', 'climbing:grade:norwegian': '4+', 'climbing:trad': 'yes', 'climbing:length': '30' } },
  { type: 'node', id: 13, tags: { climbing: 'route_bottom', 'climbing:grade:norwegian': '7/7+', 'climbing:bolts': '8', 'climbing:pitches': '2' } },
  // A node crag with its own tags.
  { type: 'node', id: 2, lat: 63.1, lon: 10.4, tags: { sport: 'climbing', climbing: 'crag', name: 'Hammeren', 'climbing:trad': 'yes', 'climbing:sport': 'no', 'climbing:routes': '25' } },
  // An area that groups a crag: dropped, the crag shows instead.
  { type: 'relation', id: 3, center: { lat: 59.9, lon: 10.5 }, tags: { climbing: 'area', name: 'Kolsås' }, members: [{ type: 'relation', ref: 1 }] },
  // An area with no crags inside: kept.
  { type: 'relation', id: 4, center: { lat: 68.2, lon: 14.6 }, tags: { climbing: 'area', name: 'Presten' }, members: [] },
  // Gym, unnamed crag and a boulder-only site: dropped.
  { type: 'node', id: 5, lat: 59.9, lon: 10.7, tags: { sport: 'climbing', leisure: 'sports_centre', name: 'Klatreverket' } },
  { type: 'node', id: 6, lat: 59.9, lon: 10.7, tags: { climbing: 'crag' } },
  { type: 'node', id: 7, lat: 59.9, lon: 10.7, tags: { climbing: 'crag', name: 'Steinen', 'climbing:boulder': 'yes' } },
];

test('parseCrags: styles, routes and grades from the routes; areas, gyms and boulders handled', () => {
  const crags = parseCrags(els);
  assert.deepEqual(crags.map((c) => c.id), ['n2', 'r1', 'r4']); // by name: Hammeren, Kolsåstoppen, Presten
  const kol = crags.find((c) => c.id === 'r1')!;
  assert.equal(kol.sport, true);
  assert.equal(kol.trad, true);
  assert.equal(kol.routes, 3);
  assert.equal(kol.gradeMin, '4+');
  assert.equal(kol.gradeMax, '7');
  assert.equal(kol.length, 30);
  assert.equal(kol.multipitch, true);
  assert.equal(gradeText(kol), '4+–7');
  assert.equal(styleText(kol), 'Sport og trad');
  const ham = crags.find((c) => c.id === 'n2')!;
  assert.equal(ham.sport, false);
  assert.equal(ham.trad, true);
  assert.equal(ham.routes, 25);
  assert.ok(matchesStyle(ham, 'trad') && !matchesStyle(ham, 'sport') && matchesStyle(ham, 'all'));
  const presten = crags.find((c) => c.id === 'r4')!;
  assert.equal(presten.area, true);
  assert.equal(styleText(presten), 'Klatrefelt');
});

const hour = (h: number, o: Partial<ClimbHour> = {}): ClimbHour => ({ time: h * H, precip: 0, temp: 12, rh: 60, wind: 4, gust: 8, windDir: 200, cloud: 30, ...o });

test('rainBefore sums the hours up to and including t', () => {
  const hs = [hour(0, { precip: 1 }), hour(5, { precip: 2 }), hour(10, { precip: 4 })];
  assert.equal(rainBefore(hs, 10 * H, 6), 6);
  assert.equal(rainBefore(hs, 10 * H, 24), 7);
});

test('rateClimb: dry and mild is top, rain now is zero', () => {
  const dry = [hour(0), hour(1), hour(2)];
  assert.equal(rateClimb(dry, dry[2]).score, 5);
  assert.equal(rateClimb(dry, dry[2]).rock, 'dry');
  const wetNow = [hour(0), hour(1, { precip: 1.2 })];
  const r = rateClimb(wetNow, wetNow[1]);
  assert.equal(r.score, 0);
  assert.equal(r.rock, 'raining');
});

test('rateClimb: rain over the last day and recent rain pull it down', () => {
  const hs = [hour(0, { precip: 6 }), hour(10), hour(20)];
  assert.equal(rateClimb(hs, hs[2]).score, 3); // 6 mm in 24 h: −2
  const recent = [hour(17, { precip: 0.5 }), hour(20)];
  const r = rateClimb(recent, recent[1]);
  assert.equal(r.score, 3); // 0.5 mm in 24 h −1, and in the last 6 h −1
  assert.equal(r.rock, 'drying');
  const soaked = [hour(0, { precip: 15 }), hour(20)];
  assert.equal(rateClimb(soaked, soaked[1]).rock, 'wet');
  // Wet rock is never better than 1, however mild and calm.
  const showered = [hour(18, { precip: 1.5 }), hour(20)];
  assert.equal(rateClimb(showered, showered[1]).rock, 'wet');
  assert.equal(rateClimb(showered, showered[1]).score, 1);
});

test('rateClimb: cold, heat, wind and damp air', () => {
  assert.equal(rateClimb([hour(0, { temp: -3 })], hour(0, { temp: -3 })).score, 3);
  assert.equal(rateClimb([hour(0, { temp: 29 })], hour(0, { temp: 29 })).score, 3);
  assert.equal(rateClimb([hour(0)], hour(0, { wind: 14, gust: 22 })).score, 3);
  assert.equal(rateClimb([hour(0)], hour(0, { rh: 95, wind: 1 })).score, 4);
});

test('bestClimbOfDay keeps to climbing hours', () => {
  const day = new Date('2026-06-10T00:00:00').getTime();
  const hs = [6, 10, 14, 22].map((h) => ({ ...hour(0), time: day + h * H, precip: h === 10 ? 1 : 0, temp: h === 14 ? 14 : 3 }));
  const best = bestClimbOfDay(hs, '2026-06-10');
  assert.equal(best?.hour.time, day + 14 * H);
});

test('toClimbHours and cellOf', () => {
  const hs = toClimbHours({ hourly: { time: [100, 200], temperature_2m: [10, null], precipitation: [0.3, 0], wind_speed_10m: [3, 4] } });
  assert.equal(hs.length, 1);
  assert.equal(hs[0].time, 100_000);
  assert.equal(hs[0].precip, 0.3);
  assert.equal(cellOf(59.912, 10.487), '59.90,10.50');
  assert.equal(cellOf(59.928, 10.476), '59.95,10.50');
});

test('readSnapshot accepts a built crag list and rejects anything else', () => {
  const crag = (i: number): Crag => ({ id: `n${i}`, name: `Felt ${i}`, lat: 60 + i / 1000, lng: 10, sport: true, trad: null, boulder: false, multipitch: false, routes: null, area: false });
  const crags = Array.from({ length: MIN_CRAGS }, (_, i) => crag(i));
  const snap = { v: 1, generated: 1_700_000_000_000, crags };
  assert.deepEqual(readSnapshot(JSON.parse(JSON.stringify(snap))), snap);
  assert.equal(readSnapshot(null), null);
  assert.equal(readSnapshot('<!doctype html>'), null); // the dev server's index.html fallback
  assert.equal(readSnapshot({ ...snap, v: 2 }), null);
  assert.equal(readSnapshot({ ...snap, crags: crags.slice(1) }), null); // too few: a broken answer
  assert.equal(readSnapshot({ ...snap, crags: [{ ...crags[0], lat: 'x' }, ...crags.slice(1)] }), null);
});
