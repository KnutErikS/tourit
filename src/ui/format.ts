import { DIRS } from '../config';
import { isoDate } from '../util';

/**
 * Small Norwegian formatting helpers shared by the panels (Vær, Surf, Klatring):
 * numbers with a decimal comma, compass names, wind arrows, dates and times.
 */

/** Compass name of a direction in degrees ("SV"), any angle. */
export const dirName = (deg: number) => DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** One decimal under 10 ("4,5"), whole numbers above ("12"). */
export const r1 = (x: number) => (x < 10 ? x.toFixed(1).replace('.', ',') : String(Math.round(x)));

/** Whole degrees with a real minus sign: "−3°". */
export const deg = (t: number) => `${Math.round(t)}°`.replace('-', '−');

/** "1,2 km" under 10 km, "34 km" above, from metres. */
export function km(m: number): string {
  const k = m / 1000;
  return `${k < 10 ? k.toFixed(1).replace('.', ',') : Math.round(k)} km`;
}

/** An arrow pointing the way the wind (or swell) moves, given where it comes from (degrees). */
export const arrow = (from: number) => `<i class="wx-arrow" style="transform:rotate(${Math.round(from)}deg)" aria-hidden="true">↓</i>`;

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "14" (the hour). */
export const hh = (ms: number) => new Date(ms).toLocaleTimeString('nb-NO', { hour: '2-digit' });

/** "tor. 26. nov." */
export const shortDate = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' });

/** "tor" */
export const weekday = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('nb-NO', { weekday: 'short' }).replace('.', '');

/** The calendar day `n` days after `iso` (noon-based, so DST changes don't matter). */
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

/** Today's local date, YYYY-MM-DD (worked out when asked: the app may stay open past midnight). */
export const todayIso = () => isoDate(new Date());
