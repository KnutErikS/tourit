import type { RGB } from '../config';
import { problemKind } from '../domain/problems';
import type { NveProblemRaw } from '../types';
import { esc } from '../util';

/**
 * Aspect rose. `color` is either one colour for the exposed sectors (with `exp`
 * saying which), or an array of 8 RGB colours for a legend.
 */
export function roseSVG(exp: boolean[] | null, color: string | RGB[], size = 56): string {
  const c = size / 2, R = c - 2, r0 = R * 0.28;
  let s = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Utsatte himmelretninger">`;
  for (let k = 0; k < 8; k++) {
    const a0 = ((k * 45 - 22.5 - 90) * Math.PI) / 180, a1 = ((k * 45 + 22.5 - 90) * Math.PI) / 180;
    const P = (rad: number, a: number) => `${(c + rad * Math.cos(a)).toFixed(2)},${(c + rad * Math.sin(a)).toFixed(2)}`;
    const fill = Array.isArray(color) ? `rgb(${color[k].join(',')})` : exp && exp[k] ? color : 'var(--chip)';
    s += `<path d="M${P(r0, a0)} L${P(R, a0)} A${R},${R} 0 0 1 ${P(R, a1)} L${P(r0, a1)} A${r0},${r0} 0 0 0 ${P(r0, a0)}Z" style="fill:${fill};stroke:var(--line);stroke-width:1"/>`;
  }
  s += `<text x="${c}" y="9" text-anchor="middle" font-size="8" font-family="IBM Plex Mono, monospace" style="fill:var(--fg)">N</text></svg>`;
  return s;
}

let clipSeq = 0;

/** Mountain silhouette with the exposed height band coloured. */
export function heightSVG(p: NveProblemRaw, color: string): string {
  const fill = Number(p.ExposedHeightFill), W = 54, H = 46, base = 42, top = 4;
  const yAt = (t: number) => base - (base - top) * t; // t = share of mountain height
  const one = yAt(0.5), lo = yAt(0.33), hi = yAt(0.66);
  let bands: [number, number][];
  switch (fill) {
    case 1: bands = [[top, one]]; break;
    case 2: bands = [[one, base]]; break;
    case 3: bands = [[top, hi], [lo, base]]; break;
    case 4: bands = [[hi, lo]]; break;
    default: bands = [[top, base]];
  }
  const id = `mclip${++clipSeq}`;
  const mtn = `M2,${base} L27,${top} L52,${base} Z`;
  let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><defs><clipPath id="${id}"><path d="${mtn}"/></clipPath></defs>`;
  s += `<path d="${mtn}" style="fill:var(--chip);stroke:var(--line)"/>`;
  s += `<g clip-path="url(#${id})">` + bands.map(([y0, y1]) => `<rect x="0" y="${y0}" width="${W}" height="${y1 - y0}" style="fill:${color}"/>`).join('') + '</g>';
  s += `<path d="${mtn}" style="fill:none;stroke:var(--fg);stroke-width:1.2;stroke-linejoin:round"/></svg>`;
  return s;
}

/** Avalanche problem pictogram (own drawings in the style of the EAWS icons). */
export function problemIcon(p: NveProblemRaw, color: string): string {
  const { k, loose } = problemKind(p);
  const slope = 'M4,60 L60,60 L60,14 Z';
  const ink = 'var(--fg)';
  let g = `<path d="${slope}" style="fill:var(--panel);stroke:${ink};stroke-width:2;stroke-linejoin:round"/>`;
  // snow cover along the slope
  const snow = (off: number, w: number, stroke = ink) =>
    `<path d="M${4 + off * 0.8},${60 - off} L60,${14 - off * 0.3}" style="fill:none;stroke:${stroke};stroke-width:${w};stroke-linecap:round"/>`;
  // released slab, or loose-snow teardrop
  const release = loose
    ? `<path d="M44,24 C40,30 36,36 30,44 C27,48 31,52 35,49 C40,44 44,34 44,24 Z" style="fill:${color};stroke:${ink};stroke-width:1.5"/>`
    : `<path d="M30,38 L50,24 L53,28 L33,42 Z" style="fill:${color};stroke:${ink};stroke-width:1.5;stroke-linejoin:round"/>`;

  if (k === 'new') {
    g += snow(4, 3) + release;
    const flake = (cx: number, cy: number, r: number) =>
      [0, 60, 120]
        .map((a) => {
          const x = r * Math.cos((a * Math.PI) / 180), y = r * Math.sin((a * Math.PI) / 180);
          return `<line x1="${cx - x}" y1="${cy - y}" x2="${cx + x}" y2="${cy + y}" style="stroke:${ink};stroke-width:1.8;stroke-linecap:round"/>`;
        })
        .join('');
    g += flake(14, 14, 7) + flake(28, 8, 4.5);
  } else if (k === 'wind') {
    g += snow(4, 3);
    g += `<path d="M60,10 C66,10 64,18 58,16" style="fill:${color};stroke:${ink};stroke-width:1.5"/>`;
    g += release;
    g += [12, 20, 28]
      .map((y, i) => `<path d="M4,${y} C14,${y - 4} 20,${y + 4} ${30 - i * 4},${y}" style="fill:none;stroke:${ink};stroke-width:2;stroke-linecap:round"/>`)
      .join('');
  } else if (k === 'pwl') {
    g += snow(4, 2.5) + snow(9, 2.5);
    g += `<path d="M${4 + 6.5 * 0.8},${60 - 6.5} L60,${14 - 6.5 * 0.3}" style="fill:none;stroke:var(--d4);stroke-width:2.2;stroke-dasharray:3 3"/>`;
    g += release;
    g +=
      `<rect x="8" y="10" width="18" height="12" rx="2" style="fill:var(--chip);stroke:${ink};stroke-width:1.2"/>` +
      [13, 16, 19]
        .map((y, i) => `<line x1="10" y1="${y}" x2="24" y2="${y}" style="stroke:${i === 2 ? 'var(--d4)' : ink};stroke-width:1.4;${i === 2 ? 'stroke-dasharray:2 2' : ''}"/>`)
        .join('');
  } else if (k === 'wet') {
    g += snow(4, 3) + release;
    g += `<path d="M17,8 C21,15 24,18 24,22 A7,7 0 0 1 10,22 C10,18 13,15 17,8 Z" style="fill:#3b82c4;stroke:${ink};stroke-width:1.5"/>`;
  } else if (k === 'glide') {
    // thick snowpack that has slid apart: open glide crack down to the ground
    g += `<path d="M8,55 L30,39" style="fill:none;stroke:${ink};stroke-width:6;stroke-linecap:butt"/>`;
    g += `<path d="M37,34 L60,18" style="fill:none;stroke:${ink};stroke-width:6;stroke-linecap:butt"/>`;
    g += `<path d="M30,39 L37,34 L37,30 L30,35 Z" style="fill:${color};stroke:${ink};stroke-width:1.2"/>`;
    g += `<path d="M14,22 C20,18 22,26 28,22" style="fill:none;stroke:${ink};stroke-width:1.8;stroke-linecap:round"/>`;
    g += `<path d="M24,18 l4,4 l-4,3" style="fill:none;stroke:${ink};stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round"/>`;
  } else {
    g += snow(4, 3) + release;
  }
  return `<svg viewBox="0 0 64 64" role="img" aria-label="${esc(p.AvalancheProblemTypeName || 'Skredproblem')}">${g}</svg>`;
}
