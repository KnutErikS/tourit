import { REGOBS_API } from '../config';
import { parseIceObsList, type IceObs, type RegobsIceRaw } from '../domain/ice';
import { type Fetched, withStored } from '../offline/dataCache';
import { getJson, isoDate } from '../util';

/*
 * Data behind the Skøyter tab: the ice observations from Regobs (what Varsom
 * shows under "Is"), straight from its API like the snow observations
 * (api/regobs.ts). Stored on the device per date for use without network.
 */

/** Days of ice observations fetched up to the chosen date (the tab filters 1 / 3 / 7 of them). */
export const ICE_DAYS = 7;
const PAGE = 500;
const MAX_PAGES = 4;

/** Ice observations (geo hazard 70) on `date` (YYYY-MM-DD) and the ICE_DAYS − 1 days before, newest first. */
export function fetchIceObs(date: string): Promise<Fetched<IceObs[]>> {
  return withStored('ice', date, () => searchIce(date));
}

async function searchIce(date: string): Promise<IceObs[]> {
  const from = new Date(date + 'T12:00:00');
  from.setDate(from.getDate() - (ICE_DAYS - 1));
  const body = {
    LangKey: 1,
    SelectedGeoHazards: [70],
    FromDtObsTime: isoDate(from) + 'T00:00:00',
    ToDtObsTime: date + 'T23:59:59',
    NumberOfRecords: PAGE,
    Offset: 0,
    OrderBy: 'DtObsTime',
  };
  let all: RegobsIceRaw[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    body.Offset = page * PAGE;
    const batch = await getJson<RegobsIceRaw[]>(`${REGOBS_API}/Search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    all = all.concat(batch);
    if (batch.length < PAGE) break;
  }
  return parseIceObsList(all);
}
