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

/**
 * Is this page older than the worker that just took over? Opening the app
 * loads the page from the network (already the new version) while the browser
 * installs the new worker in the background, so a takeover alone says nothing.
 * The new worker stores its own build's files and deletes the old build's, so
 * if this page's script is still stored, the page is current.
 */
async function pageIsOutdated(): Promise<boolean> {
  const src = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src;
  if (!src || !('caches' in window)) return false;
  // The page switches to the new worker as soon as it starts activating, before
  // it has deleted the old build's files: wait until it's done.
  const w = navigator.serviceWorker.controller;
  if (w && w.state !== 'activated') {
    await new Promise<void>((resolve) => {
      const onState = () => {
        if (w.state !== 'activated' && w.state !== 'redundant') return;
        w.removeEventListener('statechange', onState);
        resolve();
      };
      w.addEventListener('statechange', onState);
    });
  }
  try {
    return !(await caches.match(src, { ignoreVary: true }));
  } catch {
    return false; // can't tell: don't bother the user
  }
}

export function watchForUpdates(reg: ServiceWorkerRegistration): void {
  const sw = navigator.serviceWorker;
  // No controller yet = first visit: the worker that takes over is not an update.
  let hadController = !!sw.controller;
  sw.addEventListener('controllerchange', () => {
    if (hadController) void pageIsOutdated().then((old) => old && show());
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
