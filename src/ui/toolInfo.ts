import { PATH_DEG, RED_AT } from '../domain/alptruth';
import { LOADING_H, NEW_SNOW_CM, RAPID_24H_MM, RAPID_MM_H, RAPID_RUN_H, THAW_RAIN_MM } from '../domain/precip';
import { HEIGHT_MID_M, HEIGHT_NEAR_M, SIGNS_H } from '../domain/signs';
import { ASPECT_TOL_DEG, SLOPE_MIN_DEG, SLOPE_RADIUS_M, STRIP_M, TRACK_M, WINDOW_M } from '../domain/slopeWindow';
import { LIMIT, LOW_SPOT, MARGIN } from '../domain/stopOrGo';
import { $ } from '../util';

/**
 * The small ⓘ buttons beside the Verktøy tab's cards, and the dialog that
 * explains how each tool works. The numbers come from the code's own
 * constants, so the text follows when a threshold changes.
 *
 * Use: put `infoButton('stopOrGo')` in a card's heading; one click handler
 * on the document opens the right text (cards are re-rendered often).
 */

export type InfoTopic = 'stopOrGo' | 'alptruth';

const num = (x: number) => String(x).replace('.', ',');
const STRIP_WIDTH = num(2 * STRIP_M);

const TOPICS: Record<InfoTopic, { title: string; label: string; body: string }> = {
  stopOrGo: {
    title: 'Slik virker Stop or Go',
    label: 'Slik virker Stop or Go',
    body: `
<p>Hvor bratt kan det være der du er, ved dagens faregrad? Regelen kommer fra Alpenverein (Stop or Go) og SLF (Graphical Reduction Method). Den er et hjelpemiddel i planleggingen, ikke en dom over henget.</p>

<p class="kicker">Grensen per faregrad</p>
<ul class="dlg-list">
  <li><b>1 Liten:</b> ingen generell grense, men enkeltpunkter på ${LOW_SPOT}° og brattere kan løsne.</li>
  <li><b>2 Moderat:</b> under ${LIMIT[2]}° der sporet går.</li>
  <li><b>3 Betydelig:</b> under ${LIMIT[3]}° i hele henget.</li>
  <li><b>4–5 Stor og meget stor:</b> under ${LIMIT[4]}° i hele henget, og utenfor NVEs utløpssoner.</li>
</ul>

<p class="kicker">Faregraden som brukes</p>
<ul class="dlg-list">
  <li>Utenfor himmelretningene og høydene i varselet: én faregrad lavere (SLF). Er de ukjente for punktet, brukes faregraden i varselet.</li>
  <li>Ferske skred, drønn eller skytende sprekker meldt i Regobs i regionen siste ${SIGNS_H} t: én faregrad høyere (SLF). Ved faregrad 3 og høyere teller også dårlige stabilitetstester (ECT klasse 1–2).</li>
  <li>Meldinger nær din høyde og himmelretning teller mest, se ⓘ ved ALPTRUTh.</li>
</ul>

<p class="kicker">Slik måles brattheten</p>
<ul class="dlg-list">
  <li>Det bratteste området på ${WINDOW_M} × ${WINDOW_M} m, ikke én kartrute, så en stein eller en feil i terrengmodellen ikke avgjør.</li>
  <li><b>Der sporet går:</b> innen ${TRACK_M} m fra punktet.</li>
  <li><b>Hele henget:</b> en ${STRIP_WIDTH} m bred stripe langs fallinja der du står, inntil ${SLOPE_RADIUS_M} m opp og ned, der terrenget er minst ${SLOPE_MIN_DEG}° bratt og vender samme vei (innenfor ${ASPECT_TOL_DEG}°). Er det slakere enn ${SLOPE_MIN_DEG}° der du står, er «hele henget» bare der du står.</li>
</ul>

<p class="kicker">Svaret</p>
<ul class="dlg-list">
  <li><b>Stopp:</b> brattere enn grensen, eller i en utløpssone ved faregrad 4–5.</li>
  <li><b>Varsomt:</b> innen ${MARGIN}° under grensen. Terrengmodellen er bare nøyaktig til noen få grader.</li>
  <li><b>Gå:</b> slakere enn det.</li>
</ul>

<p class="kicker">Begrensninger</p>
<p>Et heng som svinger, som en skål, kan ha bratte partier rundt svingen som stripa ikke får med. Skavler, små heng og terrengfeller vises ikke. ${TRACK_M} m, ${SLOPE_MIN_DEG}°, ${SLOPE_RADIUS_M} m, ${STRIP_WIDTH} m og ${ASPECT_TOL_DEG}° er våre egne valg, ikke testet mot ulykkesdata.</p>
<p class="dlg-note">Kilder: Alpenverein, Stop or Go; SLF, Graphical Reduction Method og RiskCheck.</p>`,
  },
  alptruth: {
    title: 'Slik virker ALPTRUTh',
    label: 'Slik virker ALPTRUTh',
    body: `
<p>Tell de tydelige faretegnene. I 715 skredulykker i USA skjedde nesten tre av fire med 3 eller flere av disse 7 tegnene til stede, og ingen med null. Fra ${RED_AT} tegn blir telleren rød.</p>

<p class="kicker">De 7 tegnene, og hvor appen finner dem</p>
<ul class="dlg-list">
  <li><b>A · Ferske skred:</b> skred meldt i Regobs i regionen siste ${SIGNS_H} t, regnet fra når skredet gikk.</li>
  <li><b>L · Ny last:</b> mer enn ${NEW_SNOW_CM} cm nysnø siste ${LOADING_H} t; rask oppbygging (minst ${num(RAPID_MM_H)} mm/t som snø i ${RAPID_RUN_H} t på rad, eller minst ${RAPID_24H_MM} mm nedbør siste 24 t); leside for vinden de siste døgnene; eller fersk vindtransportert snø eller stort snøfall meldt i Regobs.</li>
  <li><b>P · Skredbane:</b> minst ${PATH_DEG}° der du står, eller i NVEs bratte terreng eller utløpssoner.</li>
  <li><b>T · Terrengfelle:</b> regnes ikke ut ennå. Kryss av selv hvis det er stup, gjel, søkk, tett skog eller vann under deg.</li>
  <li><b>R · Faregrad:</b> 3 (betydelig) eller høyere i varselet.</li>
  <li><b>U · Ustabil snø:</b> drønn, skytende sprekker eller dårlige stabilitetstester (ECT klasse 1–2) meldt i Regobs siste ${SIGNS_H} t.</li>
  <li><b>Th · Mildvær:</b> over 0 °C eller minst ${num(THAW_RAIN_MM)} mm regn mellom kl. 08 og 16 på dagen, eller rask temperaturstigning eller mye vann i snøen meldt i Regobs.</li>
</ul>

<p class="kicker">Regobs-meldinger</p>
<p>En melding teller 1 når den er innen ${HEIGHT_NEAR_M} m fra din høyde, 0,5 innen ${HEIGHT_MID_M} m og 0,25 lenger unna. Et skred i en annen himmelretning enn din eller nabo-retningene teller halvparten. Det meldingen ikke sier noe om, teller fullt. Et tegn slås på når meldingene til sammen teller 1: én nær deg, eller flere lenger unna. Vektingen er vårt eget valg.</p>

<p class="kicker">Været</p>
<p>Timene som har vært, er fra Open-Meteo (ICON-modellen) midt i regionen, i ca. 1400 moh. Fra nå og framover brukes MET sin prognose for punktet, justert til punktets høyde. For dager som har vært, kan temperaturen derfor avvike mye fra lavere terreng.</p>

<p class="kicker">Dine egne kryss</p>
<p>Du kan krysse av eller fjerne krysset på hvert tegn selv, for det du ser på turen. Ditt kryss teller foran dataene, begge veier. Tegn om dagen (A, L, R, U, Th) huskes for datoen, tegn om henget (P, T) for stedet (ca. 100 m). Kryssene lagres bare på denne enheten, i 30 dager.</p>

<p class="kicker">Begrensninger</p>
<p>Telleren er en huskeliste, ikke en sannsynlighet. Null tegn betyr ikke at det er trygt.</p>
<p class="dlg-note">Kilde: McCammon (2004), Heuristic traps in recreational avalanche accidents.</p>`,
  },
};

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></svg>';

/** The small ⓘ button for a card heading (trusted HTML). */
export function infoButton(topic: InfoTopic): string {
  const t = TOPICS[topic];
  return `<button type="button" class="info-btn sm" data-info="${topic}" aria-haspopup="dialog" aria-controls="tool-info" aria-label="${t.label}" title="${t.label}">${ICON}</button>`;
}

export function openToolInfo(topic: InfoTopic): void {
  const t = TOPICS[topic];
  const dlg = $<HTMLDialogElement>('tool-info');
  $('tool-info-title').textContent = t.title;
  $('tool-info-body').innerHTML = t.body;
  // The title has autofocus, so the dialog opens at the top (not scrolled down to "Lukk").
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
}

export function initToolInfo(): void {
  const dlg = $<HTMLDialogElement>('tool-info');
  $('tool-info-ok').addEventListener('click', () => dlg.close());
  // Tap on the dimmed backdrop closes it too.
  dlg.addEventListener('click', (e) => e.target === dlg && dlg.close());
  // One handler for every ⓘ button, also the ones in cards drawn later.
  document.addEventListener('click', (e) => {
    const btn = (e.target as Element | null)?.closest?.<HTMLElement>('[data-info]');
    const topic = btn?.dataset.info;
    if (topic && topic in TOPICS) openToolInfo(topic as InfoTopic);
  });
}
