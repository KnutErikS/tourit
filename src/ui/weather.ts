import { DIRS } from '../config';
import {
  PHASE_NAME, phaseOf, precipUntil, skyText, spread, summarize,
  type PointWeather, type WeatherSummary,
} from '../domain/weather';
import { state } from '../state';
import { $, esc, fmtTime, isoDate } from '../util';
import { pointLine } from './point';

/** Daytime on a touring day, local time. */
const DAY_FROM_H = 6, DAY_TO_H = 18;
const HOUR = 3_600_000;

const dirName = (deg: number) => DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
const r1 = (x: number) => (x < 10 ? x.toFixed(1).replace('.', ',') : Math.round(x).toString());
const deg = (t: number) => `${Math.round(t)}°`;
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
/** Arrow pointing the way the wind blows (from `from` degrees). */
const arrow = (from: number) => `<i class="wx-arrow" style="transform:rotate(${Math.round(from)}deg)">↓</i>`;

/** Which time window to show for the selected date, or a reason there is none. */
function windowFor(w: PointWeather): { from: number; to: number; label: string } | string {
  const now = Date.now();
  const day = new Date(state.date + 'T00:00:00');
  const dayFrom = day.getTime() + DAY_FROM_H * HOUR, dayTo = day.getTime() + DAY_TO_H * HOUR;
  const last = w.steps.length ? w.steps[w.steps.length - 1].time : 0;
  if (state.date < isoDate(new Date())) return 'Værvarselet gjelder bare fram i tid. Velg i dag eller en senere dag for å se været.';
  if (dayFrom > last) return 'Værvarselet rekker ikke så langt fram.';
  if (dayTo <= now) return { from: now, to: now + 12 * HOUR, label: 'Neste 12 timer' };
  return { from: Math.max(dayFrom, now), to: dayTo, label: `${now > dayFrom ? 'Resten av dagen' : 'Dagtid'} ${DAY_FROM_H}–${DAY_TO_H}` };
}

function precipLine(s: WeatherSummary): string {
  if (s.precip < 0.1) {
    const max = s.precipMax != null && s.precipMax >= 0.5 ? ` (opptil ${r1(s.precipMax)} mm)` : '';
    return `Opphold${max}`;
  }
  const frac = s.snowMm / s.precip;
  const phase = phaseOf(frac);
  const range = s.precipMax != null && s.precipMax > s.precip + 0.5 ? `–${r1(s.precipMax)}` : '';
  let line = `${r1(s.precip)}${range} mm ${PHASE_NAME[phase]}`;
  if (phase === 'sleet') line += ` (${Math.round(frac * 100)} % som snø)`;
  if (s.snowCm >= 0.5) line += ` · ca. ${Math.round(s.snowCm)} cm nysnø`;
  return line;
}

function cloudLine(s: WeatherSummary): string {
  const parts = [
    ['lavt', s.cloudLowAvg],
    ['middels', s.cloudMidAvg],
    ['høyt', s.cloudHighAvg],
  ].filter(([, v]) => v != null).map(([k, v]) => `${k} ${Math.round(v as number)} %`);
  return parts.length ? parts.join(' · ') : `${Math.round(s.cloudAvg)} %`;
}

function timeline(w: PointWeather, from: number, to: number): string {
  const shown = spread(w.steps, from, to, 3);
  if (shown.length < 2) return '';
  const cells = shown.map((s, i) => {
    const next = shown[i + 1]?.time ?? Math.min(to, s.time + 3 * HOUR);
    const p = precipUntil(w.steps, s.time, next);
    const pTxt = p.mm >= 0.1 ? `${r1(p.mm)} <small>${PHASE_NAME[phaseOf(p.snowFrac)]}</small>` : '–';
    return `<div class="wx-cell"><span class="wx-t">${hhmm(s.time)}</span><b>${deg(s.temp)}</b>`
      + `<span>${arrow(s.windFrom)}${Math.round(s.wind)}${s.gust != null ? `<small>(${Math.round(s.gust)})</small>` : ''}</span>`
      + `<span>${pTxt}</span><span class="wx-sky">${esc(skyText(s.cloud, s.fog))}</span></div>`;
  });
  return `<div class="wx-line" aria-label="Time for time">${cells.join('')}</div>`;
}

/** The weather card for the picked point: summary for the selected day plus a 3-hourly timeline. */
export function pointWeather(): string {
  const p = state.picked;
  if (!p) return '';
  const head = '<p class="kicker">Vær i punktet</p>';
  if (p.weather === undefined) return `<div class="wxcard">${head}<p class="rsub">Henter værvarsel…</p></div>`;
  if (p.weather === null) return `<div class="wxcard">${head}<p class="rsub">Fikk ikke hentet værvarsel (${esc(p.weatherErr ?? 'nettverksfeil')}).</p></div>`;

  const { data: w, savedAt } = p.weather;
  const win = windowFor(w);
  const yr = `https://www.yr.no/nb/v%C3%A6rvarsel/daglig-tabell/${w.lat.toFixed(3)},${w.lon.toFixed(3)}`;
  const foot = `<p class="wx-src">${savedAt !== null ? `Uten nett · lagret ${esc(fmtTime(new Date(savedAt).toISOString()))} · ` : ''}`
    + `Varsel fra <a href="${yr}" target="_blank" rel="noopener">MET Norway / yr</a> (CC BY 4.0), oppdatert ${esc(fmtTime(new Date(w.updated).toISOString()))}`
    + `${w.altitude != null ? ` · temperatur for ${w.altitude} moh.` : ''}. Regn/snø og nysnø er beregnet her.</p>`;
  if (typeof win === 'string') return `<div class="wxcard">${head}<p class="rsub">${win}</p>${foot}</div>`;

  const s = summarize(w.steps, win.from, win.to);
  if (!s) return `<div class="wxcard">${head}<p class="rsub">Ingen varseldata for perioden.</p>${foot}</div>`;
  const temp = Math.round(s.tempMin) === Math.round(s.tempMax) ? deg(s.tempMin) : `${deg(s.tempMin)} til ${deg(s.tempMax)}`;
  const wind = `${Math.round(s.windMax)} m/s fra ${dirName(s.windFrom)}${s.gustMax != null ? `, kast ${Math.round(s.gustMax)}` : ''}`;
  const sky = skyText(s.cloudAvg, s.fogMax);
  const fog = s.fogMax != null && s.fogMax >= 20 && sky !== 'tåke' ? ` · tåke ${Math.round(s.fogMax)} %` : '';

  return `<div class="wxcard">${head}
    <div class="rsub">${esc(win.label)}${s.partial ? ' · varselet slutter før perioden er over' : ''}</div>
    <dl class="wx">
      <dt>Himmel</dt><dd>${esc(sky)} · ${cloudLine(s)}${fog}</dd>
      <dt>Nedbør</dt><dd>${esc(precipLine(s))}${s.precipProb != null && s.precip >= 0.1 ? ` · ${Math.round(s.precipProb)} % sjanse` : ''}</dd>
      <dt>Temperatur</dt><dd>${temp}</dd>
      <dt>Vind</dt><dd>${wind}</dd>
    </dl>
    ${timeline(w, win.from, win.to)}
    ${foot}</div>`;
}

/** The "Vær" tab: the picked point and its forecast. */
export function renderWeather(): void {
  $('weather').innerHTML = state.picked
    ? pointLine() + pointWeather()
    : '<p class="empty">Trykk på et sted i kartet for å se værvarselet der.</p>';
}
