import { $ } from '../util';

/**
 * "Ny versjon – last inn på nytt".
 *
 * The service worker (public/sw.js) takes over as soon as a new version is
 * installed and deletes the old version's stored files. A page that is still
 * running the old code (a tab or Home Screen app left open for days) can then
 * no longer load its lazy parts, such as the 3D view. So when a new worker
 * takes control of a page that already had one, we offer a reload.
 *
 * Browsers only look for a new sw.js on navigation, so an app that stays open
 * also checks when it comes back to the foreground and every half hour.
 */

const CHECK_EVERY_MS = 30 * 60_000;

function show(): void {
  $('update').hidden = false;
}

export function watchForUpdates(reg: ServiceWorkerRegistration): void {
  const sw = navigator.serviceWorker;
  // No controller yet = first visit: the worker that takes over is not an update.
  let hadController = !!sw.controller;
  sw.addEventListener('controllerchange', () => {
    if (hadController) show();
    hadController = true;
  });

  const check = () => {
    if (document.visibilityState === 'visible' && navigator.onLine) reg.update().catch(() => {});
  };
  document.addEventListener('visibilitychange', check);
  setInterval(check, CHECK_EVERY_MS);

  $('update-reload').addEventListener('click', () => location.reload());
  $('update-close').addEventListener('click', () => ($('update').hidden = true));
}
