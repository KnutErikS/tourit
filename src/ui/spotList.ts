import * as L from 'leaflet';
import { state } from '../state';
import { esc } from '../util';
import { addDays, shortDate, todayIso, weekday } from './format';
import { currentPosition, onPositionChange } from './locate';

/**
 * What the Surf and Klatring lists have in common: the time they rate, the
 * 0–5 badge, the strip of the next days, and "Nærmest deg" (your position).
 * Each list keeps its own data, texts and rating (ui/surf.ts, ui/climb.ts).
 */

const HOUR = 3_600_000;

/** The time a list rates: now when the chosen date is today, 12:00 on a later day, null for a past day. */
export function shownTime(): { t: number; label: string } | null {
  const date = state.date || todayIso();
  if (date < todayIso()) return null;
  if (date === todayIso()) return { t: Date.now(), label: 'nå' };
  return { t: new Date(date + 'T00:00:00').getTime() + 12 * HOUR, label: `${shortDate(date)} kl. 12` };
}

/** The chosen date, or today when it is in the past (tables only look ahead). */
export const tableDate = () => (state.date && state.date >= todayIso() ? state.date : todayIso());

/** The 0–5 badge, or a dashed "–" without a rating. */
export function scoreBadge(score: number | null, title: string, cls = 'sp-badge'): string {
  return score != null
    ? `<span class="${cls} sc${score}" title="${esc(title)}">${score}</span>`
    : `<span class="${cls} sc-1" title="${esc(title)}">–</span>`;
}

export interface DayCell {
  score: number | null;
  /** "tor. 26. nov.: Bra, ca. 1,2 m kl. 14" */
  title: string;
}

/**
 * The next `n` days from today, one coloured cell each: buttons that pick the day
 * (in the list) or plain cells (in a map popup). `cell` gives each day's best.
 */
export function dayStrip(n: number, cell: (iso: string) => DayCell, pick: boolean, label: string): string {
  const first = todayIso(), sel = state.date || first;
  const cells: string[] = [];
  for (let i = 0; i < n; i++) {
    const iso = addDays(first, i);
    const { score, title } = cell(iso);
    const cls = `sp-day sc${score ?? -1}${iso === sel ? ' sel' : ''}`;
    cells.push(pick
      ? `<button type="button" class="${cls}" data-date="${iso}" title="${esc(title)}" aria-label="${esc(title)}" aria-pressed="${iso === sel}">${esc(weekday(iso))}</button>`
      : `<span class="${cls}" title="${esc(title)}" aria-label="${esc(title)}">${esc(weekday(iso))}</span>`);
  }
  return `<div class="sp-days" role="group" aria-label="${esc(label)}">${cells.join('')}</div>`;
}

/** Moving less than this doesn't redraw a list sorted by distance, m. */
const REDRAW_M = 500;

/**
 * Your position for "Nærmest deg": the map's position dot when it is on, else a
 * one-off fix asked for when the list is sorted by distance. Follows the dot,
 * and redraws the list once you've moved REDRAW_M.
 */
export class Nearby {
  here: L.LatLng | null = null;
  locating = false;
  private error = '';
  private drawnFrom: L.LatLng | null = null;
  private readonly redraw: () => void;
  /** How the list is ordered without a position, for the error texts ("listen følger kartet"). */
  private readonly fallback: string;

  constructor(redraw: () => void, fallback: string, isShown: () => boolean) {
    this.redraw = redraw;
    this.fallback = fallback;
    onPositionChange((pos) => {
      if (!pos) return;
      this.here = pos.ll;
      if (isShown() && (!this.drawnFrom || this.drawnFrom.distanceTo(this.here) > REDRAW_M)) redraw();
    });
  }

  /** Make sure there is a position, or one on its way (call when sorting by distance). */
  locate(): void {
    const pos = currentPosition();
    if (pos) {
      this.here = pos.ll;
      return;
    }
    // After a failure, ask again only when "Nærmest deg" is picked again (retry), not on every redraw.
    if (this.here || this.locating || this.error) return;
    if (!('geolocation' in navigator)) {
      this.error = `Denne nettleseren kan ikke vise posisjon, så ${this.fallback}.`;
      return;
    }
    this.locating = true;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        this.locating = false;
        this.here = L.latLng(p.coords.latitude, p.coords.longitude);
        this.redraw();
      },
      (e) => {
        this.locating = false;
        this.error = e.code === e.PERMISSION_DENIED
          ? `Appen har ikke tilgang til posisjonen din, så ${this.fallback}.`
          : `Fant ikke posisjonen din, så ${this.fallback}.`;
        this.redraw();
      },
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 20_000 },
    );
  }

  /** "Nærmest deg" was picked again: ask for the position again after a failure. */
  retry(): void {
    this.error = '';
  }

  /** The list was just drawn from `here`. */
  drawn(): void {
    this.drawnFrom = this.here;
  }

  /** Metres from your position, or null without one. */
  distanceTo(p: { lat: number; lng: number }): number | null {
    return this.here ? this.here.distanceTo([p.lat, p.lng]) : null;
  }

  /** "Finner posisjonen din…" or why there is none; '' otherwise. */
  note(): string {
    return this.locating ? 'Finner posisjonen din…' : this.error;
  }
}
