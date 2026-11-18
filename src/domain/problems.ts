import type { NveProblemRaw, Problem, TerrainPoint } from '../types';

/**
 * Height band test from NVE's ExposedHeightFill.
 *
 * NVE documents the values only as which part of a mountain pictogram is
 * white/black. We read black as the exposed band:
 *   1 = black on top     → exposed above H1
 *   2 = black at bottom  → exposed below H1
 *   3 = white in middle  → exposed below min(H1,H2) and above max(H1,H2)
 *   4 = black in middle  → exposed between H1 and H2
 * If terrain hits disagree with the text on varsom.no, this is the mapping to fix.
 */
export function heightTest(p: NveProblemRaw): (z: number) => boolean {
  const h1 = Number(p.ExposedHeight1) || 0;
  const h2 = Number(p.ExposedHeight2) || 0;
  const lo = Math.min(h1, h2), hi = Math.max(h1, h2);
  switch (Number(p.ExposedHeightFill)) {
    case 1: return (z) => z >= h1;
    case 2: return (z) => z < h1;
    case 3: return (z) => z < lo || z >= hi;
    case 4: return (z) => z >= lo && z < hi;
    default: return () => true;
  }
}

export function heightText(p: NveProblemRaw): string {
  const h1 = p.ExposedHeight1, h2 = p.ExposedHeight2 ?? 0;
  switch (Number(p.ExposedHeightFill)) {
    case 1: return `over ${h1} moh.`;
    case 2: return `under ${h1} moh.`;
    case 3: return `under ${Math.min(h1 ?? 0, h2)} og over ${Math.max(h1 ?? 0, h2)} moh.`;
    case 4: return `mellom ${Math.min(h1 ?? 0, h2)} og ${Math.max(h1 ?? 0, h2)} moh.`;
    default: return 'alle høyder';
  }
}

/** "10011001" → [true,false,...]; anything else → null (all aspects). */
export function expArray(s: unknown): boolean[] | null {
  const str = String(s ?? '');
  return str.length === 8 ? [...str].map((ch) => ch === '1') : null;
}

export function parseProblem(raw: NveProblemRaw): Problem {
  return { raw, exp: expArray(raw.ValidExpositions), height: heightTest(raw) };
}

/** Does a terrain cell with this aspect sector and elevation fall inside the problem? */
export function matchesProblem(p: Problem, sector: number, elev: number): boolean {
  return (!p.exp || p.exp[sector]) && p.height(elev);
}

export type PointVerdict = { hit: true } | { hit: false; reason: string };

/** Full check for one picked point, including the steepness threshold. */
export function pointVerdict(p: Problem, t: TerrainPoint, thr: number): PointVerdict {
  const dirOk = !p.exp || p.exp[t.sector];
  const hOk = p.height(t.elev);
  const steep = t.slope >= thr;
  if (dirOk && hOk && steep) return { hit: true };
  const reason = !dirOk ? 'feil retning' : !hOk ? 'utenfor høydebåndet' : `slakere enn ${thr}°`;
  return { hit: false, reason };
}

export type ProblemKind = 'new' | 'wind' | 'pwl' | 'wet' | 'glide' | 'generic';

/** Classify a problem for the pictogram, from NVE's Norwegian type names. */
export function problemKind(p: NveProblemRaw): { k: ProblemKind; loose: boolean } {
  const t = `${p.AvalancheProblemTypeName ?? ''} ${p.AvalancheExtName ?? ''}`.toLowerCase();
  const loose = /løssnø/.test(t);
  if (/glide/.test(t)) return { k: 'glide', loose: false };
  if (/våt/.test(t)) return { k: 'wet', loose };
  if (/vedvarende|svakt lag/.test(t)) return { k: 'pwl', loose: false };
  if (/fokk|vind/.test(t)) return { k: 'wind', loose: false };
  if (/nysnø/.test(t)) return { k: 'new', loose };
  return { k: 'generic', loose };
}
