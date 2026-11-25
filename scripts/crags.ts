/*
 * Builds public/data/crags.json: every climbing crag in Norway from
 * OpenStreetMap, already parsed, so the app loads one small file from its own
 * host instead of waiting for a nationwide Overpass query (often 20–60 s, and
 * the shared server is sometimes busy). Run by the deploy workflow before the
 * build, and weekly on a schedule so the list stays fresh.
 *
 *   node scripts/crags.ts [--out public/data/crags.json] [--fallback <url of the deployed crags.json>]
 *                         [--overpass <interpreter url>]   (default: overpass-api.de, then kumi.systems)
 *
 * When Overpass fails, --fallback downloads the snapshot that is live now, so a
 * busy Overpass doesn't drop the file from the next deploy. Exits 1 when there
 * is no good snapshot; the app then queries Overpass itself.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CRAG_QUERY, MIN_CRAGS, parseCrags, readSnapshot, type CragSnapshot, type OsmElement } from '../src/domain/crags.ts';

const DEFAULT_OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const UA = 'crag-snapshot-script/1.0 (weekly build job)';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function fromOverpass(url: string): Promise<CragSnapshot> {
  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Accept: 'application/json' },
    body: `data=${encodeURIComponent(CRAG_QUERY)}`,
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { elements?: OsmElement[] };
  const crags = parseCrags(json.elements ?? []);
  if (crags.length < MIN_CRAGS) throw new Error(`only ${crags.length} crags in the answer`);
  console.log(`${url}: ${json.elements?.length} elements → ${crags.length} crags in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return { v: 1, generated: Date.now(), crags };
}

async function fromDeployed(url: string): Promise<CragSnapshot> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const snap = readSnapshot(await res.json());
  if (!snap) throw new Error('not a crag snapshot');
  console.log(`${url}: kept the deployed snapshot from ${new Date(snap.generated).toISOString()} (${snap.crags.length} crags)`);
  return snap;
}

async function main(): Promise<number> {
  const out = arg('out') ?? 'public/data/crags.json';
  const fallback = arg('fallback');
  let snap: CragSnapshot | null = null;
  const overpass = arg('overpass');
  for (const url of overpass ? [overpass] : DEFAULT_OVERPASS) {
    try {
      snap = await fromOverpass(url);
      break;
    } catch (e) {
      console.warn(`${url}: ${(e as Error).message}`);
    }
  }
  if (!snap && fallback) {
    try {
      snap = await fromDeployed(fallback);
    } catch (e) {
      console.warn(`${fallback}: ${(e as Error).message}`);
    }
  }
  if (!snap) {
    console.error('No crag snapshot: the app will query Overpass itself.');
    return 1;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const text = JSON.stringify(snap);
  fs.writeFileSync(out, text);
  console.log(`Wrote ${out} (${Math.round(text.length / 1024)} kB)`);
  return 0;
}

process.exitCode = await main();
