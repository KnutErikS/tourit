import type { NveProblemRaw } from '../types';

/**
 * Two risk scores for a spot on a route (Rules 2 and 3 in the tourit rules note).
 *
 * SLABS (ISSW 2024): relative risk from Swiss accidents against tracked ski
 * tours. The product of four factors, each interpolated in log space between
 * the published knots:
 *   MSA40  85th percentile of slope within ~40 m      (domain/slopeWindow `neighbourhood`)
 *   level  × 4.3 per danger level
 *   DCE    metres into the warning's critical heights (negative = outside)
 *   AOF    share of the > 25° terrain that faces the warning's aspects
 * The paper doesn't publish its cut-offs. Ours (our own) are anchored to Stop
 * or Go: "elevated" from the risk of a 35° slope at level 3 at the edge of the
 * warning's heights, facing its aspects; "high" one danger level above that.
 * By the same factors, Stop or Go's 40° at level 2 and 30° at level 4 land
 * close to the same line, so the two tools agree.
 *
 * Munter's reduction method (bergundsteigen 2001): residual risk = danger
 * potential ÷ the reduction factors; acceptable at 1 or less.
 *   1st class, steepest part of the slope: 35–39° → 2, 30–34° → 3, under 30° → 4.
 *     At level 3 a 1st-class factor is required; at level 4 only under 30°.
 *   2nd class, aspect: outside the warning's aspects/heights → 4; outside the
 *     north half (WNW–N–ESE) → 3; outside the north sector (NW–N–NE) → 2.
 *     Void in wet snow; the north factors are void when the warning names all aspects.
 *   3rd class, group: your setting (GROUPS).
 * SLF's data say risk grows about 4× per level, not 2× as Munter assumes, so
 * the method is too lenient at level 3.
 *
 * Pure: type imports only.
 */

type Knots = [number, number][];

/** Factor for x, interpolated in log space between the knots; flat beyond the ends. */
export function logInterp(knots: Knots, x: number): number {
  if (x <= knots[0][0]) return knots[0][1];
  for (let k = 1; k < knots.length; k++) {
    const [x1, y1] = knots[k];
    if (x <= x1) {
      const [x0, y0] = knots[k - 1];
      return Math.exp(Math.log(y0) + ((x - x0) / (x1 - x0)) * (Math.log(y1) - Math.log(y0)));
    }
  }
  return knots[knots.length - 1][1];
}

export const MSA_KNOTS: Knots = [[20, 1], [25, 2.9], [30, 9.6], [35, 47], [40, 150], [45, 210]];
export const DCE_KNOTS: Knots = [[-500, 1], [0, 5.3], [500, 14.3], [1000, 15.7]];
export const AOF_KNOTS: Knots = [[0, 1], [1, 3.4]];
export const LEVEL_FACTOR = 4.3;
/** A warning or problem with no height band: inside everywhere. Counted as this far inside (our own). */
export const ALL_HEIGHTS_DCE = 500;

export interface SlabsInput {
  /** MSA40, degrees. */
  msa: number;
  /** Danger level, 1–5. */
  level: number;
  /** Metres into the critical heights. */
  dce: number;
  /** 0–1 */
  aof: number;
}

export function slabsRisk(i: SlabsInput): number {
  return logInterp(MSA_KNOTS, i.msa) * LEVEL_FACTOR ** (i.level - 1) * logInterp(DCE_KNOTS, i.dce) * logInterp(AOF_KNOTS, i.aof);
}

export type SlabsClass = 'low' | 'elevated' | 'high';
/** Our cut-offs, see the module comment. */
export const ELEVATED = slabsRisk({ msa: 35, level: 3, dce: 0, aof: 1 });
export const HIGH = ELEVATED * LEVEL_FACTOR;
export const slabsClass = (risk: number): SlabsClass => (risk >= HIGH ? 'high' : risk >= ELEVATED ? 'elevated' : 'low');

/** Signed metres into a problem's critical height band (negative = outside); null when it covers all heights. */
export function dceFor(p: NveProblemRaw, elev: number): number | null {
  const h1 = Number(p.ExposedHeight1) || 0, h2 = Number(p.ExposedHeight2) || 0;
  const lo = Math.min(h1, h2), hi = Math.max(h1, h2);
  switch (Number(p.ExposedHeightFill)) {
    case 1: return elev - h1; // above h1
    case 2: return h1 - elev; // below h1
    case 3: return Math.max(lo - elev, elev - hi); // below lo or above hi
    case 4: return Math.min(elev - lo, hi - elev); // between
    default: return null;
  }
}

/** DCE for the warning: the most critical of its problems. */
export function dce(problems: NveProblemRaw[], elev: number): number {
  let best = -Infinity;
  for (const p of problems) best = Math.max(best, dceFor(p, elev) ?? ALL_HEIGHTS_DCE);
  return problems.length ? best : ALL_HEIGHTS_DCE;
}

/** Aspect sectors (index 0–7 from north) named by any problem; all of them when a problem names none. */
export function exposedSectors(problems: { exp: boolean[] | null }[]): boolean[] {
  if (!problems.length || problems.some((p) => !p.exp)) return new Array<boolean>(8).fill(true);
  return Array.from({ length: 8 }, (_, k) => problems.some((p) => p.exp![k]));
}

/** AOF: share of the steep cells (by sector) that face the exposed sectors; 0 without steep terrain. */
export function aof(steepBySector: number[], exposed: boolean[]): number {
  const all = steepBySector.reduce((a, n) => a + n, 0);
  return all ? steepBySector.reduce((a, n, k) => a + (exposed[k] ? n : 0), 0) / all : 0;
}

/* ---------- Munter ---------- */

export type Group = 'solo' | 'small' | 'smallSpaced' | 'largeSpaced' | 'large';
/** 3rd class. Munter gives no factor for going alone. */
export const GROUPS: Record<Group, { label: string; rf: number }> = {
  small: { label: 'Liten gruppe (2–4)', rf: 2 },
  smallSpaced: { label: 'Liten gruppe med avstand', rf: 3 },
  largeSpaced: { label: 'Stor gruppe med 10 m avstand', rf: 2 },
  large: { label: 'Stor gruppe uten avstand', rf: 1 },
  solo: { label: 'Alene', rf: 1 },
};

export const DANGER_POTENTIAL: Record<number, number> = { 1: 2, 2: 4, 3: 8, 4: 16, 5: 32 };
const N_SECTOR = [7, 0, 1];
/** WNW–N–ESE: NV, N, NØ and Ø by sector centre. */
const N_HALF = [7, 0, 1, 2];

/** 1st class, from the steepest part of the slope. */
export const rf1 = (steepest: number) => (steepest >= 40 ? 1 : steepest >= 35 ? 2 : steepest >= 30 ? 3 : 4);

export interface Rf2Input {
  /** Which way the slope faces, 0–7; null on flat ground. */
  sector: number | null;
  /** In the warning's aspects and heights; null = unknown (counts as inside). */
  inCore: boolean | null;
  /** The warning names every aspect. */
  allAspects: boolean;
  /** The warning has a wet-snow problem. */
  wet: boolean;
}

/** 2nd class, from the aspect. */
export function rf2(i: Rf2Input): number {
  if (i.wet) return 1;
  if (i.inCore === false) return 4;
  if (i.allAspects || i.sector == null) return 1;
  if (!N_HALF.includes(i.sector)) return 3;
  if (!N_SECTOR.includes(i.sector)) return 2;
  return 1;
}

export interface MunterInput extends Rf2Input {
  level: number;
  /** Steepest part of the slope, degrees. */
  steepest: number;
  group: Group;
}

export interface Munter {
  dp: number;
  rf1: number;
  rf2: number;
  rf3: number;
  /** Residual risk. */
  rr: number;
  /** rr ≤ 1, and the level's 1st-class rule is kept. */
  ok: boolean;
  /** Why not, when a level rule breaks it. */
  rule?: string;
}

export function munter(i: MunterInput): Munter {
  const dp = DANGER_POTENTIAL[Math.min(5, Math.max(1, Math.round(i.level)))];
  const r1 = rf1(i.steepest), r2 = rf2(i), r3 = GROUPS[i.group].rf;
  const rr = dp / (r1 * r2 * r3);
  let rule: string | undefined;
  if (i.level >= 5) rule = 'Ved faregrad 5 er ingen bratte heng akseptable.';
  else if (i.level >= 4 && r1 < 4) rule = 'Ved faregrad 4 bare under 30°.';
  else if (i.level >= 3 && r1 < 2) rule = 'Ved faregrad 3 må det bratteste være under 40°.';
  return { dp, rf1: r1, rf2: r2, rf3: r3, rr, ok: rr <= 1 && !rule, ...(rule && { rule }) };
}
