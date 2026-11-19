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
        "script-src 'self'",
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

export default defineConfig({
  // Relative asset paths, so the built site works on any host or sub-path
  // (GitHub Pages project sites, Netlify, a plain folder on a web server).
  base: './',
  plugins: [csp()],
  server: { port: 5173, open: true },
  build: { target: 'es2022', sourcemap: true },
});
