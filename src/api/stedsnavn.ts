import { STEDSNAVN_API } from '../config';
import { getJson } from '../util';

/** One place from Kartverket's place-name register (only the fields we use). */
export interface Place {
  id: number;
  name: string;
  type: string; // e.g. "Topp", "Fjell", "Dal", "Tettsted"
  municipality: string;
  county: string;
  lat: number;
  lng: number;
}

interface NavnHit {
  stedsnummer?: number;
  skrivemåte?: string;
  navneobjekttype?: string;
  kommuner?: { kommunenavn?: string }[];
  fylker?: { fylkesnavn?: string }[];
  representasjonspunkt?: { nord?: number; øst?: number };
}

async function query(params: string, signal: AbortSignal): Promise<Place[]> {
  const j = await getJson<{ navn?: NavnHit[] }>(`${STEDSNAVN_API}/navn?${params}&utkoordsys=4258&treffPerSide=15`, { signal });
  const seen = new Set<number>();
  const out: Place[] = [];
  for (const h of j.navn ?? []) {
    const p = h.representasjonspunkt;
    const lat = Number(p?.nord), lng = Number(p?.øst);
    if (!h.skrivemåte || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const id = h.stedsnummer ?? out.length;
    if (seen.has(id)) continue; // same place listed under several spellings
    seen.add(id);
    out.push({
      id,
      name: h.skrivemåte,
      type: h.navneobjekttype ?? '',
      municipality: h.kommuner?.[0]?.kommunenavn ?? '',
      county: (h.fylker?.[0]?.fylkesnavn ?? '').split(' - ')[0],
      lat,
      lng,
    });
  }
  return out;
}

/**
 * Search place names. Prefix match first (good while typing); if that finds
 * nothing, a fuzzy search (tolerates typos).
 */
export async function searchPlaces(text: string, signal: AbortSignal): Promise<Place[]> {
  const q = text.trim().replace(/[*?]/g, '');
  if (q.length < 2) return [];
  const prefix = await query(`sok=${encodeURIComponent(q + '*')}`, signal);
  if (prefix.length) return prefix;
  return query(`sok=${encodeURIComponent(q)}&fuzzy=true`, signal);
}
