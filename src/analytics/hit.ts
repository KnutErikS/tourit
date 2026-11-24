/**
 * Builds the GoatCounter request for one page view or event. Pure (no browser
 * globals), so the tests can check exactly what leaves the device.
 *
 * Only these go out: the page path (never the #hash, which holds the map view
 * and the picked point), the event name, the referring site's origin and the
 * screen width. GoatCounter adds the browser and the country from the request
 * itself. No coordinates, no IDs, no cookies.
 */

export interface Hit {
  /** Page path (`location.pathname`) or, for an event, the event name. */
  path: string;
  title?: string;
  event?: boolean;
  /** `document.referrer`; only its origin is sent, and nothing from this site itself. */
  referrer?: string;
  screenWidth?: number;
}

/** `https://<code>.goatcounter.com/count`, or '' when the code is empty (counting off). */
export function endpointFor(code: string): string {
  return /^[a-z0-9-]+$/.test(code) ? `https://${code}.goatcounter.com/count` : '';
}

/** Origin of an outside referrer, or '' (none, unparsable, or this site). */
export function referrerOrigin(referrer: string | undefined, ownOrigin: string): string {
  if (!referrer) return '';
  try {
    const o = new URL(referrer).origin;
    return o === 'null' || o === ownOrigin ? '' : o;
  } catch {
    return '';
  }
}

export function hitUrl(endpoint: string, hit: Hit, ownOrigin: string, rnd: string): string {
  const q = new URLSearchParams();
  q.set('p', hit.path.split('#')[0].split('?')[0] || '/');
  if (hit.title) q.set('t', hit.title);
  if (hit.event) q.set('e', 'true');
  const r = referrerOrigin(hit.referrer, ownOrigin);
  if (r) q.set('r', r);
  if (hit.screenWidth) q.set('s', String(Math.round(hit.screenWidth)));
  q.set('rnd', rnd); // keeps caches from swallowing repeat hits
  return `${endpoint}?${q}`;
}
