import { DANGER, DNAME } from '../config';
import { images, obsKind, regionObs } from '../domain/observations';
import { state } from '../state';
import { $, esc, txt } from '../util';
import { pointHitCount, pointLine } from './point';

/** The short summary at the bottom of the "Kartlag" tab. */
export function renderSummary(onOpenWarning: () => void): void {
  const el = $('summary');
  const r = state.selected;
  if (!r) {
    el.innerHTML = state.picked
      ? pointLine() + '<p class="empty">Punktet ligger utenfor varslingsregionene.</p>'
      : '<p class="empty">Trykk i kartet for å se varselet for et sted.</p>';
    return;
  }
  const w = r.warn, lvl = w ? w.level : 0, W = w ? w.w : {};
  const nProb = w ? w.problems.length : 0;
  const hits = w ? pointHitCount(w.problems) : null;
  const ro = regionObs(state.obs, state.regions, r);
  const nSkred = ro.filter((o) => obsKind(o) === 'skred').length;
  const nImg = ro.reduce((n, o) => n + images(o).length, 0);

  el.innerHTML = `<div class="rhead"><div class="badge" style="background:${DANGER[lvl]};${lvl >= 4 ? 'color:#fff' : ''}">${lvl || '–'}</div>
    <div><div class="rname">${esc(r.name)}</div><div class="rsub">${lvl ? 'Faregrad ' + lvl + ' · ' + DNAME[lvl].toLowerCase() : 'Ikke vurdert'}${
      nProb ? ` · ${nProb} skredproblem${nProb > 1 ? 'er' : ''}` : ''
    }</div></div></div>
    ${pointLine()}
    ${txt(W.MainText) ? `<p class="maintext">${esc(W.MainText)}</p>` : ''}
    ${
      hits !== null && nProb
        ? `<div class="rsub">${hits ? `<b>${hits}</b> av ${nProb} skredproblemer gjelder punktet du valgte.` : 'Ingen av skredproblemene gjelder punktet du valgte.'}</div>`
        : ''
    }
    ${ro.length ? `<div class="rsub">${ro.length} observasjoner i regionen siste tre døgn · ${nSkred} med skred · ${nImg} bilder</div>` : ''}
    ${lvl || ro.length ? '<div><button class="btn primary" id="open-warn">Les hele varselet</button></div>' : ''}`;

  document.getElementById('open-warn')?.addEventListener('click', onOpenWarning);
}
