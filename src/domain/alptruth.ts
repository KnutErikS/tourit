import type { Loading, Thaw } from './precip';
import type { SignGroup } from './signs';

/**
 * ALPTRUTh: count the obvious clues (Rule 4 in the tourit rules note). In 715
 * US accidents almost three quarters happened with 3 or more of these 7 clues
 * present, and none with zero (McCammon 2004).
 *
 * Six clues are filled in from data; Terrain trap is yours to judge for now.
 * You can tick or untick any clue yourself, and your tick wins.
 *   A  Avalanches      Regobs avalanches in the region, last 48 h, weighted (domain/signs.ts)
 *   L  Loading         > 15 cm new snow, rask oppbygging (domain/precip.ts),
 *                      a lee slope of the last days' wind, or Regobs loading signs
 *   P  Path            ≥ PATH_DEG where you are, or in NVE's steep terrain or runout bands
 *   T  Terrain trap    not computed (see Rule 17)
 *   R  Rating          danger level 3 or higher
 *   U  Unstable snow   Regobs whumpfs, shooting cracks or poor ECTs, last 48 h, weighted
 *   Th Thaw            above 0 °C or rain during the day, or Regobs warming/wet-snow signs
 *
 * Pure: type imports only.
 */

export type ClueKey = 'A' | 'L' | 'P' | 'T' | 'R' | 'U' | 'Th';

export interface ClueDef {
  key: ClueKey;
  name: string;
  /** What the clue means, one line. */
  hint: string;
  /** About the slope (follows the point) rather than the day (follows the date). */
  spot: boolean;
}

export const CLUES: ClueDef[] = [
  { key: 'A', name: 'Ferske skred', hint: 'Skred i området siste 48 t', spot: false },
  { key: 'L', name: 'Ny last', hint: 'Over 15 cm nysnø, rask oppbygging eller vindtransport siste 48 t', spot: false },
  { key: 'P', name: 'Skredbane', hint: 'Du er i et løsneområde, en skredbane eller et utløp', spot: true },
  { key: 'T', name: 'Terrengfelle', hint: 'Stup, gjel, søkk, tett skog eller vann under deg', spot: true },
  { key: 'R', name: 'Faregrad 3+', hint: 'Betydelig eller høyere i varselet', spot: false },
  { key: 'U', name: 'Ustabil snø', hint: 'Drønn, skytende sprekker eller dårlige stabilitetstester', spot: false },
  { key: 'Th', name: 'Mildvær', hint: 'Over 0 °C eller regn i løpet av dagen', spot: false },
];

/** Your own ticks: true = the clue is there, false = it isn't, missing = go by the data. */
export type Ticks = Partial<Record<ClueKey, boolean>>;

/** Steep enough to be a start zone, degrees (where most slab avalanches start; our own cut-off). */
export const PATH_DEG = 30;
/** This many clues or more: red. */
export const RED_AT = 3;

export interface AlptruthInput {
  /** Danger level in the warning (0 = no warning). */
  level: number;
  /** Regobs signs in the region, last 48 h, weighted for the point; null = no observations for the day. */
  signs: { avalanche: SignGroup; loading: SignGroup; unstable: SignGroup; thaw: SignGroup } | null;
  /** Steepest 20 × 20 m where you are, degrees; null = unknown. */
  steep: number | null;
  /** NVE's map at the point: 'steep', a runout band, or null for neither; undefined = unknown. */
  zone: string | null | undefined;
  /** New snow and rask oppbygging over the 48 h before the day; null = no weather for it. */
  loading: Loading | null;
  /** The point's aspect is a lee slope of the last days' wind; null = unknown. */
  lee: boolean | null;
  /** Mild weather or rain during the day; null = no weather for it. */
  thaw: Thaw | null;
}

export interface Clue extends ClueDef {
  /** From the data: true or false, or null when the data can't tell (always for T). */
  auto: boolean | null;
  /** Why, in short Norwegian sentences. */
  why: string[];
  /** Your own tick, if any. */
  mine?: boolean;
  /** What counts: your tick, else the data, else no. */
  on: boolean;
}

export interface Alptruth {
  clues: Clue[];
  count: number;
  /** count ≥ RED_AT */
  red: boolean;
}

const num = (x: number, d = 0) => x.toFixed(d).replace('.', ',');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Collects one clue's sources: unknown until a source knows, on as soon as one says so. */
class Facts {
  auto: boolean | null = null;
  why: string[] = [];
  add(on: boolean, ...why: string[]): void {
    this.auto = on || this.auto === true;
    this.why.push(...why);
  }
}

/** "Drønn i snøen, skytende sprekker: 2 meldinger i regionen siste 48 t". */
function signText(g: SignGroup): string {
  const n = g.n === 1 ? '1 melding' : `${g.n} meldinger`;
  return `${cap(g.labels.join(', '))}: ${n} i regionen siste 48 t${g.on ? '' : ', langt fra din høyde eller himmelretning'}`;
}

function signsClue(g: SignGroup | undefined, none: string): Facts {
  const f = new Facts();
  if (!g) f.why.push('Har ikke Regobs-observasjoner for dagen');
  else f.add(g.on, g.n ? signText(g) : none);
  return f;
}

function loadingClue(i: AlptruthInput): Facts {
  const f = new Facts();
  if (i.loading) {
    const { newSnowCm: cm, heavySnow, rapid } = i.loading;
    const why: string[] = [];
    if (heavySnow) why.push(`${num(cm)} cm nysnø siste 48 t`);
    if (rapid.byRun) why.push(`Rask oppbygging: ${num(rapid.runH)} t på rad med minst 2,5 mm/t som snø`);
    if (rapid.byWater) why.push(`Rask oppbygging: ${num(rapid.water24)} mm nedbør siste 24 t`);
    if (!why.length) why.push(`${num(cm)} cm nysnø siste 48 t, ingen rask oppbygging`);
    f.add(heavySnow || rapid.on, ...why);
  }
  if (i.lee === true) f.add(true, 'Lesiden for vinden de siste døgnene');
  else if (i.lee === false) f.add(false);
  if (i.signs) f.add(i.signs.loading.on, ...(i.signs.loading.n ? [signText(i.signs.loading)] : []));
  if (f.auto === null) f.why.push('Mangler vær for de siste døgnene');
  return f;
}

function pathClue(i: AlptruthInput): Facts {
  const f = new Facts();
  if (i.steep == null && i.zone === undefined) {
    f.why.push('Mangler terrengdata for punktet');
    return f;
  }
  const steep = i.steep != null && i.steep >= PATH_DEG;
  const why: string[] = [];
  if (steep) why.push(`Brattest ${num(i.steep!)}° der du står`);
  if (i.zone === 'steep') why.push('Bratt terreng i NVEs kart');
  else if (i.zone) why.push('I utløpssone fra bratt terreng (NVE)');
  if (!why.length)
    why.push(
      (i.steep != null ? `Brattest ${num(i.steep)}°` : 'Ukjent bratthet') +
        (i.zone === null ? ', utenfor NVEs bratte terreng og utløpssoner' : ''),
    );
  f.add(steep || !!i.zone, ...why);
  return f;
}

function thawClue(i: AlptruthInput): Facts {
  const f = new Facts();
  const t = i.thaw;
  if (t) {
    const why: string[] = [];
    if (t.warm) why.push(`Over 0 °C i løpet av dagen (maks ${num(t.maxTemp)} °C)`);
    if (t.rain) why.push(`Regn i løpet av dagen (${num(t.rainMm, 1)} mm)`);
    if (!why.length) why.push(`Holder seg under 0 °C uten regn (maks ${num(t.maxTemp)} °C)`);
    f.add(t.on, ...why);
  }
  if (i.signs) f.add(i.signs.thaw.on, ...(i.signs.thaw.n ? [signText(i.signs.thaw)] : []));
  if (f.auto === null) f.why.push('Mangler vær for dagen');
  return f;
}

function ratingClue(level: number): Facts {
  const f = new Facts();
  if (level < 1) f.why.push('Ingen snøskredvarsel for dagen');
  else f.add(level >= 3, `Faregrad ${level} i varselet`);
  return f;
}

export function alptruth(i: AlptruthInput, mine: Ticks = {}): Alptruth {
  const facts: Record<ClueKey, Facts> = {
    A: signsClue(i.signs?.avalanche, 'Ingen skred meldt i regionen siste 48 t'),
    L: loadingClue(i),
    P: pathClue(i),
    T: new Facts(),
    R: ratingClue(i.level),
    U: signsClue(i.signs?.unstable, 'Ingen drønn, sprekker eller dårlige tester meldt siste 48 t'),
    Th: thawClue(i),
  };
  const clues = CLUES.map((d): Clue => {
    const { auto, why } = facts[d.key];
    const tick = mine[d.key];
    return { ...d, auto, why, ...(tick !== undefined && { mine: tick }), on: tick ?? auto ?? false };
  });
  const count = clues.filter((c) => c.on).length;
  return { clues, count, red: count >= RED_AT };
}
