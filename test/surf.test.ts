import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  angDiff, bestOfDay, breakerHeight, hourAt, kmBetween, nearestSpot, rateHour, runs, scoreName, swellFactor, toSurfHours, windClass, windRel, type SurfHour,
} from '../src/domain/surf.ts';
import { SURF_SPOTS, type SurfSpot } from '../src/domain/surfSpots.ts';

// A west-facing beach: best swell from W, offshore wind from E.
const spot: SurfSpot = { id: 't', name: 'Test', area: 'Test', lat: 58.8, lng: 5.55, kind: 'beach', swellFrom: 270, offshoreFrom: 90 };
const base: SurfHour = {
  time: 0, swellH: 1.2, swellT: 11, swellDir: 270, waveH: 1.4, waveT: 10, waveDir: 270, windWaveH: 0.3,
  windSpeed: 4, windGust: 7, windDir: 90, sst: 8,
};
const hour = (o: Partial<SurfHour>): SurfHour => ({ ...base, ...o });

test('angDiff wraps round north', () => {
  assert.equal(angDiff(350, 10), 20);
  assert.equal(angDiff(10, 350), 20);
  assert.equal(angDiff(90, 270), 180);
  assert.equal(angDiff(-90, 270), 0);
});

test('windRel: offshore, cross, onshore, and glassy when light', () => {
  assert.equal(windRel(5, 90, 90), 'offshore');
  assert.equal(windRel(5, 135, 90), 'cross-off');
  assert.equal(windRel(5, 180, 90), 'cross');
  assert.equal(windRel(5, 225, 90), 'cross-on');
  assert.equal(windRel(5, 270, 90), 'onshore');
  assert.equal(windRel(1, 270, 90), 'glassy');
});

test('swellFactor: full inside the window, half at 1.5 ×, nothing from behind', () => {
  assert.equal(swellFactor(270, spot), 1);
  assert.equal(swellFactor(315, spot), 1); // 45° = the default window
  assert.ok(Math.abs(swellFactor(337.5, spot) - 0.5) < 1e-9);
  assert.equal(swellFactor(90, spot), 0);
  assert.equal(swellFactor(300, { swellFrom: 270, window: 20 }), 0.5);
});

test('breakerHeight grows with period (Komar & Gaughan)', () => {
  const short = breakerHeight(1, 6), long = breakerHeight(1, 12);
  assert.ok(long > short);
  assert.ok(Math.abs(breakerHeight(1, 10) - 1.55) < 0.02);
  assert.equal(breakerHeight(0, 10), 0);
});

test('clean groundswell with offshore wind rates high', () => {
  const r = rateHour(spot, hour({}));
  assert.equal(r.wind, 'offshore');
  assert.equal(r.score, 5);
  assert.equal(scoreName(r), 'Topp');
});

test('onshore wind and short period pull it down', () => {
  assert.ok(rateHour(spot, hour({ windDir: 270 })).score <= 3);
  assert.ok(rateHour(spot, hour({ windDir: 270, windSpeed: 12 })).score <= 2);
  assert.ok(rateHour(spot, hour({ swellT: 6 })).score < rateHour(spot, hour({})).score);
});

test('swell from the wrong side gives nothing, and says why', () => {
  const r = rateHour(spot, hour({ swellDir: 90, swellH: 2 }));
  assert.equal(r.score, 0);
  assert.equal(scoreName(r), 'Flatt');
  assert.match(r.notes[0], /Lite av dønningen/);
});

test('flat sea is flat; missing data says so', () => {
  assert.equal(rateHour(spot, hour({ swellH: 0.1, waveH: 0.15 })).score, 0);
  const none = rateHour(spot, hour({ swellH: null, waveH: null }));
  assert.equal(none.size, null);
});

test('falls back to all waves when the model has no swell', () => {
  const r = rateHour(spot, hour({ swellH: null, swellDir: null, waveH: 1.2, waveT: 9, waveDir: 270 }));
  assert.ok(r.size! > 0.9);
});

test('hourAt and bestOfDay pick the right hours', () => {
  const day = new Date('2026-11-27T00:00:00').getTime();
  const hours = [6, 9, 12, 15, 21].map((h) => hour({ time: day + h * 3_600_000, windDir: h === 12 ? 90 : 270 }));
  assert.equal(hourAt(hours, day + 10 * 3_600_000)?.time, day + 9 * 3_600_000);
  assert.equal(hourAt(hours, day + 18 * 3_600_000), null);
  const best = bestOfDay(spot, hours, '2026-11-27');
  assert.equal(best?.hour.time, day + 12 * 3_600_000); // the offshore hour, 06 and 21 are outside the day
});

test('toSurfHours merges marine and wind by time', () => {
  const marine = { hourly: { time: [100, 200], swell_wave_height: [1, null], swell_wave_peak_period: [12, null], swell_wave_direction: [270, null], wave_height: [1.2, null] } };
  const wind = { hourly: { time: [200, 100], wind_speed_10m: [9, 3], wind_direction_10m: [270, 90] } };
  const hs = toSurfHours(marine, wind);
  assert.equal(hs.length, 1); // the hour with no waves is dropped
  assert.equal(hs[0].time, 100_000);
  assert.equal(hs[0].windSpeed, 3);
  assert.equal(hs[0].windDir, 90);
  assert.equal(hs[0].swellT, 12);
});

test('spot list: unique ids, positions in Norway, directions in range', () => {
  assert.equal(new Set(SURF_SPOTS.map((s) => s.id)).size, SURF_SPOTS.length);
  for (const s of SURF_SPOTS) {
    assert.ok(s.lat > 57.9 && s.lat < 71.5 && s.lng > 4.5 && s.lng < 31.5, s.id);
    assert.ok(s.swellFrom >= 0 && s.swellFrom < 360 && s.offshoreFrom >= 0 && s.offshoreFrom < 360, s.id);
  }
});

test('windClass groups the wind relations', () => {
  assert.equal(windClass('glassy'), 'clean');
  assert.equal(windClass('cross-off'), 'clean');
  assert.equal(windClass('cross'), 'side');
  assert.equal(windClass('cross-on'), 'onshore');
});

test('runs joins neighbouring hours with the same value', () => {
  const H = 3_600_000;
  const r = runs([0, 1, 2, 3, 5].map((h, i) => ({ time: h * H, v: i < 2 ? 'a' : 'b' })));
  assert.deepEqual(r, [{ v: 'a', from: 0, to: H }, { v: 'b', from: 2 * H, to: 3 * H }, { v: 'b', from: 5 * H, to: 5 * H }]);
});

test('nearestSpot finds a spot within 5 km, else none', () => {
  const hoddevik = SURF_SPOTS.find((s) => s.id === 'hoddevik')!;
  assert.equal(nearestSpot(SURF_SPOTS, { lat: hoddevik.lat + 0.01, lng: hoddevik.lng })?.id, 'hoddevik');
  assert.equal(nearestSpot(SURF_SPOTS, { lat: 61.5, lng: 8.5 }), null);
  assert.ok(Math.abs(kmBetween({ lat: 60, lng: 10 }, { lat: 61, lng: 10 }) - 111.2) < 0.2);
});
