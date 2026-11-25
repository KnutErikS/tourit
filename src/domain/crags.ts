/*
 * Climbing crags from OpenStreetMap (Overpass API), turned into a short list
 * the app can draw. Pure logic, tested with node:test.
 *
 * In Norway most of the detail sits on the routes, not on the crag: crags are
 * relations (site=climbing, climbing=crag) with their routes as members, or
 * single nodes. So the style (sport/trad), the number of routes and the grade
 * range come from the crag's own tags when set, and otherwise from its routes.
 * Areas (climbing=area) are only kept when none of their members is a crag
 * (then the area is the only thing marking the place).
 *
 * Tagging: https://wiki.openstreetmap.org/wiki/Climbing. Data © OpenStreetMap
 * contributors, ODbL.
 */

export interface Crag {
  /** OSM type letter + id: "n123", "w45", "r678". */
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** null = not tagged on the crag or its routes. */
  sport: boolean | null;
  trad: boolean | null;
  boulder: boolean;
  multipitch: boolean;
  /** Number of routes (the crag's own count, else its mapped routes), null if unknown. */
  routes: number | null;
  /** Grade range, as tagged: Norwegian grades when there are any, else French. */
  gradeMin?: string;
  gradeMax?: string;
  gradeSystem?: 'norwegian' | 'french';
  rock?: string;
  /** Wall direction as tagged (rare in Norway). */
  orientation?: string;
  /** Height of the routes, m (crag tag or longest route). */
  length?: number;
  /** A guide or topo: website / url / climbing:url:* tags (https only is checked when shown). */
  url?: string;
  /** From a climbing=area rather than a crag. */
  area: boolean;
  /** Inside a nature reserve or with an access note in OSM. */
  access?: string;
}

export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
  members?: { type: 'node' | 'way' | 'relation'; ref: number; role?: string }[];
}

/**
 * Every climbing crag in Norway, in one Overpass query: the crags and areas
 * (with their members), plus the routes that are members of them, so styles
 * and grades can be worked out per crag (parseCrags). Used by the build
 * (scripts/crags.ts, the snapshot the app loads) and by the app as a fallback.
 */
export const CRAG_QUERY = `[out:json][timeout:120];
area["ISO3166-1"="NO"][admin_level=2]->.no;
(
  nwr["climbing"~"^(crag|area)$"](area.no);
  nwr["sport"="climbing"][!"climbing"](area.no);
)->.c;
.c out body center qt;
rel.c->.r;
(node(r.r)["climbing"~"^route"]; way(r.r)["climbing"~"^route"];);
out tags qt;`;

/** Fewer crags than this in an answer means something went wrong (Norway has well over a thousand). */
export const MIN_CRAGS = 200;

/** The prebuilt list the app loads first (public/data/crags.json, made by scripts/crags.ts). */
export interface CragSnapshot {
  v: 1;
  /** When it was fetched from OpenStreetMap, ms. */
  generated: number;
  crags: Crag[];
}

/** A snapshot read from JSON, or null when it isn't one (an HTML error page, an old format, too few crags). */
export function readSnapshot(json: unknown): CragSnapshot | null {
  if (!json || typeof json !== 'object') return null;
  const s = json as Partial<CragSnapshot>;
  if (s.v !== 1 || typeof s.generated !== 'number' || !Array.isArray(s.crags) || s.crags.length < MIN_CRAGS) return null;
  const ok = s.crags.every((c) => c && typeof c.id === 'string' && typeof c.name === 'string' && Number.isFinite(c.lat) && Number.isFinite(c.lng));
  return ok ? (s as CragSnapshot) : null;
}

const key = (type: OsmElement['type'], id: number) => `${type[0]}${id}`;

/** A style tag: yes / limited / a route count → true, no / 0 → false, missing → null. */
export function styleOf(v: string | undefined): boolean | null {
  if (v == null || v === '') return null;
  if (v === 'no' || v === '0') return false;
  if (v === 'yes' || v === 'limited' || v === 'only' || /^\d+$/.test(v)) return true;
  return null;
}

/**
 * Sort key for a grade: Norwegian "5-" < "5" < "5+" < "6-", French "5a" < "5b" < "5c" < "6a"
 * (a "+" counts half a letter). NaN when not readable.
 */
export function gradeValue(g: string, system: 'norwegian' | 'french'): number {
  const s = g.trim().toLowerCase();
  if (system === 'norwegian') {
    const m = /^(\d{1,2})([+-]?)/.exec(s);
    if (!m) return NaN;
    return +m[1] + (m[2] === '+' ? 0.33 : m[2] === '-' ? -0.33 : 0);
  }
  const m = /^(\d)([abc])?(\+)?/.exec(s);
  if (!m) return NaN;
  return +m[1] + (m[2] ? ('abc'.indexOf(m[2]) * 2) / 6 : 0) + (m[3] ? 1 / 6 : 0);
}

/** "5-" etc. from a "5-/5" or "6+ A0" style value: the first grade only. */
const cleanGrade = (g: string) => g.trim().split(/[\s/;]/)[0];

function range(values: string[], system: 'norwegian' | 'french'): { min: string; max: string } | null {
  const ok = values.map(cleanGrade).filter((g) => Number.isFinite(gradeValue(g, system)));
  if (!ok.length) return null;
  ok.sort((a, b) => gradeValue(a, system) - gradeValue(b, system));
  return { min: ok[0], max: ok[ok.length - 1] };
}

const isRoute = (t: Record<string, string> | undefined) => !!t && /^route(_bottom|_top)?$/.test(t.climbing ?? '');
const isSport = (t: Record<string, string>) =>
  styleOf(t['climbing:sport']) === true || styleOf(t['climbing:bolted']) === true || /^[1-9]\d*$/.test(t['climbing:bolts'] ?? '');
const isTrad = (t: Record<string, string>) => styleOf(t['climbing:trad']) === true;
const num = (v: string | undefined) => {
  const n = parseFloat(v ?? '');
  return Number.isFinite(n) ? n : undefined;
};

/** Indoor walls, gyms and playgrounds carry sport=climbing too: not crags. */
function isIndoor(t: Record<string, string>): boolean {
  return t.indoor === 'yes' || 'building' in t || 'shop' in t || 'club' in t || 'amenity' in t
    || /^(sports_centre|fitness_centre|playground|sports_hall)$/.test(t.leisure ?? '')
    || t['climbing:boulder'] === 'only';
}

/**
 * Overpass answer → crags. Expects the crags/areas with `out body center` (relations
 * with members) and their route members with `out tags`.
 */
export function parseCrags(elements: OsmElement[]): Crag[] {
  const byKey = new Map<string, OsmElement>();
  for (const e of elements) byKey.set(key(e.type, e.id), e);

  const isCragEl = (e: OsmElement | undefined) => !!e?.tags && (e.tags.climbing === 'crag' || (e.tags.sport === 'climbing' && !e.tags.climbing));
  const out: Crag[] = [];
  const seen = new Set<string>();
  for (const e of elements) {
    const t = e.tags;
    if (!t || isRoute(t)) continue;
    const kind = t.climbing === 'crag' ? 'crag' : t.climbing === 'area' ? 'area' : !t.climbing && t.sport === 'climbing' ? 'site' : null;
    if (!kind || isIndoor(t)) continue;
    const id = key(e.type, e.id);
    if (seen.has(id)) continue;
    const pos = e.center ?? (e.lat != null && e.lon != null ? { lat: e.lat, lon: e.lon } : null);
    const name = (t.name ?? t['name:no'] ?? t['name:nb'] ?? '').trim();
    if (!pos || !name) continue;
    const members = (e.members ?? []).map((m) => byKey.get(key(m.type, m.ref)));
    // An area that groups crags: the crags are shown instead.
    if (kind === 'area' && members.some(isCragEl)) continue;
    const routes = members.map((m) => m?.tags).filter((mt): mt is Record<string, string> => isRoute(mt));

    let sport = styleOf(t['climbing:sport']);
    let trad = styleOf(t['climbing:trad']);
    if (sport === null && routes.length) sport = routes.some(isSport) ? true : routes.some(isTrad) ? false : null;
    if (trad === null && routes.length) trad = routes.some(isTrad) ? true : routes.some(isSport) ? false : null;
    // Bolts tagged on the crag itself mean sport climbing.
    if (sport === null && isSport(t)) sport = true;
    const boulder = styleOf(t['climbing:boulder']) === true;
    if (boulder && sport === null && trad === null && !routes.length) continue; // bouldering only

    const nor = [t['climbing:grade:norwegian:min'], t['climbing:grade:norwegian:max'], ...routes.map((r) => r['climbing:grade:norwegian'])].filter(Boolean) as string[];
    const fr = [t['climbing:grade:french:min'], t['climbing:grade:french:max'], ...routes.map((r) => r['climbing:grade:french'])].filter(Boolean) as string[];
    const grades = range(nor, 'norwegian') ?? range(fr, 'french');
    const system = range(nor, 'norwegian') ? 'norwegian' : grades ? 'french' : undefined;

    const routeCount = num(t['climbing:routes']) ?? (routes.length || null);
    const lengths = [num(t['climbing:length']), num(t['climbing:length:max']), ...routes.map((r) => num(r['climbing:length']))].filter((x): x is number => x != null);
    const url = t.website ?? t.url ?? t['contact:website'] ?? t['climbing:url:thecrag'] ?? t['climbing:url:mountainproject'] ?? undefined;

    seen.add(id);
    out.push({
      id, name, lat: pos.lat, lng: pos.lon,
      sport, trad, boulder,
      multipitch: styleOf(t['climbing:multipitch']) === true || routes.some((r) => (num(r['climbing:pitches']) ?? 1) > 1),
      routes: routeCount ?? null,
      ...(grades ? { gradeMin: grades.min, gradeMax: grades.max, gradeSystem: system } : {}),
      ...(t['climbing:rock'] || t.rock ? { rock: t['climbing:rock'] ?? t.rock } : {}),
      ...(t['climbing:orientation'] ? { orientation: t['climbing:orientation'] } : {}),
      ...(lengths.length ? { length: Math.max(...lengths) } : {}),
      ...(url ? { url } : {}),
      area: kind === 'area',
      ...(t.access && t.access !== 'yes' ? { access: t.access } : {}),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'nb'));
}

export type StyleFilter = 'all' | 'sport' | 'trad';
/** Unknown style shows under "all" only. */
export const matchesStyle = (c: Crag, f: StyleFilter) => f === 'all' || (f === 'sport' ? c.sport === true : c.trad === true);

/** Short style text: "Sport og trad", "Sport", "Trad", "Klatrefelt". */
export function styleText(c: Crag): string {
  if (c.sport && c.trad) return 'Sport og trad';
  if (c.sport) return 'Sport';
  if (c.trad) return 'Trad';
  return 'Klatrefelt';
}

/** "4–7+" / "5a–6c (fransk)" / '' */
export function gradeText(c: Crag): string {
  if (!c.gradeMin) return '';
  const r = c.gradeMin === c.gradeMax ? c.gradeMin : `${c.gradeMin}–${c.gradeMax}`;
  return c.gradeSystem === 'french' ? `${r} (fransk)` : r;
}
