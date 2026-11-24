import type { WebcamSite } from './webcams';

/**
 * Webcams outside Vegvesen's feed, picked by hand: public images that the
 * owners show on their own sites. None has an API with positions, so the
 * places are set here from Kartverket's place names (approximate: the camera
 * is near the named place, looking at the peaks in its label).
 *
 * Adding one: the image must be https and load from another site (no hotlink
 * block), and its host must be in CAM_IMAGE_HOSTS in vite.config.ts.
 */

const ROMSDAL = { credit: 'romsdal.com', link: 'https://romsdal.com/webkamera', road: '' };
/** romsdal.com's image URLs; `?OpenElement` lets the cache-buster be added after it. */
const romsdal = (id: string, file: string, label: string) => ({
  id: `romsdal-${id}`,
  label,
  url: `https://api.romsdal.com/kamera/${id}/$File/${file}?OpenElement`,
  ok: true,
});

export const EXTRA_WEBCAMS: WebcamSite[] = [
  {
    ...ROMSDAL,
    id: 'romsdal-skorgedalen',
    name: 'Skorgedalen (Rauma skisenter)',
    lat: 62.5968,
    lng: 7.6353,
    views: [
      romsdal('002839A4', 'Skarven.jpg', 'Skarven'),
      romsdal('0028C727', 'Skisenter.jpg', 'Skisenter'),
      romsdal('00367689', 'Fuglehaugen.jpg', 'Fuglehaugen'),
    ],
  },
  {
    ...ROMSDAL,
    id: 'romsdal-oran',
    name: 'Øran, Åndalsnes',
    lat: 62.5599,
    lng: 7.6758,
    views: [
      romsdal('0030BC6A', 'Oran-Hornet.jpg', 'Vengetindan og Romsdalshorn'),
      romsdal('004EEFFB', 'Oran-Romsdalseggen.jpg', 'Romsdalseggen'),
      romsdal('00654630', 'Oran-Vengetind.jpg', 'Blånebba og Vengetind'),
    ],
  },
  {
    ...ROMSDAL,
    id: 'romsdal-mandalen',
    name: 'Måndalen (Wenaasgruppen)',
    lat: 62.5331,
    lng: 7.4455,
    views: [
      romsdal('0036A2D4', 'Romsdalsfjorden.jpg', 'Romsdalsfjorden'),
      romsdal('0041B56C', 'Wenaas-s.jpg', 'Måndalen sør'),
    ],
  },
  {
    ...ROMSDAL,
    id: 'romsdal-berillvatnet',
    name: 'Berillvatnet',
    lat: 62.4403,
    lng: 7.4346,
    views: [
      romsdal('003B004A', 'BS-Berillvatnet.jpg', 'Berillvatnet'),
      romsdal('003B6EFA', 'BS-Bostolen.jpg', 'Mot Bøstølen'),
      romsdal('004BA349', 'BS-Taskedalshornet.jpg', 'Mot Taskedalshornet'),
      romsdal('005B76FE', 'BS-Fonna.jpg', 'Gammelstølsfonna'),
    ],
  },
  {
    ...ROMSDAL,
    id: 'romsdal-hersla',
    name: 'Hersla',
    lat: 62.4389,
    lng: 7.4607,
    views: [
      romsdal('005102C8', 'Her-Nonstind.jpg', 'Mot Nonstinden'),
      romsdal('00511E18', 'Her-Middagstind.jpg', 'Mot Middagstinden'),
      romsdal('003F9F73', 'Her-Skispor.jpg', 'Skisporet'),
      romsdal('003F7AE1', 'Her-Oversikt.jpg', 'Bilvegen'),
      romsdal('003EA6B3', 'Her-Parkering.jpg', 'Parkering'),
    ],
  },
  {
    id: 'turtagro',
    name: 'Turtagrø',
    road: '',
    lat: 61.5044,
    lng: 7.8017,
    credit: 'Turtagrø hotell',
    link: 'https://turtagro.no/webkamera/',
    views: [{ id: 'turtagro-1', label: '', url: 'https://turtagro.no/images/image_00001.jpg', ok: true }],
  },
  {
    id: 'gpss-juvass',
    name: 'Juvasshytta (Galdhøpiggen Sommerskisenter)',
    road: '',
    lat: 61.6728,
    lng: 8.3706,
    credit: 'Galdhøpiggen Sommerskisenter',
    link: 'https://gpss.no/',
    views: [{ id: 'gpss-juvass-1', label: '', url: 'https://gpss.no/foto/image.jpg', ok: true }],
  },
];
