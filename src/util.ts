export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing from index.html`);
  return el as T;
};

/** HTML-escape for interpolating API text into template strings. */
export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

/** Trimmed text, or '' for empty / NVE's "Ikke gitt" placeholder. */
export const txt = (s: unknown): string => {
  const t = String(s ?? '').trim();
  return t && !/^ikke gitt\.?$/i.test(t) ? t : '';
};

/** Local date as YYYY-MM-DD. */
export const isoDate = (d: Date): string =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export const fmtDate = (s: string): string =>
  new Date(s + 'T12:00:00').toLocaleDateString('nb-NO', {
    weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
  });

export const fmtTime = (s?: string): string =>
  s ? new Date(s).toLocaleString('nb-NO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { Accept: 'application/json', ...init?.headers } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}
