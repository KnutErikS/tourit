# tourit – Skredterreng Norge

Avalanche terrain map for Norway. A static web app (no backend, no API keys) built on open data from NVE/Varsom, Regobs, Kartverket, MET Norway (yr), Open-Meteo and Statens vegvesen. UI in Norwegian.

## Features

- **Ski / Surf** – a switch in the header picks the sport. Ski shows everything below; Surf hides the avalanche layers and the Skredvarsel and Verktøy tabs and shows the surf spots instead. The map, Vær tab, webcams, search and position are shared. The choice is remembered on the device (`ui/sport.ts`; elements marked `data-sport` in `index.html` only show for their sport).
- **Surf** – 16 known spots from Larvik to Lofoten (`src/domain/surfSpots.ts`) with Open-Meteo's marine forecast (swell height, period and direction, wind sea, sea temperature) and the 10 m wind at the beach, about 7 days ahead. On the map, always while Surf is chosen (no checkbox): a badge per spot, coloured by a 0–5 rating, with the estimated breaking wave height; tap it for a popup with waves, swell, wind, sea temperature and the next days, plus *Mer om spotten* (opens it in the Surf tab) and *Vær her*. The Surf tab lists all spots (best first, or along the coast) with the rating now (or 12:00 on the chosen day), the best rating of each of the next 7 days (tap a day to show it), and, opened, the spot's facts, a 3-hourly table for the day, *Vis i kartet* and *Vær her* (picks the spot, so the Vær tab shows its forecast). Fetched only while Surf is chosen; stored on the device for use without network. With Surf chosen a tapped point gets no terrain lookup (it is mostly on water), the map chip leaves out the avalanche verdict, and the Vær tab is set up for surfing: the spot's name, wind hour by hour (direction, speed, gusts) with offshore/cross/onshore for the spot when the point is within 5 km of one, a key line with when it blows offshore, and sunrise, sunset and daylight. Cloud heights, freezing level and sun on slopes are left out.
- **Klatring** – crags for sport and trad climbing from OpenStreetMap (all of Norway, prebuilt weekly by the deploy workflow into `data/crags.json` with one Overpass query, `scripts/crags.ts`; the app loads that file and keeps it on the device for a week, `api/crags.ts`; parsed in `domain/crags.ts`). The app itself never runs the nationwide Overpass query in production, only the dev server does when there is no snapshot. Style, route count and grade range come from the crag's own tags or, more often in Norway, from the routes mapped inside it. On the map: a small square per crag, coloured by a 0–5 climbing rating once its weather is in (grey before). The Klatring tab lists the crags in the map view (up to 40, nearest the middle), filtered Alle / Sport / Trad, with the rating now (or 12:00 on the chosen day), the rock (tørt / fuktig / vått / regn), the next 7 days, and, opened, the crag's facts, a 3-hourly table, *Vis i kartet*, *Vær her*, the crag's guide link when tagged and a link to it in OpenStreetMap. Steepness and aspect stay available (without the avalanche options); the Vær tab is the full one (sun on slopes is useful for walls).
- **Skredfare i terrenget** – forecast regions coloured by today's danger level. From zoom 10, slopes steeper than 27/30/35° that match the aspect and height band of the day's avalanche problems are coloured.
- **Bratthet** – NVE's steepness map, optionally with modelled runout in three bands (short/medium/long: alpha angle 32°/27°/23°, passed by 1 in 2, 1 in 4 and 1 in 20 avalanches). Drawn routes are checked against it and stretches in steep terrain or runout are marked.
- **Snø (seNorge)** – NVE's modelled snow maps for the chosen date (also a few days ahead): new snow over the last 1 or 3 days, or snow depth. 1 km grid, so it shows the pattern across a region, not single slopes.
- **Himmelretning** – slope aspect, computed in the browser from Kartverket's terrain model (zoom 11+).
- **Observasjoner** – Regobs snow observations for the chosen day and the two days before, with photos.
- **Webkamera** – Statens vegvesen's ~900 road webcams (many on mountain passes) from zoom 7, one marker per site with a button per direction; latest image on tap. Plus a few hand-picked mountain cameras (romsdal.com's 17 in Romsdal, Turtagrø, Juvasshytta) in `src/domain/extraWebcams.ts`. Off by default; the camera list is only fetched while the layer is on.
- **Skredvarsel tab** – the full warning for a region, with avalanche problems, advice and weather.
- **Tap the map** – elevation, slope and aspect at that point, and whether each avalanche problem applies there.
- **Verktøy tab** – checks for the tapped point, or your position when nothing is tapped (tap the pin again to remove it):
  - **Stop or Go** – the slope limit for the day's danger level (below 40° / 35° / 30° at level 2 / 3 / 4), measured on the steepest 20 × 20 m where you are or on the whole slope, one level lower outside the warning's aspects and heights, one level higher after whumpfs, shooting cracks or fresh avalanches in Regobs.
  - **ALPTRUTh** – the seven obvious clues (McCammon), six filled in from data; tick or untick any of them yourself (kept on the device per day, and per spot for the slope clues). Three or more turns it red.
  - **Infos** – shown when they hit: kritisk nysnømengde, regn på snø, første mildvær, første fine dag, nattefrost, glidesprekker and dårlige tester in Regobs. The same hits appear as chips on the tapped point.
- **Route risk** – SLABS relative risk and Munter's reduction method every 25 m along a drawn or imported route, with your group setting.
- **Several routes at once** – saved routes can be shown on the map next to the open one (*Vis på kartet* per route, or *Vis alle*), each in its own colour with a matching swatch in the list; hover shows the name. Kept on the device. Only the open route gets the steepness, runout and risk checks.
- **Vær tab** – MET Norway's forecast (yr's data) for the tapped point, with the temperature adjusted to the point's height: sky (low/middle/high cloud), precipitation split into snow/sleet/rain with estimated new snow, temperature, wind, and a 3-hourly timeline for the chosen day. From Open-Meteo (DWD's ICON model, ~7 days): cloud cover by height, so the tab says whether the point is in, above or below the cloud and where the lowest layer is, plus the freezing level and the snow line.
- **Sol og dagslys** (Vær tab) – sunrise, sunset and daylight (civil twilight) for the tapped point and date, polar night and midnight sun included, plus when direct sun reaches the point's own slope and 30° slopes of each aspect, with the strongest clear-sky sun in W/m². Includes shadow from the terrain up to 20 km around (when the sun is over the mountains). Computed on the device, so it works for any date; the terrain shadow needs the elevation tiles (online, or a saved area for the nearest 4 km).
- **Place search** – mountains, peaks, valleys, towns etc. from Kartverket's place-name register. Choosing a hit flies there and selects it.
- **MGRS** – coordinate of the selected point or your own position (live, with accuracy) in a chip on the map; tap to copy.
- **Own position** – with accuracy circle and follow mode.
- **3D view** (needs network) – the same layers on 3D terrain (MapLibre GL). Tap to pick points, rotate, and use the compass to return to north. The 2D map is always north-up.
- **Saved areas** – download map, steepness and elevation tiles for an area so they load from the device. Manage them behind the download icon.
- **Phone layout** – the panel is a bottom sheet: drag up for fullscreen, down to hide. The burger brings it back.

Before 1 December there are no warnings; use **Vis 14. mars 2026** to see a day from last season.

## How the numbers are worked out

Every rule, its source and our own cut-offs are documented in the code comments (mostly `src/domain/`); this is the overview. **Ours** marks a cut-off we chose ourselves and haven't tested against observations.

### Terrain

| What | How | Resolution |
| --- | --- | --- |
| Slope, aspect, elevation | Kartverket DTM fetched per map tile, slope by Horn's 3×3 method, aspect in 8 sectors (`terrain/dem.ts`) | z14 cells are 9.55 m × cos(lat): ~4.5 m at 62° N, ~3.4 m at 69° N |
| Avalanche-terrain layer | Pixel slope ≥ 27/30/35° and inside the aspect + height band of a problem; ≥ 35° drawn stronger | The tile's own zoom: ~18 m cells at z11 (2× oversampled, steepest of 2×2) and z12, ~9 m at z13, ~4 m at z14 |
| "Steepest part" (Stop or Go, route) | Slope averaged over 20 × 20 m (SLF), then the steepest such box within 10 m of the point (*track*), or on the connected slope ≥ 20°, facing within 45° of yours, in a 50 m strip along the fall line, up to 150 m away (*whole slope*) (`domain/slopeWindow.ts`; 10 m, 20°, 45°, 50 m and 150 m are ours) | z14 |
| SLABS terrain | MSA40 = 85th percentile of cell slopes within 40 m; AOF = share of > 25° cells facing the warning's aspects | z14 |
| Runout | NVE's "bratthet med utløp" tiles read pixel by pixel (exact colours) | z14 tiles |

### Stop or Go (`domain/stopOrGo.ts`)

Level → limit and area: 1 none (caution on spots ≥ 40°), 2 < 40° on the track, 3 < 35° on the whole slope, 4–5 < 30° on the whole slope and outside runout. The level is first moved one down outside the warning's aspect/height (SLF one-level rule) and one up for signs of instability in the last 48 h (SLF RiskCheck). "Caution" within 2° below the limit (ours, for DEM error).

### Regobs signs (`domain/signs.ts`)

Reports in the point's forecast region in the 48 h up to the end of the chosen day (never later than now). Each report is weighted by height (within 200 m 1, within 500 m 0.5, else 0.25) and, for avalanches, aspect (same or neighbouring sector 1, else 0.5); a group of signs is "on" at a summed weight of 1 (all ours). ECT results use SLF's four classes (Techel et al. 2020); class 1–2 counts as a poor test.

### ALPTRUTh (`domain/alptruth.ts`)

A: avalanches in Regobs · L: > 15 cm new snow in 48 h, rask oppbygging (≥ 2.5 mm/h as snow for 3 h in a row, or ≥ 25 mm in 24 h), a lee slope of the last 72 h of wind, or Regobs loading signs · P: steepest part ≥ 30° (ours) or inside NVE's steep terrain / runout bands · T: yours to tick · R: level ≥ 3 · U: whumpfs, shooting cracks or poor ECTs · Th: above 0 °C or ≥ 0.5 mm rain between 08 and 16 (ours), or Regobs warming/wet signs. Red at 3 or more.

### Weather behind loading, thaw and the infos (`domain/precip.ts`, `tools/alptruth.ts`)

Steps are MET's forecast for the point (temperature adjusted to the point's height, rain/snow by wet-bulb) from now on. Before that comes the point's own history: Open-Meteo's ICON hours at the tapped point, 2 m above the ground, with `elevation=` the DEM height rounded to 50 m (Open-Meteo downscales to that height: at 69.6° N, 100 m vs 1200 m came out ~0.63 °C per 100 m apart), rain/snow by wet-bulb like MET (`tools/history.ts`, `api/openMeteo.ts` `fetchPointHistory`). Answers are shared within ~1 km and 50 m of height, kept in memory for an hour and stored for use without network. If the point's history can't be had (no network, nothing stored), it falls back to the region's ICON hours at 850 hPa (~1300–1500 m) in the middle of the forecast region, as before. Wind (the 850 hPa wind for lee slopes and the critical-snow wind factor) and the old-snow surface stay per region: ridge-height wind is what moves snow. New snow = water × 0.8–1.5 cm/mm by temperature.

| Info | Hits when |
| --- | --- |
| Kritisk nysnømengde | New snow over 72 h ≥ 70 % of the low end of the critical amount: 30 / 20 / 10 cm for 0 / 1 / ≥ 2 unfavourable factors (850 hPa wind ≥ 11 m/s during the snowfall, mean snowfall temperature < −8 °C, old snow or crust underneath) (SLF, Alpenverein); a warning at ≥ 100 % |
| Regn på snø | ≥ 0.5 mm of rain (≤ 10 % as snow) in the 12 h before or after, where seNorge shows snow |
| Første mildvær | ≥ 0 °C between 08 and 16 after ≥ 10 cm new snow in 48 h, and not mild since that snow |
| Første fine dag | Mean cloud < 30 % between 08 and 16 after ≥ 20 cm new snow in 72 h, no new snow that day, and the day before not fine (30 % is ours) |
| Nattefrost | Sunset to sunrise at the point: none if the low stays above 0 °C (or ≥ 80 % cloud and above −1 °C), good if ≤ −5 °C or ≤ −2 °C under < 50 % cloud, else weak (ours); shown when the day or the day before reaches 0 °C |
| Glidesprekker, dårlig test | Regobs, last 48 h, weighted as above |

### Route risk (`domain/risk.ts`, `route/risk.ts`)

Every 25 m (at most 600 spots, 150 DEM tiles). **SLABS**: MSA40 × 4.3 per danger level × DCE (metres into the warning's heights) × AOF, interpolated in log space between the published knots (ISSW 2024). The paper doesn't publish its class cut-offs; ours put "elevated" at the risk of a 35° slope at level 3 at the edge of the warning's heights, facing its aspects, and "high" one level above. **Munter**: danger potential 2/4/8/16/32 ÷ (slope × aspect × group factors), acceptable at ≤ 1. Slope factor from the steepest part in whole degrees: 40°+ → 1, 36–39° → 2, 35° → 3, 30–34° → 4, under 30° → 8 (bergundsteigen 4/2001: 35–39° → 2, around 35° → 3, 30–34° → 4; under 30° → 8 is ours, the source gives no factor below 30°). Level 3 needs the steepest part under 40°, level 4 under 30°. 2nd-class factors void with a wet-snow problem.

### Surf (`domain/surf.ts`)

Two requests for all spots (Open-Meteo takes a list of coordinates): the marine API (best match: DWD EWAM ~5 km for ~3 days, then ECMWF WAM; `cell_selection=sea` moves a spot onto the nearest sea cell) and the forecast API for the 10 m wind. MET's own oceanforecast has no wave period, which surfing needs, so it isn't used.

| Step | How |
| --- | --- |
| Swell that gets in | The swell partition's height (all waves when the model has no swell) × a direction factor: 1 within the spot's window (±45°, ours, narrower for Skagerrak spots) of its best swell direction, 0.5 at 1.5 × the window, 0 at 2.5 × (ours) |
| Breaking height | Komar & Gaughan (1972): Hb = 0.39 g^(1/5) (T H0²)^(2/5), with the peak period. Under 0.3 m counts as flat |
| Score 0–5 | Size points 0–4 at 0.3 / 0.6 / 0.9 / 1.5 m (ours); +1 at ≥ 11 s, −1 under 7 s; wind against the spot's offshore direction: within 30° offshore, 30–67.5° cross-offshore, to 112.5° cross (−1), to 150° cross-onshore and beyond onshore (−2), another −1 from 9 m/s when not offshore, −1 for offshore ≥ 14 m/s; under 2 m/s counts as glassy (all ours). ≥ 2.5 m is flagged as big |
| Day colours | Best hour between 07 and 19 local time |

Spot positions, type, best swell direction and offshore wind are from each spot's guide on surf-forecast.com (positions to 0.01°). The wave model sees the sea a few km out: sandbars, tide, reefs and shelter behind islands are not in it, and Skagerrak/Lista spots in particular depend on local swell the model may not resolve. None of the cut-offs have been checked against observed surf.

### Climbing (`domain/climb.ts`)

Weather per ~5 km grid cell (Open-Meteo, hourly, the last 2 days and 7 ahead), only for the crags listed (in batches of 50: Open-Meteo counts each location as a call, 600 a minute free). Score 0–5, all cut-offs ours: raining now (≥ 0.2 mm in the hour) → 0; rain over the last 24 h −1 / −2 / −3 from 0.5 / 3 / 10 mm, and −1 more for ≥ 0.3 mm in the last 6 h; under 5 °C or over 22 °C −1, under 0 °C or over 27 °C −2; wind ≥ 12 m/s −1, gusts ≥ 20 m/s −1; ≥ 90 % humidity with under 2 m/s wind −1. Wet rock (≥ 10 mm in 24 h, or ≥ 1 mm in 6 h) scores at most 1, damp rock at most 3. Day colours: best hour 09–20. Not known: the wall's own aspect and sun (rarely tagged in OSM), roofs that stay dry, seepage that lasts days after heavy rain.

OSM coverage in Norway (Geofabrik taginfo, Nov 2026): ~480 crags and ~70 areas; sport/trad and grades are mostly on the routes, and many crags have neither. Improve the data in OSM (e.g. with openclimbing.org) and it shows up here within a week.

### Precision: known limits, biggest first

1. **History weather at the point (fixed).** The hours before MET's forecast now come from the tapped point at its own height (see above) instead of one 850 hPa point per region; that point is still the fallback without network. Still approximate: ICON is a ~7 km model, so clear-night inversions in narrow valleys and showers on single slopes are smoothed; the old-snow surface (crust or not) and the wind still come from the region. Next step: try MET Nordic (1 km, on Open-Meteo for Norway) for the last 2–3 days, once its `past_days` support is confirmed.
2. **Munter's 1st-class factors (fixed).** Now as bergundsteigen 4/2001: 35–39° → 2, around 35° → 3, 30–34° → 4, in whole degrees (before, 30–34° gave 3, which made those slopes stricter than Munter). Under 30° → 8 is our own addition. "Around 35°" is read as 35° itself, our choice; Munter also counts the steepest part only if it is about 20 m high, which the 20 × 20 m slope window approximates.
3. **Regobs signs use the whole forecast region** with height/aspect weights but no distance. Regions are tens of km across. Fix: weight by distance as well (e.g. 1 within 10 km, 0.5 within 25 km, else 0.25 – ours).
4. **The avalanche-terrain layer depends on zoom.** At z11–12 cells are ~14–18 m, so short steep pitches are smoothed and the colouring can disagree with Stop or Go (20 × 20 m on ~4 m cells) and with NVE's steepness map. Fix: oversample z12 by 2 (~9 m), at 4× the DEM load there; the map's pixel slope and the tool's 20 m average will still differ by a degree or two.
5. **Wind loading is per region** (one 850 hPa point): coastal and inland parts of a region get the same lee aspects, and terrain steering is ignored. Fix: a few points per region, or the tapped point for the tools.
6. **SLABS terrain on finer cells than the paper may have used.** MSA40 here comes from ~4 m cells; if the Swiss model used a coarser DEM, rough terrain reads steeper here and the risk comes out high. Check the paper's DEM resolution before tuning the cut-offs.
7. **Terrain shadow (fixed).** The sun card now uses a horizon around the tapped point: 180 directions (every 2°), marched from 50 m to 20 km over Kartverket's DTM, zoom 11 (~27–36 m cells) out to 4 km and zoom 9 (~110–145 m) beyond, with earth curvature and refraction (k = 0.13) (`domain/horizon.ts`, `terrain/horizon.ts`). Costs typically 2–4 + 2–4 elevation tiles of ~150 kB for the first point in an area (nearby points reuse them; the zoom-11 tiles are shared with the aspect layer and saved areas) and ~40 000 samples of arithmetic. Left out: forest, cornices, and terrain closer than 50 m (the slope itself is handled by the sun-on-slope angle). The coarse far tiles round off distant peaks a little, so very low sun can show a few minutes too early or late. Not yet used for nattefrost or energy on the slope.
8. **seNorge is a 1 km grid**, and its snow depth runs ~+50 % high around 1000–1200 m (Saloranta 2012). "Snow / bare" at the point is the cell's value, so it can be wrong near the snow line in steep terrain.
9. **New-snow density** (0.8–1.5 cm/mm) is a rough fit; measured hourly new snow averaged 68 kg/m³ in the Alps, denser where windy, and no published formula fit it well (Helfricht et al. 2018), so a different formula alone wouldn't add much.
10. **Fixed clock windows** (08–16 day, 21–06 fallback night) use the device's time zone and ignore short polar-night days.

## Develop

Requires Node 22.18+ (the tests run the TypeScript files directly with Node's built-in type stripping).

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck  # src/, and test/ via tsconfig.test.json
npm test           # node:test on the pure logic in src/domain and src/terrain/analyze.ts
npm run build      # typecheck + build to dist/
npm run preview    # serve dist/
```

## Deploy

Every push to `main` type-checks, runs the tests, builds and publishes to GitHub Pages (`.github/workflows/deploy.yml`, uses `npm ci`, so commit `package-lock.json`). A failing check stops the deploy. The workflow also runs every Monday to refresh the climbing crags snapshot; if it can't get one (Overpass down and the live file unreachable), that run deploys nothing. The version in *Om Skredterreng* is the commit and its date only, so a rebuild of the same commit gives byte-identical files and installed apps don't update themselves for nothing. One-time setup: repo → Settings → Pages → Source: **GitHub Actions**. The site lands on `https://<user>.github.io/<repo>/`.

`dist/` uses relative paths, so any static host works (Netlify, Cloudflare Pages, …).

Position and saved areas need **https** (or localhost).

### Usage counting (GoatCounter)

Off until you set it up. To see visits and which features are used:

1. Make a free account at [goatcounter.com](https://www.goatcounter.com) (free for non-commercial use). The code you pick becomes `https://<code>.goatcounter.com`, where the dashboard lives.
2. Put the code in `GOATCOUNTER_CODE` at the top of `vite.config.ts` and push. The build then allows that host in the CSP and the About dialog gets a "Personvern" note.

What is sent (`src/analytics/`): one page view per visit (a page load, or coming back after 30 min in the background) with the path, page title, screen width and the origin of an outside referrer; plus feature events, each at most once per visit (`EVENTS` in `analytics/count.ts`: tabs opened, layers shown, point picked, 3D, route drawing, GPX import/export, saved areas, search, share, own position, tomorrow/demo date, opened as a Home-screen app, opened a shared link with a point, surf mode and what's used in it (marker tap, spot opened in the list, Vis i kartet, Vær her, another day, sorting); one `surf-spot/<id>` row per spot looked at, so you see which spots are popular; and `fail-*` when NVE, Regobs, MET, Open-Meteo, Kartverket's elevation or Vegvesen's webcams failed or was so slow that a stored copy was shown. Since nothing is counted offline, those point at the service, not the user's signal). Never the `#hash` (map view, picked point), coordinates, routes or IDs. No cookies or device storage. Not counted: the dev server, localhost, automated browsers, offline use.

## Code map

```
index.html              Markup for the panel and map buttons, icon/manifest links
public/sw.js            Service worker: serves saved tiles from Cache Storage, else network
public/manifest.webmanifest, public/icons/   App name + icons (source: docs/app-icon-source.svg)
vite.config.ts          Build config + Content Security Policy + GoatCounter code
src/
  main.ts               Entry: wires layers, controls, data loading, point picking, panel
  config.ts             API URLs, colours, zoom limits
  state.ts              Shared app state
  types.ts              Types for NVE/Regobs data
  util.ts               DOM helper, esc(), safeUrl(), dates, fetch
  map.ts                Leaflet map + Kartverket topo basemap
  api/                  Surf: Open-Meteo marine + wind for all spots (surf.ts). NVE warnings/regions, Regobs search, Kartverket place names, MET point forecast, Open-Meteo air profile, region wind and point weather history
  tools/                Assembles domain logic + data for the Verktøy tab (Stop or Go, ALPTRUTh, infos, Regobs signs, the point's weather history, your own ticks)
  domain/               Pure logic, tested with node:test: problem matching, point-in-polygon, observation types, MGRS, weather (rain/snow, cloud layers, snow line), sun, wind loading, Stop or Go and the 20 × 20 m slope window, ALPTRUTh, weighted Regobs signs, new snow / loading / thaw / refreeze (precip.ts), infos, SLABS and Munter (risk.ts)
  terrain/              Elevation tiles (LERC) → slope/aspect; canvas layer base; DEM windows around a point; terrain horizon for sun shadow
  route/                Routes: GPX, storage, NVE steep/runout check (runout.ts), SLABS + Munter along the route (risk.ts)
  layers/               2D layers: avalanche terrain, aspect, steepness, seNorge snow, regions, observations
  three/view3d.ts       3D view (MapLibre, loaded on demand)
  offline/              Saved areas: tile lists, download/delete, metadata
  analytics/            Anonymous usage counting (GoatCounter): hit.ts builds the request (tested), count.ts sends it
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
- **seNorge snow:** a WMS at `kart.nve.no` (`seNorgeGrid_png`, the service senorge.no itself draws from) with `TIME=YYYY-MM-DD`. It isn't a documented public API, so it may change. The legend colours are copied from seNorge's legend and match the map images (`SNOW_LEGEND` in `layers/snow.ts`); 7-day new snow (`sdfsw7d`) isn't offered because this service returns it blank. The layer needs network and isn't part of saved areas.
- **Sun:** solar position from the standard low-precision formulas (`domain/sun.ts`), sampled once a minute. Terrain shadow from a horizon worked out from the DTM around the tapped point (see "Precision" item 7); without elevation data (offline outside a saved area) the card says it is left out. W/m² is a simple clear-sky direct beam, only meant for comparing aspects and times.
- Problem icons are our own drawings in EAWS style. Terrain hits are an automatic reading of the warning, not a replacement for your own assessment.

## Security

- **CSP** is set via `<meta>` in `vite.config.ts` (Pages can't set headers): only the app's scripts, the data hosts in `HOSTS` and, when set, the GoatCounter host. Add new hosts there.
- **API data is untrusted:** use `esc()` for text and `safeUrl()` (https only) for URLs before putting them in HTML.
- **Shared origin:** all Pages sites on one account share `<user>.github.io` (storage, cache, service workers). Only host trusted sites there, or use a custom domain.
- **Dependabot:** `mv docs/dependabot.yml .github/dependabot.yml` and enable alerts in repo settings.

## Data

Avalanche warnings and steepness © NVE / varsom.no · Snow maps © NVE / seNorge (NLOD) · Terrain model and basemap © Kartverket · 3D terrain: AWS Terrain Tiles (© Kartverket) · Observations © Regobs and the observers · Webcams © Statens vegvesen (NLOD, open WFS `datex_3_1:CctvSimple_v2`) · Waves, swell and wind at surf spots: [Open-Meteo](https://open-meteo.com) (CC BY 4.0; DWD, ECMWF, MET Norway) · Surf spot details: surf-forecast.com · Climbing crags © OpenStreetMap contributors (ODbL), via the Overpass API · Other webcams © romsdal.com, Turtagrø hotell, Galdhøpiggen Sommerskisenter · Place names © Kartverket (Sentralt stedsnavnregister) · MGRS via [proj4js/mgrs](https://github.com/proj4js/mgrs). `docs/` holds the original single-file prototype and the prompts it came from.
