import { DIRS } from '../config';
import { pointVerdict } from '../domain/problems';
import type { Info } from '../domain/infos';
import { toMgrs } from '../domain/mgrs';
import { state } from '../state';
import { pickedInfos } from '../tools/infos';
import { esc } from '../util';
import type { Problem, Region } from '../types';

/** Terrain facts for the picked point as `<b>`/`<span>` items: "1180 moh. · 34° · NØ-vendt" (or a status while loading). */
export function pointFacts(): string {
  const picked = state.picked;
  if (!picked) return '';
  const t = picked.terrain;
  const pos = `${picked.ll.lat.toFixed(4)}° N, ${picked.ll.lng.toFixed(4)}° Ø`;
  if (t === undefined) return `<b>${pos}</b><span>henter terreng…</span>`;
  if (!t) return `<b>${pos}</b><span>ingen høydedata her</span>`;
  return `<b>${Math.round(t.elev)} moh.</b><b>${t.slope.toFixed(0)}°</b><b>${DIRS[t.sector]}-vendt</b>`;
}

/** Small chips for the infos (domain/infos.ts), coloured by level; '' for none. */
export function infoChips(list: Info[] | undefined): string {
  if (!list?.length) return '';
  const chips = list.map((i) => `<span class="ichip ichip-${i.level}" title="${esc(i.text)}">${esc(i.chip)}</span>`).join('');
  return `<span class="ichips" aria-label="Infoer for punktet">${chips}</span>`;
}

/**
 * "Valgt punkt · 1180 moh. · 34° · NØ-vendt" line, with the point's info chips
 * (they appear once worked out). The Verktøy tab lists the infos instead: `chips: false`.
 */
export function pointLine({ chips = true } = {}): string {
  const picked = state.picked;
  if (!picked) return '';
  const mgrs = toMgrs(picked.ll.lat, picked.ll.lng);
  const grid = mgrs ? `<span class="pick-mgrs"><span>MGRS</span> <b>${esc(mgrs)}</b></span>` : '';
  return `<div class="pick"><span>Valgt punkt</span>${pointFacts()}${grid}${chips ? infoChips(pickedInfos()) : ''}</div>`;
}

/** "Gjelder punktet" / "Ikke her · reason" chip for one problem. */
export function pointHit(p: Problem): string {
  const t = state.picked?.terrain;
  if (!t) return '';
  const v = pointVerdict(p, t, state.thr);
  return v.hit ? '<span class="hitchip yes">Gjelder punktet</span>' : `<span class="hitchip no">Ikke her · ${v.reason}</span>`;
}

/** How many of the problems apply to the picked point (null if no terrain yet). */
export function pointHitCount(problems: Problem[]): number | null {
  const t = state.picked?.terrain;
  if (!t) return null;
  return problems.filter((p) => pointVerdict(p, t, state.thr).hit).length;
}

/** Compass name of a direction in degrees ("SV"). */
export const dirName = (deg: number) => DIRS[Math.round(deg / 45) % 8];

/** Why the wind moved little snow, for the wind line. */
const STUCK_TEXT = { crust: 'lite løs snø å flytte (skare etter mildvær/regn)', wet: 'lite snøtransport (våt snø i mildværet)' } as const;

/**
 * "Vind siste tre døgn: fra SV, opptil 18 m/s · 12 cm nysnø · lesider NØ, Ø · punktet ligger i le"
 * for a region, or ''.
 */
export function windLine(r: Region): string {
  const w = r.wind;
  if (!w) return '';
  const lee = DIRS.filter((_, k) => w.lee[k]);
  const snow = w.snowCm >= 1 ? ` · ${Math.round(w.snowCm)} cm nysnø siste fem døgn` : ' · ingen nysnø siste fem døgn';
  const head = `Vind siste tre døgn: <b>fra ${dirName(w.from)}</b>, opptil ${Math.round(w.max)} m/s${snow}`;
  if (!lee.length) return `<div class="rsub">${head} · ${w.stuck ? STUCK_TEXT[w.stuck] : 'lite vindtransport'}</div>`;
  const t = state.picked?.terrain;
  const here = t ? (w.lee[t.sector] ? ' · <b>punktet ligger i le</b>' : ' · punktet ligger ikke i le') : '';
  return `<div class="rsub">${head} · ${w.strong ? 'mye vindtransport, ' : ''}lesider <b>${lee.join(', ')}</b>${here}</div>`;
}
