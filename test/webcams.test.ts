import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshImageUrl, parseWebcams, siteIdOf, siteOk } from '../src/domain/webcams.ts';
import { EXTRA_WEBCAMS } from '../src/domain/extraWebcams.ts';

const cam = (id: string, lng: number, lat: number, extra: Record<string, unknown> = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties: {
    CAMERA_ID: id,
    DESCRIPTION: 'Filefjell v/Smedalen',
    ORIENTATION_DESCRIPTION: 'Lærdal',
    ROAD_NUMBER: 'E16',
    STATUS_STILL_IMAGE_AVAILABILITY: 'videoOrImagesAvailable',
    STILL_IMAGE_URL: `https://kamera.atlas.vegvesen.no/api/images/${id}`,
    ...extra,
  },
});

test('site id drops the camera number', () => {
  assert.equal(siteIdOf('3000938_2'), '3000938');
  assert.equal(siteIdOf('3000938'), '3000938');
});

test('cameras at one site become one site with its directions in order', () => {
  const sites = parseWebcams({
    features: [
      cam('1_2', 8.5, 61.1, { ORIENTATION_DESCRIPTION: 'Tyin' }),
      cam('1_1', 8.5, 61.1),
      cam('2_1', 9.0, 62.0, { DESCRIPTION: 'Strynefjellet' }),
    ],
  });
  assert.equal(sites.length, 2);
  assert.deepEqual(sites[0].views.map((v) => [v.id, v.label]), [['1_1', 'Mot Lærdal'], ['1_2', 'Mot Tyin']]);
  assert.equal(sites[0].credit, 'Statens vegvesen');
  assert.deepEqual([sites[0].lat, sites[0].lng, sites[0].road], [61.1, 8.5, 'E16']);
  assert.equal(sites[1].name, 'Strynefjellet');
});

test('faulty cameras are marked, and a site is ok while one camera works', () => {
  const fault = { STATUS_STILL_IMAGE_AVAILABILITY: 'videoOrImagesUnavailableDueToCameraFault' };
  const [a] = parseWebcams({ features: [cam('1_1', 8, 61, fault), cam('1_2', 8, 61)] });
  assert.deepEqual(a.views.map((v) => v.ok), [false, true]);
  assert.equal(siteOk(a), true);
  const [b] = parseWebcams({ features: [cam('2_1', 8, 61, fault)] });
  assert.equal(siteOk(b), false);
});

test('features without id, https image or point are skipped; duplicates kept once', () => {
  const sites = parseWebcams({
    features: [
      cam('', 8, 61),
      cam('3_1', 8, 61, { STILL_IMAGE_URL: 'javascript:alert(1)' }),
      { geometry: null, properties: { CAMERA_ID: '4_1', STILL_IMAGE_URL: 'https://x/y' } },
      cam('5_1', NaN, 61),
      cam('6_1', 8, 61),
      cam('6_1', 8, 61),
    ],
  });
  assert.deepEqual(sites.map((s) => s.id), ['6']);
  assert.equal(sites[0].views.length, 1);
  assert.deepEqual(parseWebcams({}), []);
});

test('image URL gets a cache-buster that changes per minute', () => {
  const url = 'https://kamera.atlas.vegvesen.no/api/images/1_1';
  const t = Date.parse('2026-11-24T10:00:10Z');
  assert.equal(freshImageUrl(url, t), freshImageUrl(url, t + 30_000));
  assert.notEqual(freshImageUrl(url, t), freshImageUrl(url, t + 60_000));
  assert.match(freshImageUrl(url, t), /^https:\/\/kamera\.atlas\.vegvesen\.no\/api\/images\/1_1\?cacheBuster=\d+$/);
});

test('cache-buster goes after an existing query (romsdal.com needs ?OpenElement first)', () => {
  const t = Date.parse('2026-11-24T10:00:10Z');
  assert.match(freshImageUrl('https://api.romsdal.com/kamera/1/$File/a.jpg?OpenElement', t), /\?OpenElement&cacheBuster=\d+$/);
});

test('hand-picked webcams: https images, unique ids, places in Norway', () => {
  const ids = EXTRA_WEBCAMS.flatMap((s) => [s.id, ...s.views.map((v) => v.id)]);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of EXTRA_WEBCAMS) {
    assert.ok(s.lat > 57.9 && s.lat < 71.3 && s.lng > 4.5 && s.lng < 31.2, s.id);
    assert.ok(s.views.length > 0 && s.credit, s.id);
    for (const v of s.views) assert.match(v.url, /^https:\/\//, v.id);
  }
});
