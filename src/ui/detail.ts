import { DANGER, DIRS, DNAME } from '../config';
import { regionObs } from '../domain/observations';
import { heightText } from '../domain/problems';
import { state } from '../state';
import type { NveWarningRaw } from '../types';
import { $, esc, fmtDate, fmtTime, txt } from '../util';
import { heightSVG, problemIcon, roseSVG } from './icons';
import { obsListHTML, wireObsList } from './obsHtml';
import { pointHit, pointLine, windLine } from './point';

const EMPTY_HINT =
  '<p class="empty">Trykk på et sted i kartet. Du får varselet for regionen stedet ligger i, og ser om akkurat det punktet er utsatt for skredproblemene.</p>';

function block(title: string, body: string, open = false): string {
  return body ? `<details class="ws"${open ? ' open' : ''}><summary>${title}</summary><div>${body}</div></details>` : '';
}

function mountainWeatherHTML(W: NveWarningRaw): string {
  const mw = W.MountainWeather;
  if (!mw) return '';
  const rows: [string, string][] = [];
  if (txt(mw.CloudCoverName)) rows.push(['Skydekke', mw.CloudCoverName!]);
  (mw.MeasurementTypes ?? []).forEach((t) => {
    const v = (t.MeasurementSubTypes ?? [])
      .filter((st) => st.Value != null && st.Value !== '')
      .map((st) => `${st.Name.toLowerCase()} ${st.Value}`)
      .join(', ');
    if (v) rows.push([t.Name, v]);
  });
  const texts = (mw.MeasurementTexts ?? []).map((t) => txt(t.Text)).filter(Boolean);
  return block(
    'Fjellvær',
    (rows.length ? `<dl class="wx">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : '') +
      texts.map((t) => `<p class="wtext">${esc(t)}</p>`).join(''),
  );
}

/** The "Skredvarsel" tab: the full warning for the selected region, varsom.no style. */
export function renderDetail(onOpenObs: (regId: number) => void): void {
  const el = $('detail');
  const r = state.selected;
  if (!r) {
    el.innerHTML = state.picked ? pointLine() + '<p class="empty">Punktet ligger utenfor varslingsregionene.</p>' : EMPTY_HINT;
    return;
  }
  const w = r.warn, lvl = w ? w.level : 0, W: NveWarningRaw = w ? w.w : {};
  const col = DANGER[lvl];

  let html = `<div class="rhead"><div class="badge" style="background:${col};${lvl >= 4 ? 'color:#fff' : ''}">${lvl || '–'}</div>
    <div><div class="rname">${esc(r.name)}</div><div class="rsub">Faregrad ${lvl ? lvl + ' · ' + DNAME[lvl].toLowerCase() : 'ikke vurdert'} · ${fmtDate(state.date)}${
      W.PublishTime && lvl ? `<br>Publisert ${esc(fmtTime(W.PublishTime))}${W.Author ? ' av ' + esc(W.Author) : ''}` : ''
    }</div></div></div>`;
  html += pointLine();
  html += windLine(r);
  if (txt(W.MainText)) html += `<p class="maintext">${esc(W.MainText)}</p>`;
  if (txt(W.EmergencyWarning)) html += `<div class="alert"><b>Varsel om naturlig utløste skred.</b> ${esc(W.EmergencyWarning)}</div>`;
  if (txt(W.AvalancheDanger)) html += `<p class="wtext">${esc(W.AvalancheDanger)}</p>`;

  if (w && w.problems.length) {
    html +=
      `<p class="kicker">Skredproblemer</p><div class="probs">` +
      w.problems
        .map((p, i) => {
          const raw = p.raw;
          const dirs = p.exp ? (p.exp.every(Boolean) ? 'alle retninger' : DIRS.filter((_, k) => p.exp![k]).join(', ')) : 'alle retninger';
          const facts = (
            [
              ['Svakt lag', raw.AvalCauseName],
              ['Utløsning', raw.AvalTriggerSensitivityName || raw.AvalTriggerSimpleName],
              ['Utbredelse', raw.AvalPropagationName],
              ['Sannsynlighet', raw.AvalProbabilityName],
              ['Størrelse', raw.DestructiveSizeExtName || raw.DestructiveSizeName],
              ['Skredtype', raw.AvalancheExtName || raw.AvalancheTypeName],
            ] as [string, string | undefined][]
          )
            .filter(([, v]) => txt(v))
            .map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`)
            .join('');
          const ptext = txt(raw.TriggerSenitivityPropagationDestuctiveSizeText);
          return `<article class="prob">
        <div class="prob-top"><div class="picon">${problemIcon(raw, col)}</div>
          <div><div class="pnum">Problem ${i + 1} av ${w.problems.length}</div><h3>${esc(raw.AvalancheProblemTypeName || raw.AvalancheExtName || 'Skredproblem')}</h3>${pointHit(p)}</div></div>
        <div class="prob-where">
          <div class="where">${roseSVG(p.exp || Array(8).fill(true), col, 50)}<div><span>Utsatt</span><b>${esc(dirs)}</b></div></div>
          <div class="where">${heightSVG(raw, col)}<div><span>Høyde</span><b>${esc(heightText(raw))}</b></div></div>
        </div>
        ${facts ? `<dl class="facts">${facts}</dl>` : ''}
        ${ptext ? `<p class="ptext">${esc(ptext)}</p>` : ''}
      </article>`;
        })
        .join('') +
      `</div>`;
  } else if (lvl) {
    html += '<p class="empty">Varselet har ingen skredproblemer med retning og høyde. Kartet viser da alt bratt terreng i regionen i svak farge.</p>';
  }

  const adv = (W.AvalancheAdvices ?? []).map((a) => txt(a.Text)).filter(Boolean);
  html += block('Ferdselsråd', adv.length ? `<ul class="advice">${adv.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : '', true);
  html += block(
    'Snødekke',
    [
      txt(W.SnowSurface) && `<p class="wtext">${esc(W.SnowSurface)}</p>`,
      txt(W.CurrentWeaklayers) && `<p class="kicker">Svake lag</p><p class="wtext">${esc(W.CurrentWeaklayers)}</p>`,
    ]
      .filter(Boolean)
      .join(''),
  );
  html += block(
    'Skredaktivitet og observasjoner',
    [
      txt(W.LatestAvalancheActivity) && `<p class="wtext">${esc(W.LatestAvalancheActivity)}</p>`,
      txt(W.LatestObservations) && `<p class="kicker">Siste observasjoner</p><p class="wtext">${esc(W.LatestObservations)}</p>`,
    ]
      .filter(Boolean)
      .join(''),
  );
  html += mountainWeatherHTML(W);

  const ro = regionObs(state.obs, state.regions, r);
  html += block(`Observasjoner fra Regobs (${ro.length})`, obsListHTML(ro), true);
  if (lvl)
    html += `<a class="varsom-link" href="https://www.varsom.no/snoskred/varsling/" target="_blank" rel="noopener">Sammenlign med varsom.no ↗</a>`;

  el.innerHTML = html;
  wireObsList(el, onOpenObs);
}
