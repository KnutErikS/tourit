import { DIRS } from '../config';
import { pointVerdict } from '../domain/problems';
import { toMgrs } from '../domain/mgrs';
import { state } from '../state';
import { esc } from '../util';
import type { Problem } from '../types';

/** "Valgt punkt · 1180 moh. · 34° · NØ-vendt" line. */
export function pointLine(): string {
  const picked = state.picked;
  if (!picked) return '';
  const t = picked.terrain;
  const mgrs = toMgrs(picked.ll.lat, picked.ll.lng);
  const grid = mgrs ? `<span class="pick-mgrs"><span>MGRS</span> <b>${esc(mgrs)}</b></span>` : '';
  const pos = `${picked.ll.lat.toFixed(4)}° N, ${picked.ll.lng.toFixed(4)}° Ø`;
  if (t === undefined) return `<div class="pick"><span>Valgt punkt</span><b>${pos}</b><span>henter terreng…</span>${grid}</div>`;
  if (!t) return `<div class="pick"><span>Valgt punkt</span><b>${pos}</b><span>ingen høydedata her</span>${grid}</div>`;
  return `<div class="pick"><span>Valgt punkt</span><b>${Math.round(t.elev)} moh.</b><b>${t.slope.toFixed(0)}°</b><b>${DIRS[t.sector]}-vendt</b>${grid}</div>`;
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
