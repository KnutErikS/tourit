import { endpointFor, hitUrl } from './hit';

/**
 * Anonymous usage counting with GoatCounter (no cookies, nothing stored on the
 * device). Set the account code in vite.config.ts (GOATCOUNTER_CODE); while it
 * is empty nothing is sent and the CSP doesn't allow the host either.
 *
 * Not counted: the dev server, localhost, automated browsers, and anything
 * while offline (the request would just fail; the app works the same).
 *
 * A visit is one page load, or coming back to the app after it has been in the
 * background for VISIT_GAP_MS (the PWA on a phone stays open for days). Each
 * event counts at most once per visit, so the numbers read as "visits that
 * used X", not "how many taps".
 */

/** Feature events, as they show up in GoatCounter's dashboard. */
export const EVENTS = {
  'tab-warn': 'Fane: Skredvarsel',
  'tab-wx': 'Fane: Vær',
  'tab-tools': 'Fane: Verktøy',
  'tab-surf': 'Fane: Surf',
  'sport-surf': 'Sport: Surf valgt',
  'surf-marker': 'Surf: spot trykket i kartet',
  'surf-list': 'Surf: spot åpnet i lista',
  'surf-show-map': 'Surf: Vis i kartet',
  'surf-weather': 'Surf: Vær her',
  'surf-day': 'Surf: annen dag valgt',
  'surf-sort-near': 'Surf: sortert etter nærmest',
  'surf-sort-coast': 'Surf: sortert etter kyst',
  'layer-bratt': 'Lag: Bratthet',
  'layer-runout': 'Lag: Utløp',
  'layer-snow': 'Lag: Snø (seNorge)',
  'layer-asp': 'Lag: Himmelretning',
  'layer-obs': 'Lag: Observasjoner',
  'layer-cam': 'Lag: Webkamera',
  'point-pick': 'Valgt punkt i kartet',
  'alptruth-tick': 'ALPTRUTh: egen avkrysning',
  '3d-open': '3D-kart åpnet',
  'route-open': 'Tegn rute åpnet',
  'route-show': 'Lagret rute vist på kartet',
  'gpx-import': 'GPX importert',
  'gpx-export': 'GPX lastet ned',
  'area-save': 'Område lagret for bruk uten nett',
  search: 'Stedssøk brukt',
  share: 'Del-knappen',
  locate: 'Min posisjon slått på',
  'date-tomorrow': 'Varsel for i morgen',
  'date-demo': 'Vis 14. mars 2026',
  standalone: 'Åpnet som app (Hjem-skjerm)',
  'shared-link': 'Åpnet delt lenke med punkt',
  // A source failed, or was so slow that a stored copy was shown. Only counted
  // online (see enabled()), so these mean the service, not the user's signal.
  'fail-nve': 'Feil: NVE (varsel/regioner)',
  'fail-regobs': 'Feil: Regobs',
  'fail-met': 'Feil: MET (punktvær)',
  'fail-openmeteo': 'Feil: Open-Meteo',
  'fail-dem': 'Feil: Kartverket høydedata',
  'fail-vegvesen': 'Feil: Vegvesen (webkamera)',
  'fail-marine': 'Feil: Open-Meteo Marine (bølger)',
} as const;
export type EventName = keyof typeof EVENTS;

const VISIT_GAP_MS = 30 * 60_000;

const ENDPOINT = endpointFor(__GOATCOUNTER__);
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|.*\.localhost|.*\.test)$/;

/** Event paths sent this visit (EventName, or `surf-spot/<id>`). */
let sentThisVisit = new Set<string>();
let hiddenAt: number | null = null;

function enabled(): boolean {
  return !!ENDPOINT && !import.meta.env.DEV && !LOCAL_HOST.test(location.hostname) && !navigator.webdriver && navigator.onLine;
}

function send(url: string): void {
  try {
    if (navigator.sendBeacon?.(url)) return;
    void fetch(url, { method: 'POST', mode: 'no-cors', keepalive: true, credentials: 'omit' }).catch(() => {});
  } catch {
    /* counting must never break the app */
  }
}

const rnd = () => Math.random().toString(36).slice(2, 10);

function countVisit(withReferrer: boolean): void {
  if (!enabled()) return;
  send(
    hitUrl(
      ENDPOINT,
      { path: location.pathname, title: document.title, referrer: withReferrer ? document.referrer : '', screenWidth: screen.width },
      location.origin,
      rnd(),
    ),
  );
  if (matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone) count('standalone');
}

function event(path: string, title: string): void {
  if (sentThisVisit.has(path)) return;
  sentThisVisit.add(path);
  if (!enabled()) return;
  send(hitUrl(ENDPOINT, { path, title, event: true }, location.origin, rnd()));
}

/** A feature was used: counted once per visit. */
export function count(name: EventName): void {
  event(name, EVENTS[name]);
}

/**
 * A surf spot was looked at (marker tapped, or opened in the list): one row per
 * spot in the dashboard, once per visit. Spots are fixed public places from
 * domain/surfSpots.ts, so this says which spots are popular, not where anyone is.
 */
export function countSpot(spot: { id: string; name: string }): void {
  event(`surf-spot/${spot.id}`, `Spot: ${spot.name}`);
}

/** True when this build counts visits (the About dialog says so then). */
export const COUNTING = !!ENDPOINT;

/** Count this page load, and later returns to the app after a long pause. */
export function initCounting(): void {
  if (!ENDPOINT) return;
  countVisit(true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') return void (hiddenAt = Date.now());
    if (hiddenAt !== null && Date.now() - hiddenAt > VISIT_GAP_MS) {
      sentThisVisit = new Set(); // a new visit: its events count again
      countVisit(false);
    }
    hiddenAt = null;
  });
}
