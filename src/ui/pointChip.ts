import { DANGER, DNAME } from '../config';
import { matchesProblem, pointVerdict } from '../domain/problems';
import type { StopOrGoStatus } from '../domain/stopOrGo';
import { state } from '../state';
import { assessStopOrGo, type StopOrGoAssessment } from '../tools/stopOrGo';
import type { NveProblemRaw, Picked } from '../types';
import { esc } from '../util';
import { coordSource, setCoordVerdict } from './coords';

/**
 * The answer for the picked point, on the map chip: the region's danger level,
 * whether the point is in one of the avalanche problems, and Stop or Go.
 * Tapping it opens the warning (coords.ts wires the tap).
 *
 * Worked out again whenever the panels are (point, day or data changed);
 * several calls in a row become one run.
 */

const STATUS: Record<StopOrGoStatus, string> = { go: 'Gå', caution: 'Varsomt', stop: 'Stopp', none: '' };

/** "Fokksnø (flakskred)" → "Fokksnø". */
const problemName = (raw: NveProblemRaw) =>
  (raw.AvalancheProblemTypeName || raw.AvalancheExtName || 'Skredproblem').replace(/\s*\(.*\)\s*$/, '');

/** "Treffer Fokksnø" / "I sonen for Fokksnø · slakere enn 30°" / "Utenfor skredproblemene", or '' while terrain loads. */
function problemLine(): string {
  const r = state.selected, t = state.picked?.terrain;
  if (!r) return 'Utenfor varslingsregionene';
  const w = r.warn;
  if (!w || w.level < 1) return 'Ingen varsel denne dagen';
  if (!t) return esc(r.name); // no terrain (yet): the facts beside it say so
  if (!w.problems.length) return esc(r.name);
  const names = (ps: typeof w.problems) => esc([...new Set(ps.map((p) => problemName(p.raw)))].join(', '));
  const hits = w.problems.filter((p) => pointVerdict(p, t, state.thr).hit);
  if (hits.length) return `Treffer <b>${names(hits)}</b>`;
  const zone = w.problems.filter((p) => matchesProblem(p, t.sector, t.elev));
  if (zone.length) return `I sonen for ${names(zone)} · slakere enn ${state.thr}°`;
  return 'Utenfor skredproblemene';
}

function html(sog: StopOrGoAssessment | null): string {
  const r = state.selected;
  const lvl = r?.warn?.level ?? 0;
  const badge = r
    ? `<span class="c-lvl" style="background:${DANGER[lvl]};${lvl >= 4 ? 'color:#fff' : ''}" title="Faregrad ${lvl ? `${lvl} ${DNAME[lvl].toLowerCase()}` : 'ikke vurdert'}">${lvl || '–'}</span>`
    : '';
  const status = sog && sog.level >= 1 && sog.steepness != null ? STATUS[sog.status] : '';
  const pill = status ? `<span class="c-sog sog-${sog!.status}">${status}</span>` : '';
  const line = problemLine();
  // Full text on hover, for when it's cut short (it is already escaped; only the <b> tags go).
  return `${badge}${pill}<span class="c-prob" title="${line.replace(/<[^>]+>/g, '')}">${line}</span><svg class="c-more" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let token = 0;
/** Last Stop or Go, kept on screen (for the same point) while the next one is worked out. */
let last: { for: Picked; res: StopOrGoAssessment } | null = null;

async function run(): Promise<void> {
  const my = ++token;
  const p = state.picked;
  if (!p || coordSource() !== 'pick') return;
  const prev = last?.for === p ? last.res : null;
  setCoordVerdict(html(prev));
  if (p.terrain === undefined) return; // pickPoint calls again once the terrain is in
  const res = await assessStopOrGo(p.ll, p.terrain).catch(() => null);
  if (my !== token || state.picked !== p || coordSource() !== 'pick') return;
  if (res) last = { for: p, res };
  setCoordVerdict(html(res));
}

export function refreshPointChip(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void run();
  }, 80);
}
