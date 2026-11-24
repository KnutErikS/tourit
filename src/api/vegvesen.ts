import { VEGVESEN_WFS } from '../config';
import { type CamCollection, parseWebcams, WEBCAM_FIELDS, type WebcamSite } from '../domain/webcams';
import { type Fetched, withStored } from '../offline/dataCache';
import { getJson } from '../util';

/**
 * All of Vegvesen's road webcams in Norway (about 900 cameras, ~400 kB of
 * JSON before compression). Fetched once and filtered on the device rather
 * than per map view. Stored on the device, so the markers still show without
 * network (the images themselves need network).
 */
export function fetchWebcams(): Promise<Fetched<WebcamSite[]>> {
  return withStored('webcams', 'all', async () => {
    const q = new URLSearchParams({
      service: 'WFS',
      version: '2.0.0',
      request: 'GetFeature',
      typeNames: 'datex_3_1:CctvSimple_v2',
      outputFormat: 'application/json',
      srsName: 'EPSG:4326',
      propertyName: WEBCAM_FIELDS.join(','),
    });
    return parseWebcams(await getJson<CamCollection>(`${VEGVESEN_WFS}?${q}`));
  });
}
