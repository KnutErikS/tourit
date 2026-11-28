import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iceWarnings, obsWithin, parseIceObs, parseIceObsList, type RegobsIceRaw } from '../src/domain/ice.ts';

const H = 3_600_000;

// Trimmed from a real Regobs answer (Search, geo hazard 70, Nov 2026).
const orre: RegobsIceRaw = {
  RegId: 471671,
  DtObsTime: '2026-11-28T11:34:47+01:00',
  ObsLocation: { Latitude: 58.7753, Longitude: 5.5732, Height: 4, LocationName: 'Klepp / Rogaland', Title: 'Rogaland / Klepp / Rogaland', MunicipalName: 'KLEPP' },
  Observer: { NickName: 'Tommasi', CompetenceLevelName: 'Ukjent' },
  IceCoverObs: { IceCoverTID: 21, IceCoverName: 'Hele sjøen islagt', IceSkateabilityTID: 20, IceSkateabilityName: 'Under tvil skøytbart', IceCapacityTID: 10, IceCapacityName: 'Liten fare for å gå igjennom', Comment: null },
  IceThickness: { IceThicknessLayers: [{ IceLayerName: 'Stålis', IceLayerTID: 1, IceLayerThickness: 0.1 }], SnowDepth: null, SlushSnow: null, IceThicknessSum: 0.1, Comment: 'Orrevattnet fryser veldigt fort og er grunt.' },
  DangerObs: [],
  Attachments: [{ UrlFormats: { Thumbnail: 'https://api.regobs.no/Attachments/Thumbnail/x.jpg', Large: 'https://api.regobs.no/Attachments/Large/x.jpg' }, Copyright: 'Tommasi' }],
};

test('parseIceObs reads skateability, capacity, thickness and pictures', () => {
  const o = parseIceObs(orre)!;
  assert.equal(o.id, 471671);
  assert.equal(o.place, 'Klepp / Rogaland');
  assert.equal(o.skate, 2);
  assert.equal(o.capacity, 1);
  assert.equal(o.thicknessCm, 10);
  assert.deepEqual(o.layers, [{ name: 'Stålis', cm: 10 }]);
  assert.equal(o.cover, 'Hele sjøen islagt');
  assert.deepEqual(o.comments, ['Orrevattnet fryser veldigt fort og er grunt.']);
  assert.equal(o.images.length, 1);
  assert.deepEqual(iceWarnings(o), []);
});

test('parseIceObs: "Ikke gitt" is no value, and no position is no observation', () => {
  const o = parseIceObs({ RegId: 1, DtObsTime: '2026-11-27T10:00:00+01:00', ObsLocation: { Latitude: 60, Longitude: 10 },
    IceCoverObs: { IceCoverTID: 0, IceCoverName: 'Ikke gitt', IceSkateabilityTID: 0, IceCapacityTID: 0 } })!;
  assert.equal(o.skate, null);
  assert.equal(o.capacity, null);
  assert.equal(o.cover, null);
  assert.equal(o.thicknessCm, null);
  assert.equal(o.observer, 'Ukjent');
  assert.equal(parseIceObs({ RegId: 2, DtObsTime: '2026-11-27T10:00:00+01:00', ObsLocation: {} }), null);
});

test('iceWarnings: high risk, danger signs and incidents, not "no signs seen"', () => {
  const o = parseIceObs({
    ...orre,
    IceCoverObs: { ...orre.IceCoverObs, IceCapacityTID: 30 },
    DangerObs: [
      { DangerSignTID: 714, DangerSignName: 'Store sprekker eller råker', Comment: 'Område: På dette vannet. Beskrivelse: Råk midt på' },
      { DangerSignTID: 701, DangerSignName: 'Ingen faretegn observert' },
    ],
    Incident: { ActivityInfluencedName: 'Skøyteløper' },
  })!;
  assert.equal(o.noSigns, true);
  assert.deepEqual(o.signs, ['Store sprekker eller råker: Råk midt på']);
  assert.deepEqual(iceWarnings(o), ['Hendelse: Skøyteløper', 'Stor fare for å gå gjennom', 'Store sprekker eller råker: Råk midt på']);
});

test('parseIceObsList sorts newest first; obsWithin keeps the last days', () => {
  const list = parseIceObsList([
    { ...orre, RegId: 1, DtObsTime: '2026-11-20T12:00:00+01:00' },
    { ...orre, RegId: 2, DtObsTime: '2026-11-28T08:00:00+01:00' },
    { ...orre, RegId: 3, DtObsTime: '2026-11-26T12:00:00+01:00' },
  ]);
  assert.deepEqual(list.map((o) => o.id), [2, 3, 1]);
  const end = Date.parse('2026-11-28T12:00:00+01:00');
  assert.deepEqual(obsWithin(list, end, 1).map((o) => o.id), [2]);
  assert.deepEqual(obsWithin(list, end, 3).map((o) => o.id), [2, 3]);
  assert.deepEqual(obsWithin(list, end - 5 * H, 7).map((o) => o.id), [3]); // after the end, and over 7 days before it, left out
  assert.deepEqual(obsWithin(list, end, 9).map((o) => o.id), [2, 3, 1]);
});

test('parseIceObsList leaves out river reports', () => {
  const river = { ...orre, RegId: 9, IceCoverObs: { IceCoverTID: 40, IceCoverName: 'Isgang i elv' } };
  assert.deepEqual(parseIceObsList([orre, river]).map((o) => o.id), [471671]);
});
