import * as L from 'leaflet';
import { map } from '../map';
import { clearCoord, coordSource, showCoord } from './coords';
import { setStatus } from './status';

/**
 * "Min posisjon": a button that shows your position as a blue dot with an
 * accuracy circle, and keeps the map centred on you until you drag the map.
 *
 * Button cycle: off → on + following → (drag map) on → tap: follow again → tap: off.
 * Tapping the dot picks that point, like tapping the map.
 */

const ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/></svg>';

const FOLLOW_ZOOM = 13;

let watchId: number | null = null;
let following = false;
let firstFix = false;
let marker: L.Marker | null = null;
let circle: L.Circle | null = null;
let button: HTMLAnchorElement | null = null;
let onPick: (ll: L.LatLng) => void = () => {};

function updateButton(): void {
  if (!button) return;
  const on = watchId !== null;
  button.classList.toggle('on', on);
  button.classList.toggle('follow', on && following);
  const label = !on ? 'Vis min posisjon' : following ? 'Skjul min posisjon' : 'Følg min posisjon';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(on));
}

function onPosition(p: GeolocationPosition): void {
  const ll = L.latLng(p.coords.latitude, p.coords.longitude);
  const acc = p.coords.accuracy;
  if (!marker) {
    marker = L.marker(ll, {
      icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }),
      zIndexOffset: 1000,
      title: 'Din posisjon',
      keyboard: false,
    }).addTo(map);
    marker.on('click', () => {
      if (!marker) return;
      const at = marker.getLatLng();
      onPick(at);
      showCoord('position', at.lat, at.lng, circle?.getRadius());
    });
    circle = L.circle(ll, { radius: acc, pane: 'regions', color: '#2a7de1', weight: 1, opacity: 0.6, fillColor: '#2a7de1', fillOpacity: 0.12, interactive: false }).addTo(map);
  } else {
    marker.setLatLng(ll);
    circle?.setLatLng(ll).setRadius(acc);
  }
  // Coordinate chip: show own position on the first fix, then keep it live
  // unless the user has picked another point since.
  if (firstFix || coordSource() === 'position') showCoord('position', ll.lat, ll.lng, acc);
  if (following) {
    if (firstFix) map.setView(ll, Math.max(map.getZoom(), FOLLOW_ZOOM));
    else map.panTo(ll);
  }
  firstFix = false;
}

function onError(e: GeolocationPositionError): void {
  const msg =
    e.code === e.PERMISSION_DENIED
      ? 'Appen har ikke tilgang til posisjonen din. Gi tilgang i nettleserens innstillinger for nettstedet.'
      : e.code === e.TIMEOUT
        ? 'Fant ikke posisjonen din i tide. Prøv igjen, gjerne utendørs.'
        : 'Posisjonen din er ikke tilgjengelig akkurat nå.';
  setStatus(msg, 'err');
  // Keep trying on timeouts / temporary failures; stop only when access is denied.
  if (e.code === e.PERMISSION_DENIED) stop();
}

function start(): void {
  if (!('geolocation' in navigator)) {
    setStatus('Denne nettleseren kan ikke vise posisjon.', 'err');
    return;
  }
  following = true;
  firstFix = true;
  watchId = navigator.geolocation.watchPosition(onPosition, onError, {
    enableHighAccuracy: true,
    maximumAge: 10_000,
    timeout: 30_000,
  });
  updateButton();
}

function stop(): void {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  following = false;
  marker?.remove();
  circle?.remove();
  marker = circle = null;
  clearCoord('position');
  updateButton();
}

function onButton(): void {
  if (watchId === null) return start();
  if (!following) {
    following = true;
    if (marker) map.setView(marker.getLatLng(), Math.max(map.getZoom(), FOLLOW_ZOOM));
    return updateButton();
  }
  stop();
}

const LocateControl = L.Control.extend({
  onAdd(): HTMLElement {
    const bar = L.DomUtil.create('div', 'leaflet-bar locctl');
    bar.innerHTML = `<a href="#" role="button">${ICON}</a>`;
    L.DomEvent.disableClickPropagation(bar);
    button = bar.querySelector('a');
    button!.addEventListener('click', (e) => {
      e.preventDefault();
      onButton();
    });
    updateButton();
    return bar;
  },
});

export function initLocate(pick: (ll: L.LatLng) => void): void {
  onPick = pick;
  new LocateControl({ position: 'topright' }).addTo(map);
  // Dragging the map yourself stops following (the dot stays).
  map.on('dragstart', () => {
    if (following) {
      following = false;
      updateButton();
    }
  });
}
