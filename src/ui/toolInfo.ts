import { PATH_DEG, RED_AT } from '../domain/alptruth';
import {
  CRIT_CM, CRIT_COLD_C, CRIT_H, CRIT_SHOW, CRIT_WIND_MS, FINE_CLOUD, FIRST_FINE_CM, FIRST_FINE_H, FIRST_THAW_CM, FIRST_THAW_H,
  HARD_FREEZE_C, LOADING_H, NEW_SNOW_CM, RAIN_H, RAIN_MIN_MM, RAIN_SNOW_SHARE, RAPID_24H_MM, RAPID_MM_H, RAPID_RUN_H, THAW_RAIN_MM,
} from '../domain/precip';
import { ALL_HEIGHTS_DCE, DANGER_POTENTIAL, GROUPS, LEVEL_FACTOR } from '../domain/risk';
import { HEIGHT_MID_M, HEIGHT_NEAR_M, SIGNS_H } from '../domain/signs';
import { AOF_MIN_DEG, ASPECT_TOL_DEG, MSA_PERCENTILE, MSA_RADIUS_M, SLOPE_MIN_DEG, SLOPE_RADIUS_M, STRIP_M, TRACK_M, WINDOW_M } from '../domain/slopeWindow';
import { LIMIT, LOW_SPOT, MARGIN } from '../domain/stopOrGo';
import { $ } from '../util';

/**
 * The small ⓘ buttons beside the Verktøy tab's cards (and the route's risk box), and the dialog that
 * explains how each tool works. The numbers come from the code's own
 * constants, so the text follows when a threshold changes.
 *
 * Use: put `infoButton('stopOrGo')` in a card's heading; one click handler
 * on the document opens the right text (cards are re-rendered often).
 */

export type InfoTopic = 'stopOrGo' | 'alptruth' | 'routeRisk' | 'infos';

const num = (x: number) => String(x).replace('.', ',');
const STRIP_WIDTH = num(2 * STRIP_M);

const GROUP_LIST = Object.values(GROUPS)
  .map((g) => `${g.label.charAt(0).toLowerCase()}${g.label.slice(1)} → ${g.rf}`)
  .join(', ');

const neg = (x: number) => String(x).replace('-', '−');
const range = (k: keyof typeof CRIT_CM) => `${CRIT_CM[k][0]}–${CRIT_CM[k][1]} cm`;

const TOPICS: Record<InfoTopic, { title: string; label: string; body: string }> = {
  infos: {
    title: 'Slik virker facts',
    label: 'Slik virker facts',
    body: `
<p>Korte varsler om vær og observasjoner som gjør skred mer sannsynlig. De vises bare når de slår til: øverst her og som merker på punktet. Under «Alle facts og hvorfor» ser du alle, med tallene bak, også de som ikke slo til.</p>

<p class="kicker">Facts</p>
<ul class="dlg-list">
  <li><b>Kritisk nysnømengde:</b> nysnø siste ${CRIT_H} t mot kritisk mengde: ${range('favourable')} ved gunstige forhold, ${range('average')} ved middels og ${range('unfavourable')} ved ugunstige. Ugunstig er sterk vind under snøfallet (minst ${CRIT_WIND_MS} m/s i ca. 1400 moh.), kaldt snøfall (under ${neg(CRIT_COLD_C)} °C) og gammel snø eller skare under. Ingen av dem gir gunstige, én middels, to eller flere ugunstige. Appen regner mot den laveste verdien. Vises fra ${Math.round(CRIT_SHOW * 100)} %, rød fra 100 % (SLF, Alpenverein).</li>
  <li><b>Regn på snø:</b> minst ${num(RAIN_MIN_MM)} mm regn (høyst ${Math.round(RAIN_SNOW_SHARE * 100)} % som snø) de ${RAIN_H} timene før eller etter, der seNorge viser snø (Varsom).</li>
  <li><b>Første mildvær:</b> 0 °C mellom kl. 08 og 16 etter minst ${FIRST_THAW_CM} cm nysnø siste ${FIRST_THAW_H} t, og første gang siden snøfallet (Varsom, SLF).</li>
  <li><b>Powder bluebird</b> (første fine dag): under ${FINE_CLOUD} % skydekke mellom kl. 08 og 16 etter minst ${FIRST_FINE_CM} cm nysnø siste ${FIRST_FINE_H} t, uten nysnø på dagen, og dagen før var ikke fin (SLF).</li>
  <li><b>Nattefrost:</b> natta før dagen, fra solnedgang til soloppgang. Ingen: laveste over 0 °C, eller over −1 °C med minst 80 % skydekke. God: −2 °C eller kaldere med under 50 % skydekke, eller ${neg(HARD_FREEZE_C)} °C eller kaldere uansett skyer. Ellers svak. Vises bare når det er 0 °C i dag eller i går, og «god» bare når dagen blir mild.</li>
  <li><b>Dårlig test</b> (ECT klasse 1–2): meldt i Regobs i regionen siste ${SIGNS_H} t, vektet etter høyde og himmelretning som i ALPTRUTh.</li>
</ul>

<p class="kicker">Svarene</p>
<p><b>Treff</b>: den slår til. <b>Nei</b>: sjekket, og tallene viser hvorfor ikke. <b>Ukjent</b>: dataene mangler, for eksempel skydekke eller vær for natta. Viser seNorge barmark der du er, gjelder bare Regobs-testene.</p>

<p class="kicker">Begrensninger</p>
<p>For dager som har vært, er været fra Open-Meteo (ICON) midt i regionen, i ca. 1400 moh. Fra nå og framover er det MET sin prognose for punktet. Grensene for skydekke og nattefrost er våre egne startverdier, ikke testet mot ulykkesdata.</p>`,
  },
  routeRisk: {
    title: 'Slik virker SLABS og Munter',
    label: 'Slik virker SLABS og Munter',
    body: `
<p>To måter å regne skredrisiko på, omtrent for hver 25. meter av ruta, ut fra dagens varsel der ruta går. Stripa under høydeprofilen viser hvor.</p>

<p class="kicker">SLABS</p>
<p>En modell fra sveitsiske ulykker sammenlignet med GPS-spor fra vanlige skiturer (ISSW 2024). Risikoen er fire faktorer ganget sammen:</p>
<ul class="dlg-list">
  <li><b>Bratthet:</b> ${Math.round(MSA_PERCENTILE * 100)}-persentilen av helningen innen ${MSA_RADIUS_M} m. Fra 20° til 40° øker risikoen 150 ganger.</li>
  <li><b>Faregrad:</b> × ${num(LEVEL_FACTOR)} per faregrad.</li>
  <li><b>Høyde:</b> hvor langt inne i varselets høydebånd du er, opptil × 15,7. Et skredproblem uten høydebånd regnes som ${ALL_HEIGHTS_DCE} m inne.</li>
  <li><b>Himmelretning:</b> hvor stor del av terrenget over ${AOF_MIN_DEG}° rundt deg som vender mot varselets himmelretninger, opptil × 3,4.</li>
</ul>
<p>Studien oppgir ikke sine grenser. Våre: <b>forhøyet</b> fra risikoen i et 35° heng ved faregrad 3 i kanten av varselets høyder og retninger, <b>høy</b> fra én faregrad over det. Da havner Stop or Go-grensene (40° ved 2, 35° ved 3, 30° ved 4) nær «forhøyet», så de to verktøyene er enige. SLABS bygger på sveitsiske data og er bare veiledende i Norge.</p>

<p class="kicker">Munters reduksjonsmetode</p>
<p>Restrisiko = farepotensial ÷ reduksjonsfaktorene. Akseptabelt når den er 1 eller lavere.</p>
<ul class="dlg-list">
  <li><b>Farepotensial:</b> faregrad 1 → ${DANGER_POTENTIAL[1]}, 2 → ${DANGER_POTENTIAL[2]}, 3 → ${DANGER_POTENTIAL[3]}, 4 → ${DANGER_POTENTIAL[4]}.</li>
  <li><b>1. klasse, det bratteste i henget</b> (som «hele henget» i Stop or Go): 35–39° → 2, 30–34° → 3, under 30° → 4. Ved faregrad 3 må det bratteste være under 40°, ved faregrad 4 under 30°.</li>
  <li><b>2. klasse, himmelretning:</b> utenfor varselets retninger og høyder → 4; utenfor nordre halvdel (VNV–N–ØSØ) → 3; utenfor nordsektoren (NV–N–NØ) → 2. Gjelder ikke ved våt snø, og nordfaktorene gjelder ikke når varselet sier alle retninger.</li>
  <li><b>3. klasse, gruppa:</b> ${GROUP_LIST}. Velg gruppe i boksen.</li>
</ul>
<p>Munter regner med at risikoen dobles per faregrad. Sveitsiske data viser omtrent fire ganger, så metoden er for snill ved faregrad 3.</p>

<p class="kicker">Begrensninger</p>
<p>Begge ser bare på terrenget og varselet: ikke på faretegn, snødekket eller hvor du faktisk går i henget. Bratthet og retning er fra terrengmodellen, nøyaktig til noen få grader.</p>
<p class="dlg-note">Kilder: SLABS (ISSW 2024); Munter, bergundsteigen 2001; SLF.</p>`,
  },
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
