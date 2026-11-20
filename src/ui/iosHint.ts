import { $ } from '../util';

/**
 * iPhone/iPad in the browser (not the Home Screen app): Safari may clear a
 * site's stored data when it hasn't been used for a while, and the Home Screen
 * app has storage of its own. So saved areas belong in the Home Screen app,
 * and we say so before an area is saved here.
 */

/** iOS or iPadOS (iPads report themselves as a Mac, but with touch). `?ios` forces it in dev, for testing. */
function isIos(): boolean {
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('ios')) return true;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
}

/** True on iPhone/iPad when the app runs in the browser instead of from the Home Screen. */
export const iosBrowser = (): boolean => isIos() && !isStandalone();

/**
 * Before saving an area on iPhone/iPad in the browser: explain, and let the
 * user go on anyway. Elsewhere `proceed` runs straight away.
 */
export function confirmIosSave(proceed: () => void): void {
  if (!iosBrowser()) return proceed();
  const dlg = $<HTMLDialogElement>('ios-save');
  const anyway = $('ios-save-anyway'), ok = $('ios-save-ok');
  const done = (go: boolean) => {
    anyway.removeEventListener('click', onAnyway);
    ok.removeEventListener('click', onOk);
    dlg.removeEventListener('cancel', onOk);
    dlg.close();
    if (go) proceed();
  };
  const onAnyway = () => done(true);
  const onOk = () => done(false);
  anyway.addEventListener('click', onAnyway);
  ok.addEventListener('click', onOk);
  dlg.addEventListener('cancel', onOk); // Esc
  dlg.showModal();
}
