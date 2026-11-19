import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

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
  hoydedata: 'https://hoydedata.no', // elevation (DTM) for computed layers
  awsTerrain: 'https://s3.amazonaws.com', // 3D terrain tiles
  stedsnavn: 'https://ws.geonorge.no', // place-name search (Kartverket)
  met: 'https://api.met.no', // point weather forecast (yr's data)
  openMeteo: 'https://api.open-meteo.com', // cloud heights + freezing level, recent wind
  openMeteoHistory: 'https://historical-forecast-api.open-meteo.com', // wind before older warning dates
};

function csp(): Plugin {
  let dev = false;
  return {
    name: 'tourit-csp',
    configResolved(config) {
      dev = config.command === 'serve';
    },
    transformIndexHtml(html) {
      const connect = ["'self'", ...Object.values(HOSTS)];
      // Vite's dev server uses a websocket for hot reload.
      if (dev) connect.push('ws://localhost:*', 'ws://127.0.0.1:*');
      const policy = [
        "default-src 'self'",
        // 'wasm-unsafe-eval' lets the lerc DEM decoder compile its WebAssembly.
        "script-src 'self' 'wasm-unsafe-eval'",
        // Leaflet and the app set inline style attributes; CSS can't run code.
        "style-src 'self' 'unsafe-inline'",
        `img-src 'self' data: blob: ${HOSTS.kartverket} ${HOSTS.nveGis} ${HOSTS.regobs}`,
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

export default defineConfig({
  // Relative asset paths, so the built site works on any host or sub-path
  // (GitHub Pages project sites, Netlify, a plain folder on a web server).
  base: './',
  plugins: [csp(), swPrecache()],
  server: { port: 5173, open: true },
  build: { target: 'es2022', sourcemap: true },
});
