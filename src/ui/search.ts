import { type Place, searchPlaces } from '../api/stedsnavn';
import { $, esc } from '../util';

/**
 * Place search (mountains, peaks, valleys, towns …) in the panel header, as a
 * combobox with type-ahead. Choosing a hit calls `onSelect`.
 */

const DEBOUNCE_MS = 250;

let hits: Place[] = [];
let active = -1;
let timer = 0;
let pending: AbortController | null = null;

const input = () => $<HTMLInputElement>('search');
const list = () => $('search-results');

function close(): void {
  list().hidden = true;
  input().setAttribute('aria-expanded', 'false');
  input().removeAttribute('aria-activedescendant');
  active = -1;
}

function render(message?: string): void {
  const el = list();
  if (message) {
    el.innerHTML = `<li class="s-msg" role="presentation">${esc(message)}</li>`;
  } else {
    el.innerHTML = hits
      .map((h, i) => {
        const where = [h.type, h.municipality, h.county].filter(Boolean).map(esc).join(' · ');
        return `<li id="s-opt-${i}" role="option" aria-selected="${i === active}" data-i="${i}"><b>${esc(h.name)}</b><span>${where}</span></li>`;
      })
      .join('');
  }
  el.hidden = false;
  input().setAttribute('aria-expanded', 'true');
  if (active >= 0) {
    input().setAttribute('aria-activedescendant', `s-opt-${active}`);
    document.getElementById(`s-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
  } else input().removeAttribute('aria-activedescendant');
}

async function run(text: string): Promise<void> {
  pending?.abort();
  if (text.trim().length < 2) {
    hits = [];
    close();
    return;
  }
  const ctrl = new AbortController();
  pending = ctrl;
  render('Søker…');
  try {
    hits = await searchPlaces(text, ctrl.signal);
    if (ctrl.signal.aborted) return;
    active = hits.length ? 0 : -1;
    render(hits.length ? undefined : 'Ingen treff');
  } catch (e) {
    if (ctrl.signal.aborted) return;
    hits = [];
    render(`Søket feilet (${(e as Error).message})`);
  }
}

export function initSearch(onSelect: (p: Place) => void): void {
  const inp = input();
  const choose = (i: number) => {
    const h = hits[i];
    if (!h) return;
    inp.value = h.name;
    close();
    inp.blur(); // hides the keyboard on phones
    onSelect(h);
  };

  inp.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => void run(inp.value), DEBOUNCE_MS);
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!hits.length) return;
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!list().hidden && active >= 0) choose(active);
      else void run(inp.value);
    } else if (e.key === 'Escape') {
      close();
    }
  });
  inp.addEventListener('focus', () => {
    if (hits.length) render();
  });
  // pointerdown (not click) so the choice happens before the input loses focus.
  list().addEventListener('pointerdown', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-i]');
    if (!li) return;
    e.preventDefault();
    choose(Number(li.dataset.i));
  });
  document.addEventListener('pointerdown', (e) => {
    if (!(e.target as HTMLElement).closest('.search')) close();
  });
}
