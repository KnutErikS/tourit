/**
 * iPhone Home Screen app (black-translucent status bar): iOS reports a viewport that
 * is shorter than the screen, so a band at the bottom stays empty (it shows the dark
 * page background). When the app fills the screen's width but not its height, size
 * the page to the whole screen instead (--app-h, used by html/body in app.css).
 *
 * Imported for its side effect before the map is created, so Leaflet measures the
 * right size from the start.
 */
const nav = navigator as Navigator & { standalone?: boolean };

function fit(): void {
  const portrait = window.innerHeight >= window.innerWidth;
  const long = Math.max(screen.width, screen.height);
  const short = Math.min(screen.width, screen.height);
  const w = portrait ? short : long;
  const h = portrait ? long : short;
  // Full-width window only: an iPad app in Split View or Stage Manager is not the whole screen.
  const full = Math.abs(window.innerWidth - w) < 2 && window.innerHeight < h;
  document.documentElement.style.setProperty('--app-h', full ? `${h}px` : '');
}

if (nav.standalone) {
  fit();
  // Runs before Leaflet's own resize handler (which waits a frame), so the map picks up the new size.
  window.addEventListener('resize', fit);
}
