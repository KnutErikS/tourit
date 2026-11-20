import type { Critical, FirstFine, FirstThaw, RainAround, Refreeze } from './precip';
import type { SignGroup } from './signs';

/**
 * The infos ("Facts" on the Verktøy tab) and the chips on the selected point. The
 * weather rules are in domain/precip.ts; here each info becomes a row with a
 * state and the reasoning, hit or not:
 *   hit      it applies; with a level (warn / info / ok) and a chip
 *   no       checked, doesn't apply (the row says why)
 *   unknown  the data can't tell (the row says what is missing)
 * `infos` is the hits only, red flags first: the short list and the chips.
 *
 * The thresholds in the texts are the constants in domain/precip.ts
 * (test/infos.test.ts checks they agree). Pure: type imports only.
 */

export type InfoKey = 'critical' | 'rainOnSnow' | 'firstThaw' | 'firstFine' | 'refreeze' | 'poorTest';
export type InfoLevel = 'warn' | 'info' | 'ok';
export type InfoState = 'hit' | 'no' | 'unknown';

export interface Info {
  key: InfoKey;
  level: InfoLevel;
  /** A few words for the chip on the point. */
  chip: string;
  /** One or two sentences for the list. */
  text: string;
}

export interface InfoRow {
  key: InfoKey;
  /** The info's name. */
  name: string;
  state: InfoState;
  /** Why: the numbers behind it, hit or not. */
  text: string;
  /** For hits. */
  level?: InfoLevel;
  chip?: string;
}

/** The infos in the order shown, with what makes them hit (for the list of all infos). */
export const INFO_DEFS: { key: InfoKey; name: string; rule: string }[] = [
  { key: 'critical', name: 'Kritisk nysnømengde', rule: 'Nysnø siste 72 t når 70 % av kritisk mengde (10, 20 eller 30 cm etter vind, kulde og underlaget)' },
  { key: 'rainOnSnow', name: 'Regn på snø', rule: 'Minst 0,5 mm regn de 12 timene før eller etter, der seNorge viser snø' },
  { key: 'firstThaw', name: 'Første mildvær', rule: '0 °C i løpet av dagen etter minst 10 cm nysnø siste 48 t, første gang siden snøfallet' },
  { key: 'firstFine', name: 'Powder bluebird', rule: 'Første fine dag: under 30 % skydekke etter minst 20 cm nysnø siste 72 t, og dagen før var ikke fin' },
  { key: 'refreeze', name: 'Nattefrost', rule: 'Ingen eller svak nattefrost når det smelter (0 °C i dag eller i går); god nattefrost på en mild dag' },
  { key: 'poorTest', name: 'Dårlig test', rule: 'Stabilitetstest ECT klasse 1–2 meldt i Regobs i regionen siste 48 t' },
];

export interface InfoInput {
  /** seNorge at the point: snow on the ground, bare, or unknown. With 'bare', only Regobs infos apply. */
  cover: 'snow' | 'bare' | null;
  critical: Critical | null;
  /** Share of the critical amount where the info starts (CRIT_SHOW). */
  criticalShow: number;
  rain: RainAround | null;
  /** The rain window is around now (today), not 10:00 on another day. */
  rainNow: boolean;
  firstThaw: FirstThaw | null;
  firstFine: FirstFine | null;
  refreeze: { state: Refreeze; min: number; cloud: number | null } | null;
  /** The day reaches 0 °C: then a good refreeze is worth showing (an early window). */
  dayMild: boolean;
  /** The day or the day before reaches 0 °C: melt and refreeze matter at all. Not in a cold spell. */
  meltFreeze: boolean;
  /** Regobs, last 48 h, weighted for the point; null = no observations for the day. */
  poorTest: SignGroup | null;
}

const num = (x: number, d = 0) => x.toFixed(d).replace('.', ',').replace(/^-(?=[1-9]|0,[0-9]*[1-9])/, '−').replace(/^-/, '');
const reports = (n: number) => (n === 1 ? '1 melding' : `${n} meldinger`);
const CLS_TEXT = { favourable: 'gunstige forhold', average: 'middels forhold', unfavourable: 'ugunstige forhold' } as const;
const ORDER: Record<InfoLevel, number> = { warn: 0, info: 1, ok: 2 };
const BARE = 'seNorge viser barmark her.';

type Body = Omit<InfoRow, 'key' | 'name'>;
const no = (text: string): Body => ({ state: 'no', text });
const unknown = (text: string): Body => ({ state: 'unknown', text });
const hit = (level: InfoLevel, chip: string, text: string): Body => ({ state: 'hit', level, chip, text });

function critical(i: InfoInput): Body {
  const c = i.critical;
  if (!c) return unknown('Mangler vær for de siste 72 timene.');
  if (i.cover === 'bare') return no(BARE);
  const pct = Math.round(c.ratio * 100);
  const why =
    `${num(c.cm)} cm nysnø siste 72 t, ${pct} % av ${c.range[0]} cm. ` +
    `Kritisk mengde er ${c.range[0]}–${c.range[1]} cm ved ${CLS_TEXT[c.cls]}${c.factors.length ? ` (${c.factors.join(', ')})` : ''}.`;
  if (c.ratio < i.criticalShow) return no(`${why} Vises fra ${Math.round(i.criticalShow * 100)} %.`);
  return hit(c.ratio >= 1 ? 'warn' : 'info', `Nysnø ${pct} % av kritisk`, `Kritisk nysnømengde: ${why}`);
}

function rainOnSnow(i: InfoInput): Body {
  const r = i.rain;
  if (!r) return unknown('Mangler vær rundt dagen.');
  if (i.cover === 'bare') return no(BARE);
  const [before, after] = i.rainNow ? ['siste 12 t', 'neste 12 t'] : ['natt til dagen', 'på dagen'];
  const amounts = `${num(r.before, 1)} mm ${before} og ${num(r.after, 1)} mm ${after}`;
  if (!r.on) return no(`Lite eller ikke regn: ${amounts}.`);
  return hit(
    'warn',
    'Regn på snø',
    `Regn på snø: ${amounts}${i.cover === null ? ' (snødekket er ukjent)' : ', der seNorge viser snø'}. Regn på tørr snø øker faren nesten med en gang.`,
  );
}

function firstThaw(i: InfoInput): Body {
  const t = i.firstThaw;
  if (!t) return unknown('Mangler vær for de siste 48 timene.');
  if (i.cover === 'bare') return no(BARE);
  const snow = `${num(t.cm)} cm nysnø siste 48 t`;
  switch (t.why) {
    case 'littleSnow': return no(`${snow}, under 10 cm.`);
    case 'noDay': return unknown(`${snow}, men mangler temperatur for dagen.`);
    case 'cold': return no(`${snow}, men dagen holder seg under 0 °C (maks ${num(t.maxTemp!)} °C).`);
    case 'mildBefore': return no(`${snow}, men det har vært mildt allerede siden snøfallet.`);
    default:
      return hit('warn', 'Første mildvær', `Første mildvær etter snøfall: ${snow}, og i løpet av dagen blir det ${num(t.maxTemp!)} °C. Den første mildværsdagen er den farligste for våte skred.`);
  }
}

function firstFine(i: InfoInput): Body {
  const f = i.firstFine;
  if (!f) return unknown('Mangler vær for de siste 72 timene.');
  if (i.cover === 'bare') return no(BARE);
  const snow = `${num(f.cm)} cm nysnø siste 72 t`;
  const sky = f.cloud != null ? `skydekke ${num(f.cloud)} %` : '';
  switch (f.why) {
    case 'littleSnow': return no(`${snow}, under 20 cm.`);
    case 'snowing': return no(`${snow}, men det snør i løpet av dagen.`);
    case 'noCloud': return unknown(`${snow}, men mangler skydekke for dagen.`);
    case 'cloudy': return no(`${snow}, men skyet (${sky}, under 30 % trengs).`);
    case 'notFirst': return no(`${snow} og ${sky}, men dagen før var også fin.`);
    default: return hit('warn', 'Powder bluebird', `Powder bluebird: første fine dag etter ${snow} (${sky}). SLF: særlig mange ulykker på slike dager.`);
  }
}

function refreeze(i: InfoInput): Body {
  const f = i.refreeze;
  if (!f) return unknown('Mangler vær for natta.');
  if (i.cover === 'bare') return no(BARE);
  const how = `laveste ${num(f.min)} °C${f.cloud != null ? `, skydekke ${num(f.cloud)} %` : ''}`;
  if (!i.meltFreeze) return no(`Under 0 °C i dag og i går, så smelting og frysing spiller ingen rolle (natta: ${how}).`);
  if (f.state === 'none') return hit('warn', 'Ingen nattefrost', `Ingen nattefrost i natt (${how}): fare for våte skred allerede fra morgenen.`);
  if (f.state === 'weak') return hit('info', 'Svak nattefrost', `Svak nattefrost i natt (${how}): skaren er tynn, og tidsvinduet om morgenen kort.`);
  if (!i.dayMild) return no(`God nattefrost i natt (${how}), og dagen blir ikke mild.`);
  return hit('ok', 'God nattefrost', `God nattefrost i natt (${how}): skare er trolig, så morgenen er tryggest før det blir mildt.`);
}

function regobs(g: SignGroup | null, what: string, chip: string, extra: string): Body {
  if (!g) return unknown('Har ikke Regobs-observasjoner for dagen.');
  if (!g.n) return no(`Ingen ${what} meldt i regionen siste 48 t.`);
  const far = g.on ? '' : ', langt fra din høyde eller himmelretning';
  return hit(g.on ? 'warn' : 'info', chip, `${what.charAt(0).toUpperCase()}${what.slice(1)}: ${reports(g.n)} i regionen siste 48 t${far}.${extra}`);
}

/** Every info with its state and reasoning, in INFO_DEFS order. */
export function infoRows(i: InfoInput): InfoRow[] {
  const body: Record<InfoKey, Body> = {
    critical: critical(i),
    rainOnSnow: rainOnSnow(i),
    firstThaw: firstThaw(i),
    firstFine: firstFine(i),
    refreeze: refreeze(i),
    poorTest: regobs(i.poorTest, 'dårlige stabilitetstester (ECT klasse 1–2)', 'Dårlig test', ''),
  };
  return INFO_DEFS.map((d) => ({ key: d.key, name: d.name, ...body[d.key] }));
}

/** The infos that hit, red flags first: the short list and the chips. */
export function hitsOf(rows: InfoRow[]): Info[] {
  return rows
    .filter((r) => r.state === 'hit')
    .map((r) => ({ key: r.key, level: r.level!, chip: r.chip!, text: r.text }))
    .sort((a, b) => ORDER[a.level] - ORDER[b.level]);
}

export const infos = (i: InfoInput): Info[] => hitsOf(infoRows(i));
