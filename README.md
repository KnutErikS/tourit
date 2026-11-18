# tourit – Skredterreng Norge

An avalanche terrain map for Norway. It combines data from:

| Layer | Source | How |
|---|---|---|
| **Skredfare i terrenget** | NVE avalanche warning API (same data as varsom.no) | Regions coloured by danger level. From zoom 10, steep cells (≥ 27/30/35°) that match the aspect + height band of the day's avalanche problems are coloured. |
| **Bratthet** | NVE `Bratthet_2024` MapServer | NVE's official steepness tiles. |
| **Himmelretning** | Kartverket DTM (hoydedata.no ImageServer, LERC float32) | Slope + aspect computed in the browser per tile (Horn's method), from zoom 11. |
| **Observasjoner** | Regobs API v5 | Snow observations for the selected day and the two days before, with photos. |

**Saved areas (offline maps).** The square button on the map saves the visible area (basemap, steepness and/or elevation data, up to a chosen zoom) to the device. The download icon opens a page to view, resume or delete saved areas. Saved tiles are used automatically, also without network. Warnings and observations still need network.

**3D view (needs network).** The 3D button opens a MapLibre GL map at the same spot, with terrain from AWS Terrain Tiles (Kartverket DTM 10 over Norway). All layers from the panel work there too: topo map, steepness, danger-level regions, the avalanche-terrain overlay, aspect, and Regobs observations with popups. The two computed overlays are served to MapLibre through a `tourit://` tile protocol that uses the same drawing code as 2D (so they still fetch elevation from hoydedata.no). Tapping the terrain picks a point like in 2D. "2D" goes back. MapLibre is only downloaded the first time 3D is opened.

Click anywhere on the map to pick a point. The app finds the forecast region, samples elevation/slope/aspect at that point, and marks each avalanche problem as *Gjelder punktet* or *Ikke her* with the reason.

All APIs are public, need no key, and allow cross-origin requests, so this is a purely static site with no backend.

## Run locally

Requires Node 20.19+ (or 22+).

```bash
npm install
npm run dev        # http://localhost:5173 with hot reload
```

Other scripts:

```bash
npm run typecheck  # tsc only
npm run build      # typecheck + production build to dist/
npm run preview    # serve dist/ locally
```

Outside the season (before 1 December) there are no warnings, so use the **Vis 14. mars 2026** button to load a day from last season.

## Deploy

`npm run build` produces a fully static `dist/` folder with relative paths (`base: './'`). Any static host works.

**GitHub Pages:**

0. Move the workflow into place (it couldn't be written there remotely): `mkdir -p .github/workflows && mv docs/github-pages-deploy.yml .github/workflows/deploy.yml`
1. `git init`, commit (include `package-lock.json`; the workflow uses `npm ci`), and push to a GitHub repo on `main`.
2. Repo → Settings → Pages → Source: **GitHub Actions**.
3. Every push to `main` runs `.github/workflows/deploy.yml` and publishes the site to `https://<user>.github.io/<repo>/`.

**Alternatives:** Netlify, Vercel or Cloudflare Pages. Build command `npm run build`, output directory `dist`.

## Code map

```
index.html                 Panel markup (Norwegian UI). Loads src/main.ts.
public/sw.js               Service worker: serves saved tiles from Cache Storage, else network.
src/
  main.ts                  Entry point: creates layers, wires controls, loads data, handles map clicks.
  config.ts                API URLs, colours, zoom thresholds, demo date.
  state.ts                 Shared mutable state (date, regions, selection, settings).
  types.ts                 Types for NVE + Regobs responses and parsed domain objects.
  util.ts                  DOM helper, escaping, date formatting, fetch-JSON.
  map.ts                   The Leaflet map, basemap (Kartverket topo greyscale) and panes.
  api/
    nve.ts                 Forecast regions + daily warnings.
    regobs.ts              Observation search (paged).
  domain/                  Pure logic, no DOM, easy to unit test.
    problems.ts            Height band / aspect parsing, point verdicts, problem classification.
    geo.ts                 Point-in-polygon, region lookup.
    observations.ts        Observation classification, per-region filtering.
  terrain/
    dem.ts                 Fetch + cache DTM tiles, compute slope/aspect, sample one point.
    computedLayer.ts       Leaflet canvas GridLayer fed by DTM tiles.
  layers/
    avalancheTerrain.ts    The "Skredfare i terrenget" raster.
    aspect.ts              Aspect raster.
    steepness.ts           NVE steepness tiles + legend.
    regions.ts             Region polygons and styling.
    observations.ts        Regobs markers.
  three/
    view3d.ts              3D view: lazy-loads MapLibre, builds the style, tourit:// protocol for computed overlays,
                           observation markers, syncs layers/position with 2D.
  offline/
    tiles.ts               Which tile URLs make up a saved area (must match what the layers request) + size estimate.
    download.ts            Download/resume into Cache Storage, delete (keeps tiles shared with other areas), storage info.
    store.ts               Saved-area metadata in localStorage.
  ui/
    offlinePage.ts         Map buttons + the "Lagrede områder" page.
    detail.ts              "Skredvarsel" tab (full warning, varsom.no style).
    summary.ts             Short summary in the "Kartlag" tab.
    point.ts               Picked-point line and hit chips.
    obsHtml.ts             Observation list, popups, thumbnails.
    icons.ts               Aspect rose, height-band mountain, avalanche-problem pictograms.
    status.ts              Status line.
  styles/app.css           All app styling (light/dark via prefers-color-scheme).
```

Data flow: `main.ts` → `api/*` fetches → results stored in `state` → `layers/*` redraw from `state` → `ui/*` render HTML from `state`.

## Known assumptions

- **Height bands.** NVE's `ExposedHeightFill` (1–4) is only documented as which part of a mountain pictogram is black/white. The mapping is in `src/domain/problems.ts` (`heightTest`). If terrain hits disagree with the text on varsom.no for a known day, fix it there.
- **Problem icons** are our own drawings in the EAWS style, not NVE's artwork.
- **Elevation load.** At zoom 10–11 the avalanche layer fetches elevation at 2× resolution (≈4× data per tile) so steep slopes aren't smoothed away. First load of an area can take a few seconds.
- Terrain hits are an automatic reading of the warning and do not replace your own assessment in the field.

- **Saved areas need a service worker.** It works on localhost and https in normal browsers. The browser pane inside the Claude desktop app does not run service workers, so there areas download but are not used. If you change a tile URL or the DEM oversampling, saved areas made before the change will no longer match.

- **MapLibre's worker** is imported with Vite's `?url` and set with `setWorkerUrl` (see `src/three/view3d.ts`). MapLibre normally finds the worker relative to its own file, which Vite's dep pre-bundling and build don't follow; without this the 3D map shows terrain but no regions and never finishes loading. In dev, `window.__map3d` gives the MapLibre map in the console.

## Data and attribution

Snøskredvarsler and bratthet © NVE / varsom.no · Terrengmodell and basemap © Kartverket · Observations © Regobs (NVE) and the individual observers.
