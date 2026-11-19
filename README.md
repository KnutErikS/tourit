# tourit – Skredterreng Norge

Avalanche terrain map for Norway. A static web app (no backend, no API keys) built on open data from NVE/Varsom, Regobs, Kartverket, MET Norway (yr) and Open-Meteo. UI in Norwegian.

## Features

- **Skredfare i terrenget** – forecast regions coloured by today's danger level. From zoom 10, slopes steeper than 27/30/35° that match the aspect and height band of the day's avalanche problems are coloured.
- **Bratthet** – NVE's steepness map.
- **Himmelretning** – slope aspect, computed in the browser from Kartverket's terrain model (zoom 11+).
- **Observasjoner** – Regobs snow observations for the chosen day and the two days before, with photos.
- **Skredvarsel tab** – the full warning for a region, with avalanche problems, advice and weather.
- **Tap the map** – elevation, slope and aspect at that point, and whether each avalanche problem applies there.
- **Vær tab** – MET Norway's forecast (yr's data) for the tapped point, with the temperature adjusted to the point's height: sky (low/middle/high cloud), precipitation split into snow/sleet/rain with estimated new snow, temperature, wind, and a 3-hourly timeline for the chosen day. From Open-Meteo (DWD's ICON model, ~7 days): cloud cover by height, so the tab says whether the point is in, above or below the cloud and where the lowest layer is, plus the freezing level and the snow line.
- **Place search** – mountains, peaks, valleys, towns etc. from Kartverket's place-name register. Choosing a hit flies there and selects it.
- **MGRS** – coordinate of the selected point or your own position (live, with accuracy) in a chip on the map; tap to copy.
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
index.html              Markup for the panel and map buttons, icon/manifest links
public/sw.js            Service worker: serves saved tiles from Cache Storage, else network
public/manifest.webmanifest, public/icons/   App name + icons (source: docs/app-icon-source.svg)
vite.config.ts          Build config + Content Security Policy
src/
  main.ts               Entry: wires layers, controls, data loading, point picking, panel
  config.ts             API URLs, colours, zoom limits
  state.ts              Shared app state
  types.ts              Types for NVE/Regobs data
  util.ts               DOM helper, esc(), safeUrl(), dates, fetch
  map.ts                Leaflet map + Kartverket topo basemap
  api/                  NVE warnings/regions, Regobs search, Kartverket place names, MET point forecast, Open-Meteo air profile
  domain/               Pure logic: problem matching, point-in-polygon, observation types, MGRS, weather (rain/snow split, cloud layers, snow line, summaries)
  terrain/              Elevation tiles (LERC) → slope/aspect; canvas layer base
  layers/               2D layers: avalanche terrain, aspect, steepness, regions, observations
  three/view3d.ts       3D view (MapLibre, loaded on demand)
  offline/              Saved areas: tile lists, download/delete, metadata
  ui/                   Panel content, search, MGRS chip, saved-areas page, position, compass, bottom sheet, icons
  styles/app.css        Styling (panel follows light/dark; the map stays light)
```

The aspect and avalanche-terrain layers share the same drawing functions in 2D (Leaflet canvas) and 3D (served to MapLibre through a `tourit://` tile protocol).

## Limitations and assumptions

- **Height bands:** NVE only documents `ExposedHeightFill` (1–4) as a pictogram. Our reading is in `heightTest` in `src/domain/problems.ts`; fix it there if terrain hits don't match varsom.no.
- **Offline is partial:** saved areas serve map/steepness/elevation tiles from the device, but the app itself isn't cached for offline start yet, and warnings and observations always need network.
- **Service worker** must be active for saved areas to be used (normal browsers; not the Claude desktop app's browser pane). Changing tile URLs or DEM oversampling makes existing saved areas stale.
- **Elevation load:** zoom 10–11 fetches elevation at 2× resolution so steep slopes aren't smoothed away; first load of an area can take a few seconds.
- **MapLibre worker** is set explicitly with `setWorkerUrl` (Vite doesn't follow MapLibre's own lookup). In dev, `window.__map3d` exposes the 3D map.
- **Weather:** MET gives the steps (temperature at the point's height, wind, precipitation, cloud in low/middle/high bands). Open-Meteo's ICON profile is merged in by time (`withProfile` in `domain/weather.ts`): pressure levels 1000–500 hPa (~0–5 km), each with cloud cover, temperature and humidity. A level with ≥ 50 % cover counts as cloud; layer base/top are interpolated between levels, so heights are good to a few hundred metres at best, and cloud above ~5 km only shows in MET's "high" band. ICON is used because it is the only model on Open-Meteo with every level here (ECMWF/MET Nordic only have 1000/850/700 hPa). Rain/snow uses wet-bulb temperature (all snow ≤ 0.5 °C, all rain ≥ 1.5 °C), at the point and up the profile for the snow line; new snow is mm × 0.8–1.5 cm/mm by temperature. ICON's own snowfall isn't used: it comes from another model than MET's precipitation, so amounts wouldn't match. MET forbids custom request headers from browsers (no CORS preflight), so caching relies on the browser's HTTP cache plus an in-memory copy until `Expires`; Open-Meteo is kept for an hour.
- Problem icons are our own drawings in EAWS style. Terrain hits are an automatic reading of the warning, not a replacement for your own assessment.

## Security

- **CSP** is set via `<meta>` in `vite.config.ts` (Pages can't set headers): only the app's scripts and the data hosts in `HOSTS`. Add new hosts there.
- **API data is untrusted:** use `esc()` for text and `safeUrl()` (https only) for URLs before putting them in HTML.
- **Shared origin:** all Pages sites on one account share `<user>.github.io` (storage, cache, service workers). Only host trusted sites there, or use a custom domain.
- **Dependabot:** `mv docs/dependabot.yml .github/dependabot.yml` and enable alerts in repo settings.

## Data

Avalanche warnings and steepness © NVE / varsom.no · Terrain model and basemap © Kartverket · 3D terrain: AWS Terrain Tiles (© Kartverket) · Observations © Regobs and the observers · Place names © Kartverket (Sentralt stedsnavnregister) · MGRS via [proj4js/mgrs](https://github.com/proj4js/mgrs). `docs/` holds the original single-file prototype and the prompts it came from.
