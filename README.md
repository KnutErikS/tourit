# tourit – Skredterreng Norge

Avalanche terrain map for Norway. A static web app (no backend, no API keys) built on open data from NVE/Varsom, Regobs and Kartverket. UI in Norwegian.

## Features

- **Skredfare i terrenget** – forecast regions coloured by today's danger level. From zoom 10, slopes steeper than 27/30/35° that match the aspect and height band of the day's avalanche problems are coloured.
- **Bratthet** – NVE's steepness map.
- **Himmelretning** – slope aspect, computed in the browser from Kartverket's terrain model (zoom 11+).
- **Observasjoner** – Regobs snow observations for the chosen day and the two days before, with photos.
- **Skredvarsel tab** – the full warning for a region, with avalanche problems, advice and weather.
- **Tap the map** – elevation, slope and aspect at that point, and whether each avalanche problem applies there.
- **Own position** – with accuracy circle and follow mode.
- **3D view** (needs network) – the same layers on 3D terrain (MapLibre GL). Tap to pick points, rotate, and use the compass to return to north. The 2D map is always north-up.
- **Saved areas** – download map, steepness and elevation tiles for an area so they load from the device. Manage them behind the download icon.
- **Phone layout** – the panel is a bottom sheet: drag up for fullscreen, down to hide. The burger brings it back.

Before 1 December there are no warnings; use **Vis 14. mars 2026** to see a day from last season.

## Develop

Requires Node 20.19+.

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm run build      # typecheck + build to dist/
npm run preview    # serve dist/
```

## Deploy

Every push to `main` builds and publishes to GitHub Pages (`.github/workflows/deploy.yml`, uses `npm ci`, so commit `package-lock.json`). One-time setup: repo → Settings → Pages → Source: **GitHub Actions**. The site lands on `https://<user>.github.io/<repo>/`.

`dist/` uses relative paths, so any static host works (Netlify, Cloudflare Pages, …).

Position and saved areas need **https** (or localhost).

## Code map

```
index.html              Markup for the panel and map buttons
public/sw.js            Service worker: serves saved tiles from Cache Storage, else network
vite.config.ts          Build config + Content Security Policy
src/
  main.ts               Entry: wires layers, controls, data loading, point picking, panel
  config.ts             API URLs, colours, zoom limits
  state.ts              Shared app state
  types.ts              Types for NVE/Regobs data
  util.ts               DOM helper, esc(), safeUrl(), dates, fetch
  map.ts                Leaflet map + Kartverket topo basemap
  api/                  NVE warnings/regions, Regobs search
  domain/               Pure logic: problem matching, point-in-polygon, observation types
  terrain/              Elevation tiles (LERC) → slope/aspect; canvas layer base
  layers/               2D layers: avalanche terrain, aspect, steepness, regions, observations
  three/view3d.ts       3D view (MapLibre, loaded on demand)
  offline/              Saved areas: tile lists, download/delete, metadata
  ui/                   Panel content, saved-areas page, position, compass, bottom sheet, icons
  styles/app.css        Styling (panel follows light/dark; the map stays light)
```

The aspect and avalanche-terrain layers share the same drawing functions in 2D (Leaflet canvas) and 3D (served to MapLibre through a `tourit://` tile protocol).

## Limitations and assumptions

- **Height bands:** NVE only documents `ExposedHeightFill` (1–4) as a pictogram. Our reading is in `heightTest` in `src/domain/problems.ts`; fix it there if terrain hits don't match varsom.no.
- **Offline is partial:** saved areas serve map/steepness/elevation tiles from the device, but the app itself isn't cached for offline start yet, and warnings and observations always need network.
- **Service worker** must be active for saved areas to be used (normal browsers; not the Claude desktop app's browser pane). Changing tile URLs or DEM oversampling makes existing saved areas stale.
- **Elevation load:** zoom 10–11 fetches elevation at 2× resolution so steep slopes aren't smoothed away; first load of an area can take a few seconds.
- **MapLibre worker** is set explicitly with `setWorkerUrl` (Vite doesn't follow MapLibre's own lookup). In dev, `window.__map3d` exposes the 3D map.
- Problem icons are our own drawings in EAWS style. Terrain hits are an automatic reading of the warning, not a replacement for your own assessment.

## Security

- **CSP** is set via `<meta>` in `vite.config.ts` (Pages can't set headers): only the app's scripts and the data hosts in `HOSTS`. Add new hosts there.
- **API data is untrusted:** use `esc()` for text and `safeUrl()` (https only) for URLs before putting them in HTML.
- **Shared origin:** all Pages sites on one account share `<user>.github.io` (storage, cache, service workers). Only host trusted sites there, or use a custom domain.
- **Dependabot:** `mv docs/dependabot.yml .github/dependabot.yml` and enable alerts in repo settings.

## Data

Avalanche warnings and steepness © NVE / varsom.no · Terrain model and basemap © Kartverket · 3D terrain: AWS Terrain Tiles (© Kartverket) · Observations © Regobs and the observers. `docs/` holds the original single-file prototype and the prompts it came from.
