/**
 * iPhone Home Screen app (black-translucent status bar): iOS reports a viewport that
 * is shorter than the screen, so a band at the bottom stays empty (it shows the dark
 * page background). When the app fills the screen's width but not its height, size
 * the page to the whole screen instead (--app-h, used by html/body in app.css).
 *
 * On a cold launch iOS can run this before the window has its final size (width and
 * height still 0, or about to change) and then settle without firing `resize`. So the
 * check runs again on every event that can follow a size change, and a few times
 * during the first seconds. The map follows the page's size by itself (map.ts).
 *
 * Imported for its side effect before the map is created, so Leaflet measures the
 * right size from the start when it can.
 */
const nav = navigator as Navigator & { standalone?: boolean };

function portrait(): boolean {
  const w = window.innerWidth, h = window.innerHeight;
  if (w && h) return h >= w;
  return window.matchMedia('(orientation: portrait)').matches;
}

function fit(): void {
  const vw = window.innerWidth;
  // Not laid out yet: keep what we have and wait for the next check.
  if (!vw) return;
  // innerHeight and the layout viewport (the root's clientHeight) don't always agree on
  // iOS; the shorter one is what leaves the gap.
  const vh = Math.min(window.innerHeight || Infinity, document.documentElement.clientHeight || Infinity);
  const long = Math.max(screen.width, screen.height);
  const short = Math.min(screen.width, screen.height);
  const up = portrait();
  const w = up ? short : long;
  const h = up ? long : short;
  // Full-width window only: an iPad app in Split View or Stage Manager is not the whole screen.
  const full = Math.abs(vw - w) < 2 && vh < h;
  const want = full ? `${h}px` : '';
  const root = document.documentElement.style;
  if (root.getPropertyValue('--app-h') !== want) root.setProperty('--app-h', want);
}

if (nav.standalone) {
  fit();
  for (const ev of ['resize', 'orientationchange', 'pageshow', 'load']) window.addEventListener(ev, fit);
  window.visualViewport?.addEventListener('resize', fit);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && fit());
  // The launch can settle without any of the events above.
  requestAnimationFrame(fit);
  for (const ms of [100, 300, 700, 1500, 3000]) setTimeout(fit, ms);
}
