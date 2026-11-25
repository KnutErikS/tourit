/**
 * Surf spots along the Norwegian coast, south-east to north.
 *
 * Position, type, the swell direction a spot works best with and the wind
 * direction that blows offshore there are taken from each spot's guide on
 * surf-forecast.com (positions to 0.01°, about 1 km, so a marker can sit a little
 * off the beach). The forecast point is the same position: Open-Meteo's marine
 * API moves it to the nearest sea cell itself (`cell_selection=sea`).
 *
 * `window` is how far (degrees, either side of `swellFrom`) swell still gets in
 * at full strength (ours, from the shape of the coast; default 45°). Beyond it the swell
 * counts for less and less (see swellFactor in domain/surf.ts).
 *
 * Adding a spot: id is a lowercase slug, directions are degrees the swell or
 * wind comes FROM (0 = N, 90 = E, 180 = S, 270 = W).
 */

export type SpotKind = 'beach' | 'reef' | 'point' | 'beach-reef';

export interface SurfSpot {
  id: string;
  name: string;
  /** Region shown under the name and used to group spots. */
  area: string;
  lat: number;
  lng: number;
  kind: SpotKind;
  /** The swell direction (from, °) the spot works best with. */
  swellFrom: number;
  /** Wind from this direction (°) blows offshore. */
  offshoreFrom: number;
  /** Half-width of the swell window, degrees (default SWELL_WINDOW in domain/surf.ts). */
  window?: number;
  /** Short local knowledge: hazards, tide, which way it breaks. */
  note?: string;
}

export const KIND_NAME: Record<SpotKind, string> = {
  beach: 'strand',
  reef: 'rev',
  point: 'odde (pointbreak)',
  'beach-reef': 'strand og rev',
};

export const SURF_SPOTS: SurfSpot[] = [
  // Skagerrak: only works with strong southerly swell.
  { id: 'saltstein', name: 'Saltstein', area: 'Larvik', lat: 58.96, lng: 9.85, kind: 'reef', swellFrom: 202.5, offshoreFrom: 45, window: 30,
    note: 'Virker sjelden, trenger kraftig sørlig dønning inn Skagerrak. Steiner i line-up.' },
  { id: 'njerve', name: 'Njerve Pipeline', area: 'Lindesnes', lat: 58.04, lng: 7.17, kind: 'beach', swellFrom: 202.5, offshoreFrom: 0, window: 30,
    note: 'Svært skjermet, bryter sjelden.' },
  // Lista
  { id: 'havik', name: 'Havika', area: 'Lista', lat: 58.07, lng: 6.72, kind: 'beach', swellFrom: 225, offshoreFrom: 0,
    note: 'Både venstre og høyre.' },
  { id: 'lista-bausje', name: 'Lista (Bausje)', area: 'Lista', lat: 58.09, lng: 6.6, kind: 'reef', swellFrom: 270, offshoreFrom: 22.5,
    note: 'Steiner i line-up.' },
  // Jæren, south to north
  { id: 'bore', name: 'Borestranden', area: 'Jæren', lat: 58.8, lng: 5.55, kind: 'beach', swellFrom: 270, offshoreFrom: 90,
    note: 'Surfbart på alt tidevann. Pass på strøm (rip).' },
  { id: 'sele', name: 'Sele', area: 'Jæren', lat: 58.81, lng: 5.54, kind: 'point', swellFrom: 270, offshoreFrom: 90,
    note: 'Surfbart på alt tidevann.' },
  { id: 'reve', name: 'Reve havn', area: 'Jæren', lat: 58.82, lng: 5.54, kind: 'beach-reef', swellFrom: 270, offshoreFrom: 112.5,
    note: 'Strand og rev, venstre og høyre. Surfbart på alt tidevann.' },
  { id: 'hellesto', name: 'Hellestø', area: 'Jæren', lat: 58.85, lng: 5.56, kind: 'beach', swellFrom: 292.5, offshoreFrom: 112.5,
    note: 'Venstre og høyre.' },
  // Stad
  { id: 'hoddevik', name: 'Hoddevik', area: 'Stad', lat: 62.12, lng: 5.16, kind: 'beach', swellFrom: 315, offshoreFrom: 135,
    note: 'Mest venstre. Surfbart på alt tidevann, litt ly for nordavind.' },
  { id: 'ervika', name: 'Ervika', area: 'Stad', lat: 62.17, lng: 5.11, kind: 'point', swellFrom: 315, offshoreFrom: 135,
    note: 'Høyre. Best rundt fjære. Skipsvraket er en fare.' },
  // Sunnmøre
  { id: 'flo', name: 'Flø', area: 'Sunnmøre', lat: 62.41, lng: 5.85, kind: 'reef', swellFrom: 315, offshoreFrom: 112.5,
    note: 'Virker ikke så ofte.' },
  { id: 'alnes', name: 'Alnes fyr', area: 'Sunnmøre', lat: 62.48, lng: 5.97, kind: 'point', swellFrom: 315, offshoreFrom: 135,
    note: 'Best om vinteren.' },
  { id: 'ulla', name: 'Ulla', area: 'Sunnmøre', lat: 62.69, lng: 6.18, kind: 'reef', swellFrom: 315, offshoreFrom: 135,
    note: 'Svært stabil, surfbart på alt tidevann.' },
  // Romsdal
  { id: 'farstad', name: 'Farstadstranda', area: 'Hustadvika', lat: 62.98, lng: 7.15, kind: 'beach-reef', swellFrom: 292.5, offshoreFrom: 112.5,
    note: 'Strand og rev, venstre og høyre. Best om høsten.' },
  // Lofoten
  { id: 'unstad', name: 'Unstad', area: 'Lofoten', lat: 68.27, lng: 13.58, kind: 'point', swellFrom: 292.5, offshoreFrom: 90,
    note: 'Venstre langs odden, rask og seksjonerende.' },
  { id: 'kvalnes', name: 'Kvalnes', area: 'Lofoten', lat: 68.35, lng: 13.97, kind: 'beach', swellFrom: 0, offshoreFrom: 225,
    note: 'Vender mot nord. Venstre og høyre.' },
];
