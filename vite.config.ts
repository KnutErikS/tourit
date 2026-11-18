import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the built site works on any host or sub-path
  // (GitHub Pages project sites, Netlify, a plain folder on a web server).
  base: './',
  server: { port: 5173, open: true },
  build: { target: 'es2022', sourcemap: true },
});
