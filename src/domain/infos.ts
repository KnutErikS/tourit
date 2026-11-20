import type { Critical, RainAround, Refreeze } from './precip';
import type { SignGroup } from './signs';

/**
 * The infos on the Verktøy tab and as chips on the selected point: short
 * notes that only show when they apply. The weather rules are in
 * domain/precip.ts; here they become texts, with a level:
 *   warn  a known red flag
 *   info  worth knowing
 *   ok    good news worth acting on (a frozen crust on a mild day)
 *
 * Pure: type imports only.
 */

export type InfoKey = 'critical' | 'rainOnSnow' | 'firstThaw' | 'firstFine' | 'refreeze' | 'glide' | 'poorTest';
export type InfoLevel = 'warn' | 'info' | 'ok';

export interface Info {
  key: InfoKey;
  level: InfoLevel;
  /** A few words for the chip on the point. */
  chip: string;
  /** One or two sentences for the list. */
  text: string;
}

export interface InfoInput {
  /** seNorge at the point: snow on the ground, bare, or unknown. With 'bare', only Regobs infos show. */
  cover: 'snow' | 'bare' | null;
  critical: Critical | null;
  /** Share of the critical amount where the info starts (CRIT_SHOW). */
  criticalShow: number;
  rain: RainAround | null;
  /** The rain window is around now (today), not 10:00 on another day. */
  rainNow: boolean;
  firstThaw: { cm: number; maxTemp: number } | null;
  firstFine: { cm: number; cloud: number } | null;
  refreeze: { state: Refreeze; min: number; cloud: number | null } | null;
  /** The day reaches 0 °C: then a good refreeze is worth showing (an early window). */
  dayMild: boolean;
  /** The day or the day before reaches 0 °C: melt and refreeze matter at all. Not in a cold spell. */
  meltFreeze: boolean;
  /** Regobs, last 48 h, weighted for the point; null = no observations for the day. */
  glide: SignGroup | null;
  poorTest: SignGroup | null;
}

const num = (x: number, d = 0) => x.toFixed(d).replace('.', ',').replace(/^-(?=[1-9]|0,[0-9]*[1-9])/, '−').replace(/^-/, '');
const reports = (n: number) => (n === 1 ? '1 melding' : `${n} meldinger`);
const CLS_TEXT = { favourable: 'gunstige forhold', average: 'middels forhold', unfavourable: 'ugunstige forhold' } as const;
const ORDER: Record<InfoLevel, number> = { warn: 0, info: 1, ok: 2 };

export function infos(i: InfoInput): Info[] {
  const out: Info[] = [];
  const snow = i.cover !== 'bare';

  const c = i.critical;
  if (snow && c && c.ratio >= i.criticalShow) {
    const pct = Math.round(c.ratio * 100);
    out.push({
      key: 'critical',
      level: c.ratio >= 1 ? 'warn' : 'info',
      chip: `Nysnø ${pct} % av kritisk`,
      text:
        `Kritisk nysnømengde: ${num(c.cm)} cm nysnø siste 72 t, ${pct} % av ${c.range[0]} cm. ` +
        `Kritisk mengde er ${c.range[0]}–${c.range[1]} cm ved ${CLS_TEXT[c.cls]}${c.factors.length ? ` (${c.factors.join(', ')})` : ''}.`,
    });
  }

  const r = i.rain;
  if (snow && r?.on) {
    const [before, after] = i.rainNow ? ['siste 12 t', 'neste 12 t'] : ['natt til dagen', 'på dagen'];
    const parts = [r.before >= 0.05 ? `${num(r.before, 1)} mm ${before}` : '', r.after >= 0.05 ? `${num(r.after, 1)} mm ${after}` : ''].filter(Boolean);
    out.push({
      key: 'rainOnSnow',
      level: 'warn',
      chip: 'Regn på snø',
      text: `Regn på snø: ${parts.join(' og ')}${i.cover === null ? ' (snødekket er ukjent)' : ', der seNorge viser snø'}. Regn på tørr snø øker faren nesten med en gang.`,
    });
  }

  if (snow && i.firstThaw) {
    out.push({
      key: 'firstThaw',
      level: 'warn',
      chip: 'Første mildvær',
      text: `Første mildvær etter snøfall: ${num(i.firstThaw.cm)} cm nysnø siste 48 t, og i løpet av dagen blir det ${num(i.firstThaw.maxTemp)} °C. Den første mildværsdagen er den farligste for våte skred.`,
    });
  }

  if (snow && i.firstFine) {
    out.push({
      key: 'firstFine',
      level: 'warn',
      chip: 'Første fine dag',
      text: `Første fine dag etter ${num(i.firstFine.cm)} cm nysnø siste 72 t (skydekke ${num(i.firstFine.cloud)} %). SLF: særlig mange ulykker på slike dager.`,
    });
  }

  const f = i.refreeze;
  if (snow && f && i.meltFreeze) {
    const how = `laveste ${num(f.min)} °C${f.cloud != null ? `, skydekke ${num(f.cloud)} %` : ''}`;
    if (f.state === 'none')
      out.push({ key: 'refreeze', level: 'warn', chip: 'Ingen nattefrost', text: `Ingen nattefrost i natt (${how}): fare for våte skred allerede fra morgenen.` });
    else if (f.state === 'weak')
      out.push({ key: 'refreeze', level: 'info', chip: 'Svak nattefrost', text: `Svak nattefrost i natt (${how}): skaren er tynn, og tidsvinduet om morgenen kort.` });
    else if (i.dayMild)
      out.push({ key: 'refreeze', level: 'ok', chip: 'God nattefrost', text: `God nattefrost i natt (${how}): skare er trolig, så morgenen er tryggest før det blir mildt.` });
  }

  const g = i.glide;
  if (g?.n) {
    out.push({
      key: 'glide',
      level: g.on ? 'warn' : 'info',
      chip: 'Glidesprekker',
      text: `Ferske glidesprekker: ${reports(g.n)} i regionen siste 48 t${g.on ? '' : ', langt fra din høyde eller himmelretning'}. Hold deg unna området under dem.`,
    });
  }

  const t = i.poorTest;
  if (t?.n) {
    out.push({
      key: 'poorTest',
      level: t.on ? 'warn' : 'info',
      chip: 'Dårlig test',
      text: `Dårlige stabilitetstester (ECT klasse 1–2): ${reports(t.n)} i regionen siste 48 t${t.on ? '' : ', langt fra din høyde eller himmelretning'}.`,
    });
  }

  return out.sort((a, b) => ORDER[a.level] - ORDER[b.level]);
}
