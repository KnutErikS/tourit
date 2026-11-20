/**
 * Kartlag tab: the explanation under each layer folds away behind an ⓘ button
 * in the layer's heading, so the toggles, settings and legends stay in view.
 * Each layer opens on its own; nothing is remembered between visits.
 */

const ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></svg>';

export function initLayerInfo(): void {
  document.querySelectorAll<HTMLElement>('#tab-layers section.layer').forEach((sec, i) => {
    const descs = [...sec.querySelectorAll<HTMLElement>('p.desc')];
    const head = sec.querySelector('.lhead');
    if (!descs.length || !head) return;
    const name = head.querySelector('label')?.textContent?.trim() ?? 'laget';
    descs.forEach((d, k) => (d.id ||= `ldesc-${i}-${k}`));
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'info-btn sm ldesc-btn';
    btn.innerHTML = ICON;
    btn.setAttribute('aria-controls', descs.map((d) => d.id).join(' '));
    const set = (open: boolean) => {
      sec.classList.toggle('show-desc', open);
      btn.setAttribute('aria-expanded', String(open));
      const label = `${open ? 'Skjul' : 'Vis'} forklaring for ${name}`;
      btn.setAttribute('aria-label', label);
      btn.title = label;
    };
    btn.addEventListener('click', () => set(!sec.classList.contains('show-desc')));
    set(false);
    head.appendChild(btn);
  });
}
