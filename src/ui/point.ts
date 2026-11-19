import { DIRS } from '../config';
import { pointVerdict } from '../domain/problems';
import { toMgrs } from '../domain/mgrs';
import { state } from '../state';
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

/** "Valgt punkt · 1180 moh. · 34° · NØ-vendt" line. */
export function pointLine(): string {
  const picked = state.picked;
  if (!picked) return '';
  const mgrs = toMgrs(picked.ll.lat, picked.ll.lng);
  const grid = mgrs ? `<span class="pick-mgrs"><span>MGRS</span> <b>${esc(mgrs)}</b></span>` : '';
  return `<div class="pick"><span>Valgt punkt</span>${pointFacts()}${grid}</div>`;
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

/** "Vind siste tre døgn: fra SV, opptil 18 m/s · lesider NØ, Ø · punktet ligger i le" for a region, or ''. */
export function windLine(r: Region): string {
  const w = r.wind;
  if (!w) return '';
  const lee = DIRS.filter((_, k) => w.lee[k]);
  const head = `Vind siste tre døgn: <b>fra ${dirName(w.from)}</b>, opptil ${Math.round(w.max)} m/s`;
  if (!lee.length) return `<div class="rsub">${head} · lite vindtransport</div>`;
  const t = state.picked?.terrain;
  const here = t ? (w.lee[t.sector] ? ' · <b>punktet ligger i le</b>' : ' · punktet ligger ikke i le') : '';
  return `<div class="rsub">${head} · ${w.strong ? 'mye vindtransport, ' : ''}lesider <b>${lee.join(', ')}</b>${here}</div>`;
}
