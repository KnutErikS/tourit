import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endpointFor, hitUrl, referrerOrigin } from '../src/analytics/hit.ts';

const OWN = 'https://knuteriks.github.io';
const EP = 'https://tourit.goatcounter.com/count';

test('no code, or a code that is not a plain subdomain, turns counting off', () => {
  assert.equal(endpointFor(''), '');
  assert.equal(endpointFor('evil.com/x'), '');
  assert.equal(endpointFor('tourit'), EP);
});

test('page view sends the path only: never the #hash with the map view or picked point', () => {
  const url = new URL(hitUrl(EP, { path: '/tourit/#12/69.65/18.95/@69.6,18.9', title: 'Skredterreng', screenWidth: 390 }, OWN, 'x'));
  assert.equal(url.origin + url.pathname, EP);
  assert.deepEqual(Object.fromEntries(url.searchParams), { p: '/tourit/', t: 'Skredterreng', s: '390', rnd: 'x' });
  assert.doesNotMatch(url.href, /69\.6|18\.9/);
});

test('events are marked as events', () => {
  const url = new URL(hitUrl(EP, { path: 'tab-tools', title: 'Fane: Verktøy', event: true }, OWN, 'x'));
  assert.equal(url.searchParams.get('p'), 'tab-tools');
  assert.equal(url.searchParams.get('e'), 'true');
});

test('referrer: only an outside origin, never its path or this site', () => {
  assert.equal(referrerOrigin('https://www.facebook.com/groups/topptur/posts/123?x=1', OWN), 'https://www.facebook.com');
  assert.equal(referrerOrigin(`${OWN}/tourit/#10/61/9`, OWN), '');
  assert.equal(referrerOrigin('', OWN), '');
  assert.equal(referrerOrigin('not a url', OWN), '');
});
