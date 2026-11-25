import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { endpointFor } from './src/analytics/hit';

/**
 * GoatCounter account code: the "<code>" in https://<code>.goatcounter.com.
 * Empty = no counting: nothing is sent and the CSP doesn't allow the host.
 * See src/analytics/count.ts for what is counted.
 */
const GOATCOUNTER_CODE = 'skredproblemet';
const GOATCOUNTER_HOST = endpointFor(GOATCOUNTER_CODE) && new URL(endpointFor(GOATCOUNTER_CODE)).origin;

/**
 * Content Security Policy, injected as a <meta> tag (GitHub Pages can't set
 * response headers). Lists exactly the services the app talks to; anything
 * else, including injected inline scripts, is blocked.
 *
 * Adding a new data source? Add its host here too, or the browser will block it
 * (look for "Content-Security-Policy" errors in the console).
 */
const HOSTS = {
  nveApi: 'https://api01.nve.no', // avalanche warnings
  nveGis: 'https://gis3.nve.no', // steepness tiles + legend
  regobs: 'https://api.regobs.no', // observations + their images
  kartverket: 'https://cache.kartverket.no', // basemap tiles
  npolar: 'https://geodata.npolar.no', // Svalbard basemap tiles (Norsk Polarinstitutt)
  hoydedata: 'https://hoydedata.no', // elevation (DTM) for computed layers
  awsTerrain: 'https://s3.amazonaws.com', // 3D terrain tiles
  stedsnavn: 'https://ws.geonorge.no', // place-name search (Kartverket)
  met: 'https://api.met.no', // point weather forecast (yr's data)
  openMeteo: 'https://api.open-meteo.com', // cloud heights + freezing level, recent wind, wind at surf spots
  openMeteoMarine: 'https://marine-api.open-meteo.com', // waves and swell at surf spots
  nveKart: 'https://kart.nve.no', // seNorge snow maps (WMS)
  openMeteoHistory: 'https://historical-forecast-api.open-meteo.com', // wind before older warning dates
  vegvesenWfs: 'https://ogckart-sn1.atlas.vegvesen.no', // webcam list (WFS)
};

/**
 * Only the dev server talks to these (production uses the prebuilt crags snapshot,
 * src/api/crags.ts), so they stay out of the live site's CSP.
 */
const DEV_HOSTS = {
  overpass: 'https://overpass-api.de', // climbing crags from OpenStreetMap, without a snapshot
};

/**
 * Webcam images: only shown as <img>, never fetched by code, so img-src only.
 * Vegvesen's, plus the hand-picked ones in src/domain/extraWebcams.ts.
 */
const CAM_IMAGE_HOSTS = ['https://kamera.atlas.vegvesen.no', 'https://api.romsdal.com', 'https://turtagro.no', 'https://gpss.no'];
const CAM_IMAGES = CAM_IMAGE_HOSTS.join(' ');

function csp(): Plugin {
  let dev = false;
  return {
    name: 'tourit-csp',
    configResolved(config) {
      dev = config.command === 'serve';
    },
    transformIndexHtml(html) {
      const connect = ["'self'", ...Object.values(HOSTS)];
      if (GOATCOUNTER_HOST) connect.push(GOATCOUNTER_HOST); // visit counting (sendBeacon)
      // Vite's dev server uses a websocket for hot reload.
      if (dev) connect.push('ws://localhost:*', 'ws://127.0.0.1:*', ...Object.values(DEV_HOSTS));
      const policy = [
        "default-src 'self'",
        // 'wasm-unsafe-eval' lets the lerc DEM decoder compile its WebAssembly.
        "script-src 'self' 'wasm-unsafe-eval'",
        // Leaflet and the app set inline style attributes; CSS can't run code.
        "style-src 'self' 'unsafe-inline'",
        `img-src 'self' data: blob: ${HOSTS.kartverket} ${HOSTS.npolar} ${HOSTS.nveGis} ${HOSTS.nveKart} ${HOSTS.regobs} ${CAM_IMAGES}`,
        `connect-src ${connect.join(' ')}`,
        "font-src 'self'",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'none'",
      ].join('; ');
      return {
        html,
        tags: [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }],
      };
    },
  };
}

/**
 * Where the app is published. Link previews (Open Graph) need absolute URLs,
 * so change this if the site moves (e.g. to a custom domain).
 */
const SITE_URL = 'https://knuteriks.github.io/tourit/';

/**
 * Link preview tags: the title, text and picture Messenger, SMS, Slack etc.
 * show for a shared link. The picture is public/og-image.png (source:
 * docs/og-image.html). Crawlers ignore the #hash, so every shared view gets
 * the same preview.
 */
function shareTags(): Plugin {
  const title = 'Skredterreng Norge';
  const description =
    'Skredvarsel, bratthet og skredterreng i kartet for hele Norge – med vær, observasjoner og ruteplanlegging. Data fra Varsom/NVE, Regobs, Kartverket og yr.';
  const image = new URL('og-image.png', SITE_URL).href;
  const meta = (attr: 'property' | 'name', key: string, content: string) => ({ tag: 'meta', attrs: { [attr]: key, content }, injectTo: 'head' as const });
  return {
    name: 'tourit-share-tags',
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          meta('property', 'og:type', 'website'),
          meta('property', 'og:site_name', 'Skredterreng'),
          meta('property', 'og:locale', 'nb_NO'),
          meta('property', 'og:url', SITE_URL),
          meta('property', 'og:title', title),
          meta('property', 'og:description', description),
          meta('property', 'og:image', image),
          meta('property', 'og:image:type', 'image/png'),
          meta('property', 'og:image:width', '1200'),
          meta('property', 'og:image:height', '630'),
          meta('property', 'og:image:alt', 'Skredterreng – skredvarsel, bratthet og skredterreng for hele Norge'),
          meta('name', 'twitter:card', 'summary_large_image'),
          meta('name', 'twitter:title', title),
          meta('name', 'twitter:description', description),
          meta('name', 'twitter:image', image),
        ],
      };
    },
  };
}

/**
 * Write the list of built files into dist/sw.js, so the service worker can
 * store the app on install and open it without network (see public/sw.js).
 * Left out: source maps, .woff (every browser that runs the app takes .woff2)
 * and the 3D view's MapLibre chunks (3D needs network for its terrain anyway).
 */
function swPrecache(): Plugin {
  let outDir = 'dist';
  return {
    name: 'tourit-sw-precache',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    writeBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => f.startsWith('assets/') && !/\.(map|woff)$/.test(f) && !/maplibre/.test(f))
        .sort();
      const statics = ['manifest.webmanifest', 'icons/favicon.svg', 'icons/favicon-32.png', 'icons/apple-touch-icon.png', 'icons/icon-192.png'];
      const list = [...files, ...statics];
      const version = createHash('sha256').update(list.join('\n')).digest('hex').slice(0, 12);
      const swPath = path.join(outDir, 'sw.js');
      const src = fs.readFileSync(swPath, 'utf8');
      const out = src
        .replace('const PRECACHE = [];', `const PRECACHE = ${JSON.stringify(list)};`)
        .replace("const SHELL_VERSION = 'dev';", `const SHELL_VERSION = '${version}';`);
      if (out === src || !out.includes(version)) throw new Error('swPrecache: placeholders not found in sw.js');
      fs.writeFileSync(swPath, out);
    },
  };
}

/**
 * Version shown in the app ("Om Skredterreng"), so a bug report says which
 * version it is about: the commit and its date, marked "dev" outside CI.
 *
 * Only from the commit, never the CI run number or today's date: it is
 * compiled into the main bundle, so anything that changes per build gives
 * every build new file hashes and a new service-worker version. The weekly
 * scheduled deploy (fresh crags snapshot, same code) would then make every
 * installed app download itself again and show "Ny versjon".
 */
function buildId(): string {
  const git = (args: string) => {
    try {
      return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      return '';
    }
  };
  const sha = (process.env.GITHUB_SHA ?? '').slice(0, 7) || git('rev-parse --short=7 HEAD') || 'ukjent';
  const date = git('log -1 --format=%cs'); // commit date, YYYY-MM-DD
  return [process.env.CI ? '' : 'dev', sha, date].filter(Boolean).join(' · ');
}

export default defineConfig({
  // Relative asset paths, so the built site works on any host or sub-path
  // (GitHub Pages project sites, Netlify, a plain folder on a web server).
  base: './',
  define: { __BUILD__: JSON.stringify(buildId()), __GOATCOUNTER__: JSON.stringify(GOATCOUNTER_CODE) },
  plugins: [csp(), shareTags(), swPrecache()],
  server: { port: 5173, open: true },
  build: { target: 'es2022', sourcemap: true },
});
