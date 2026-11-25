import { COUNTING } from '../analytics/count';
import { CONTACT_URL } from '../config';
import { $ } from '../util';

/**
 * "Om Skredterreng": disclaimer, how to reach the developer, and the build
 * number. Opens by itself the first time (and again if the disclaimer text
 * changes: bump SEEN_VERSION), then from the info button in the panel header
 * and the link in the footer.
 */

const SEEN_KEY = 'tourit.aboutSeen';
/** Bump when the disclaimer changes enough that everyone should read it again. */
const SEEN_VERSION = '1';

export const BUILD = __BUILD__;

function contactUrl(): string {
  const body = `\n\n---\nVersjon: ${BUILD}\nNettleser: ${navigator.userAgent}`;
  return `${CONTACT_URL}?body=${encodeURIComponent(body)}`;
}

export function openAbout(): void {
  const dlg = $<HTMLDialogElement>('about');
  if (!dlg.open) dlg.showModal();
}

export function initAbout(): void {
  const dlg = $<HTMLDialogElement>('about');
  $('about-build').textContent = BUILD;
  $('about-counting').hidden = !COUNTING;
  $<HTMLAnchorElement>('about-contact').href = contactUrl();
  $('about-btn').addEventListener('click', openAbout);
  for (const id of ['about-foot', 'about-foot-surf']) $(id).addEventListener('click', openAbout);
  $('about-ok').addEventListener('click', () => dlg.close());
  // Tap on the dimmed backdrop closes it too.
  dlg.addEventListener('click', (e) => e.target === dlg && dlg.close());
  dlg.addEventListener('close', () => {
    try {
      localStorage.setItem(SEEN_KEY, SEEN_VERSION);
    } catch {
      /* storage unavailable: it opens again next time, which is fine */
    }
  });

  let seen: string | null = null;
  try {
    seen = localStorage.getItem(SEEN_KEY);
  } catch {
    /* ignore */
  }
  if (seen !== SEEN_VERSION) openAbout();
}
