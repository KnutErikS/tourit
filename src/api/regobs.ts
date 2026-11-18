import { REGOBS_API } from '../config';
import type { RegobsObs } from '../types';
import { getJson, isoDate } from '../util';

const PAGE = 500;
const MAX_PAGES = 4;

/** Snow observations (geo hazard 10) for the date and the two days before. */
export async function fetchObservations(date: string): Promise<RegobsObs[]> {
  const from = new Date(date + 'T12:00:00');
  from.setDate(from.getDate() - 2);
  const body = {
    LangKey: 1,
    SelectedGeoHazards: [10],
    FromDtObsTime: isoDate(from) + 'T00:00:00',
    ToDtObsTime: date + 'T23:59:59',
    NumberOfRecords: PAGE,
    Offset: 0,
    OrderBy: 'DtObsTime',
  };
  let all: RegobsObs[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    body.Offset = page * PAGE;
    const batch = await getJson<RegobsObs[]>(`${REGOBS_API}/Search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    all = all.concat(batch);
    if (batch.length < PAGE) break;
  }
  return all;
}
