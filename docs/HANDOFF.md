# Tiny Atlas — Swat Illustrated Map: complete handoff

Written 2026-10-02 at the end of the first build push. This is the single source of truth for an agent taking over.
Read it top to bottom once before touching anything. Everything here was learned the hard way; where it says
"never", a previous attempt failed exactly that way.

Companion documents: `README.md` (app overview, run commands), `docs/atlas-pack-v1.md` (the pack data contract, the
most important interface in the system). The UI design canvas is a private claude.ai artifact:
https://claude.ai/artifact/Q7GhCi1qRGbw14beVPKqtj (the owner must share it before another person can open it; its
content is summarised in §8 so you do not need it).

---

## 0. Status snapshot (read first)

| Item | State |
|---|---|
| Branch | `swat-illustrated-map` (local; not yet pushed). `main` on GitHub is still v1.0.0 (`72f8fb1`). |
| Commits on the branch | `8a4c043` geo bundles + Blender posters · `58f410f` paint-over + TRELLIS · `bc6e06c` Atlas v1 · `78c84dd` Lower Swat + linked packs · `38eba22` Atlas in the app |
| Tests | `python -m pytest -q` → 53 passed after the v2.1 cleanup; `python backend/tools/smoke.py [http://localhost:8000]` end-to-end |
| Live map | `cd backend && uvicorn tinyatlas.api:app --port 8000` → `http://localhost:8000/atlas.html?pack=swat` (and `?pack=swat-lower`). Owner confirmed it runs well in Chrome on real hardware. |
| Data (gitignored, under `data/`) | bundles `swat`, `swat_far`, `swat_lower`, `swat_lower_far`; packs `data/packs/swat/atlas` (~104 MB), `data/packs/swat-lower/atlas` (~162 MB); research, photos, models, renders. |
| RunPod | Old pod `t6t4cq301hjkuo` TERMINATED. TTS pod `s9p3rr2my88itr` (RTX A4000, $0.17/h) was RUNNING for the audio-guide job at the time of writing. **First action: check it with the RunPod `get-pod` tool; if the audio job is done or abandoned, stop + terminate it.** `.env` `POD_ID` / `POD_JUPYTER_TOKEN` point at it. |
| In-flight work at handoff | Swat audio guide generation (narration + Kokoro/MMS TTS) by a subagent. Verify its outputs before relying on them (§10.3). |
| Owner decisions | DONE: v2.0.0 released (main + tag + gh-pages). DONE (v2.1 cleanup): the app is Swat-only (Diorama, non-Swat regions, "Build any place" and dead modules removed; list in `docs/CLEANUP-v2.1.md`) and the main page is rebuilt in the Atlas style (`web/index.html`, `css/home.css`, `js/home.js`, data from `backend/tools/home_data.py` → `web/data/home.json`). Tests: 53 (removed tests covered deleted code). Model zoom bug fixed: fixed scale (`landmarks.js`: real size × user multiplier, minimum ×20 so landmarks read when zoomed out, displayed footprint capped 1 km). Audio: English only, generated locally (Kokoro / Chatterbox bake-off in progress; MMS-TTS is CC-BY-NC and must not be used). |
| Known defects | §14. (The Explore-area heading drift between `meta.json` and `atlas_pack.py` was found while writing this document and is RESOLVED: generator updated, rebuilt `meta.json` parses to exactly the same JSON as the hand-fixed one.) |

---

## 1. The product and its non-negotiable principles

**What it is.** A tourist-facing, geographically TRUE, illustrated 3D map of Swat (Khyber Pakhtunkhwa, Pakistan):
upper Swat (Kalam, Utror, Gabral, Ushu, Matiltan, Mahodand, Kumrat over the ridge in Upper Dir) and lower/middle Swat
(Mingora, Saidu Sharif, the Gandhara stupas, Udegram, Barikot, Malam Jabba, Madyan, Bahrain). It must look like a
golden-hour pictorial poster (the owner's reference image, §6.1) while every ridge, river, road and place sits at its
real coordinates. Tourists get an overview, then dig into each place's history, timeline, sourced facts, photos,
routes, an audio guide and offline use.

**Principles (all of them are enforced in review):**
1. **Real data sets the facts; AI only paints, speaks and plans on top of them.** Terrain, roads, water, places,
   heights, distances, travel times come from open data. Image models are pinned to geometry (ControlNet); the planner
   may only choose among measured options; extracted facts must carry a verbatim quote from their source; generated
   content is labelled.
2. **True positions, labelled exaggeration.** Vertical exaggeration (1.3–2.0 by shot) and hero-scaled landmarks are
   allowed and are stated on the map ("Heights exaggerated ×1.8", "places drawn larger than life"). Nothing is ever
   moved. The reference poster cheats geography; we never do.
3. **Never invent.** No invented coordinates, heights, facts, dates, trek lines. Gaps stay gaps (routes are drawn only
   on OSM-backed pieces; missing places stay out until a checkable source exists). Unverifiable = say so.
4. **Honesty in the UI.** A place hidden behind a ridge is drawn as a hollow dot with a dashed leader, not hidden and
   not shown as visible. Route confidence is shown in words. Travel times are road-class based and labelled estimates.
5. **Licences.** Only CC0 / public domain / CC BY / CC BY-SA content and commercial-safe models (no FLUX-dev, nothing
   non-commercial). Attribution is visible wherever content shows.
6. **Quality bar = the poster.** Every visual change is judged by looking at it next to the approved posters (§6).

---

## 2. Repository map

```
backend/tinyatlas/        FastAPI app. regions.py (built-in places; swat + swat-lower have "atlas": <pack slug>),
                          atlaspack.py (stops/facts/roads/heights for Atlas regions, read from the pack),
                          planner.py (day planner; Atlas speeds by road class), api.py (/api/*, /packs static, gzip),
                          narration.py, facts.py, llm.py (OpenRouter), routing.py, sun.py, viewshed.py, ...
backend/tools/            geo_bundle.py        bbox -> co-registered raster/vector bundle (§4.2)
                          blender/prep.py      bundle -> npy, de-lit albedo, tree points, lakes.json
                          blender/fetch_buildings.py   OSM building footprints (multi-bbox, tiling, retries)
                          blender/build_scene.py       Blender scene: poster shots, passes, albedo bake (§4.4)
                          blender/stupa.py     procedural lathe stupa maquettes (§9.1)
                          blender/glb_compare.py       render a GLB from two angles for photo comparison
                          poster_labels.py     labels/cartouche/compass/attribution over a render (§6.6)
                          atlas_pack.py        bundle + research + models -> Atlas pack (§4.5)
                          shortname.py         label short names
                          collect_photos.py    licence-filtered Commons photos via the Wikipedia API (§3.3)
                          buildings3d.py, trellis_setup.sh, trellis_worker.py, trellis_all.sh, b3d_sheet.py  TRELLIS (§9.2)
                          paintover.py, passes_convert.py   SDXL ControlNet detail pass (parked, §6.7)
                          atlas_shot.py        headless Playwright screenshots of the Atlas (§13)
                          atlas_mock.py        synthetic pack for renderer development
                          pod_run.py, pod_files.py   RunPod via Jupyter (credentials from .env, never argv)
                          audio.py, tts_setup.sh, tts_worker.py   audio guide TTS on the pod
                          pack.py              static site builder (copies Atlas packs, writes static atlas.html)
web/atlas.html, web/css/atlas.css, web/js/atlas/*.js   THE NEW APP (Atlas renderer + UI), §7, §8
web/js/home.js            gallery (Swat cards -> /atlas.html?pack=<slug>)
web/js/main.js            router; /?region=swat redirects to the Atlas
web/js/place.js, scene.js, light.js, models.js, views.js, viewshed.js, panorama.js, keepsake.js, ...
                          OLD Diorama interface. Slated for removal (owner decision, §15).
web/sw.js                 service worker: shell cache + data cache; /packs/ is data
docs/atlas-pack-v1.md     pack contract;  docs/HANDOFF.md  this file
data/ (gitignored)        bundles/, packs/, research/, photos/, models3d/, renders/, atlas_shots/, cache/, assets/
D:/TinyAtlas/tools/blender-5.2.2-windows-x64/blender.exe   portable Blender 5.2.2 LTS (headless: -b -P script -- args)
```

Machine: Windows 11, Git Bash + PowerShell, Python 3.13 (`C:\Python313`), Node 22, GPU GTX 1660 SUPER 6 GB (CUDA,
no OptiX RT cores). Python geo stack installed: numpy, scipy, PIL, rasterio, pyproj, shapely, imagecodecs, tifffile,
httpx, playwright. Blender's bundled Python has numpy only (so heavy prep runs in system Python first).

---

## 3. Data sources, licences and network quirks

### 3.1 Sources (exact)
| Layer | Source | Access | Licence / attribution |
|---|---|---|---|
| Elevation 30 m | Copernicus DEM GLO-30 | COG `https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N35_00_E072_00_DEM/Copernicus_DSM_COG_10_N35_00_E072_00_DEM.tif` (tile name from floor lat/lon), read via rasterio `/vsicurl/` windows | "Contains modified Copernicus DEM GLO-30 data, (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA" |
| Land cover 10 m | ESA WorldCover 2021 v200 | `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N33E072_Map.tif` (3°×3° tiles named by SW corner on multiples of 3) | CC BY 4.0, "© ESA WorldCover project 2021" |
| Satellite colour | EOX Sentinel-2 cloudless **2016** layer `s2cloudless_3857` (unsuffixed id) | WMTS `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg`, z13 (~15.6 m/px here) | CC BY 4.0 "Sentinel-2 cloudless by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016)". **2016 and 2017 are CC BY; 2018+ are NON-COMMERCIAL — never use them.** |
| Vectors | OpenStreetMap via Overpass | `https://overpass-api.de/api/interpreter`, fallback `https://overpass.kumi.systems/api/interpreter` | ODbL, "© OpenStreetMap contributors" |
| Sky | Poly Haven `belfast_sunset_puresky_4k.hdr` | `data/assets/` | CC0 |
| Photos | Wikimedia Commons | via the en.wikipedia API (§3.3) | per file: CC0/PD/CC BY/CC BY-SA only; caption "Photo: <Artist>, <Licence>, via Wikimedia Commons" |
| Facts/history | Wikipedia, Wikidata, OSM, Italian Archaeological Mission publications, KP Tourism | WebFetch / APIs | each fact carries source URL + verbatim quote |

WorldCover codes: 10 tree, 20 shrub, 30 grass, 40 crop, 50 built-up, 60 bare, 70 snow/ice, 80 water, 90 wetland,
95 mangrove, 100 moss/lichen.

### 3.2 Network quirks on this machine (Pakistan ISP)
- **commons.wikimedia.org is blocked** (DNS and TLS SNI reset; even IP pinning fails). Workarounds that work:
  `https://en.wikipedia.org/w/api.php?action=query&list=search&srnamespace=6&srsearch=<q>` returns shared Commons
  files; `prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1600` gives licence/artist/thumb URL; downloads from
  `upload.wikimedia.org` work. Commons category listing is NOT available.
- **Wikimedia returns HTTP 403 without contact info in the User-Agent.** Use exactly
  `TinyAtlas/0.1 (https://github.com/zeshanabdullah10/tinyatlas; open-source travel map research)`. Never spoof a
  browser UA, never put the owner's email in it. ≤ 2 req/s, cache under `data/cache/wiki/`.
- **Overpass is very slow / times out** (6–9 min per query for 70 km boxes; bridges query timed out repeatedly). Cache
  every response (`data/cache/osm/`), tile big boxes, retry with the fallback endpoint, split on timeout.
- Nominatim: 1 req/s with the same UA.

### 3.3 Research data (`data/research/`)
- `swat_gazetteer.json`: ~89 entries. Schema per entry: `slug, name, name_ur, kind, area, lat, lon, coord_source,
  coord_confidence (high|medium|low), elevation_m, summary, timeline[{date,event,source}], facts[{text,quote,source}],
  access, hidden_gem, photos[{file_page,author,license}], wikidata, wikipedia, notes`. Areas: swat-lower, swat-mid,
  kalam, ushu-mahodand, utror-gabral, kumrat, malam-jabba, gateway.
- `swat_timeline.json`: 27 region events (c. 1400 BCE grave culture → 2025 floods), each with source URL.
- `swat_routes.json`: 9 routes with OSM-backed geometry, length, ascent/descent from DEM, confidence; gaps described,
  never bridged. `swat_road_classes.json`: jeep-only classification for the upper bundle's roads.
- `README.md`: counts, low-confidence list, gaps.
- **Rules that were enforced:** coordinates from OSM/Wikidata only; Wikipedia/Wikidata coords were WRONG several times
  (Butkara I point is actually Saidu Sharif stupa, 1.1 km off; one Amluk-Dara item is 65 km off; three lakes share a
  placeholder coord) → always prefer the OSM object and sanity-check the sub-valley. Facts need a verbatim quote that
  is machine-checked against the page text. Blogs only for "access"/hidden gems, flagged. Disputed values recorded in
  notes (Mankial 5,509 OSM vs 5,722 Wikipedia → DEM summit 5,717 settles it).
- Places that still have NO verifiable coordinates (do not add them by guessing): Neel Dand, Ichikhor, Dewangar,
  Kachi Kani Pass, Ploga Pass, Ghawai Bela, Karakar Pass; also Kalam bridge/mosque, Najigram, Tokar Dara, Shakhorai.
  "Jaz Dand" (from a copyrighted tourist poster) matches no record; OSM's walked Swat–Kumrat link is Utror → Zhandrai
  Pass → Thal, not via Jaz Banda. GPX tracks from the owner would fill these.
- A copyrighted VisitSwatValley.com tourist map was used ONLY as a checklist of names and route topology (facts are
  not copyrightable); its artwork is never used; its heights are unreliable (Falak Sar "20,520 ft" is wrong; sourced
  5,918 m).

### 3.4 Photos (`data/photos/<slug>/`)
`NN.jpg` (≤1600 px), `manifest.json` (title, url, licence, artist, attribution string, gps, dist_km, role:
structure|landscape|artefact), `_sheet.jpg` contact sheet. `shortlist_3d.json` = best photos per structure for 3D with
honest quality ratings. ~400 photos over 45 targets. Two misfilings were found and fixed (an Amluk-Dara photo was
Shingardar; a "Butkara I" photo was Saidu Sharif) → **always eyeball contact sheets; signs in photos are evidence.**

---

## 4. The pipeline, step by step

### 4.1 Grid conventions (get these wrong and everything is 15 m or more off)
- One common grid per bundle: **UTM zone 43N, EPSG:32643**, north-up, snapped to `--res` (30 m). Upper `swat` grid
  2470 × 2097 cells.
- **Samples are pixel-centred**: cell (col i, row j) sits at `x = (i + 0.5)·res`, `z = (j + 0.5)·res` from the NW corner.
- Scene coordinates (packs, renderer): `x` metres east of the near grid's NW corner, `z` metres south, `y` up; north is
  −z. Heights stored as real metres; renderer applies `(h − hmin)·exag`.
- Blender scenes use 1 BU = 10 m.

### 4.2 Geo bundle
```
python backend/tools/geo_bundle.py swat        --bbox 72.10 35.30 72.90 35.85 --res 30
python backend/tools/geo_bundle.py swat_far    --bbox 71.6 34.9 73.5 36.7   --res 120 --sat-res 60 --no-osm
python backend/tools/geo_bundle.py swat_lower  --bbox 72.00 34.58 72.70 35.30 --res 30      # tiles onto swat's south edge
python backend/tools/geo_bundle.py swat_lower_far --bbox 71.5 34.2 73.2 35.7 --res 120 --sat-res 60 --no-osm
```
Output `data/bundles/<name>/`: `height.tif` (float32 m, bilinear), `height16.png`, `landcover.png` + `landcover_hi.png`
(mode resampling; hi = res/2 = **15 m**, not 10), `satellite.jpg` (10 m, bilinear from z13 mercator), `osm.json`
(roads, waterways, water rings, peaks, passes, places, pois, bridges; every point carries lon/lat AND pixel x/y),
`meta.json` (crs, transform, hmin/hmax, sources, licences), `preview.png` (satellite × hillshade + vectors, for eyeballing).
**Multipolygon water relations are stitched into closed rings** (a bug where each member way became its own broken
polygon made Mahodand disappear; fixed). Verification the agent must report: grid size; Kalam ≈ 2,000 m; max height
and its location; landcover histogram; river vertices sit below the 2 km local mean height.

### 4.3 Prep
```
python backend/tools/blender/prep.py data/bundles/swat            # height.npy, landcover_hi.npy, albedo.png, trees.npy, lakes.json
python backend/tools/blender/prep.py data/bundles/swat_far --no-trees
python backend/tools/blender/fetch_buildings.py data/bundles/swat_lower --cap 15000 --bbox ... [--bbox ...]
```
- `albedo.png` = **de-lit satellite**: satellite luminance ÷ (0.35 + 0.65·hillshade at acquisition sun az 145°, el 55°),
  clipped, mild saturation boost. Removes baked midday shadows so our golden-hour light does not fight them.
- `trees.npy` = N×3 (x_m, y_m, scale) jittered in tree pixels at ~1 tree / 400 m², deterministic seed (upper: 1.62 M).
- `lakes.json` = union of the OSM ring and the touching WorldCover water component (15 m), closed + blurred + contoured.
  Mahodand: OSM 0.09 km² → 0.22 km² (WorldCover ~0.21). (An earlier estimate of 1.5–2.5 km² was simply wrong.)
- Buildings: Mingora had ~35 k OSM footprints, thinned to ~13.9 k; total cap 15 k per pack. OSM has none for Barikot.

### 4.4 Blender scene (`build_scene.py`)
Run: `blender.exe -b -P backend/tools/blender/build_scene.py -- --bundle data/bundles/swat --far data/bundles/swat_far --shot overview [--preview] [--res-scale 1.5] [--samples 192]`.
- Shots live in the `SHOTS` dict (lat/lon target, heading, pitch, dist, lens, shift_y, focus, fstop, exag, sun_az/el/
  strength/colour, haze). Current: `kalam`, `mahodand`, `overview`, `lower` (values in the file; e.g. overview
  heading 5°, pitch −31°, 42 km, 24 mm, exag 1.8, sun 215°/15°, colour (1.0,0.74,0.46); lower heading 25°, pitch −26.5°,
  44 km, sun 238°/14°).
- Terrain mesh built with numpy + `foreach_set` (never `from_pydata`; too slow), full 30 m res; far backdrop mesh
  with a hole + the near mesh ramped down into it over 1.2 km (no z-fighting, no seam).
- Material (Principled): de-lit albedo base; landcover (Closest, Non-Color) + slope + height layers: snow = class 70
  or (h > ~4400 m and slope < ~35–46°) softened by noise, colour (0.92,0.94,0.98), roughness ~0.38, small subsurface;
  **no snow on > 45° faces** (dark rock ribs must show through); rock on steep slopes = warm ochre/grey-brown with AO
  (distance ~60 m) darkening gullies up to 45% and a pointiness lift on ridges; meadows (30/100) green↔olive↔gold
  noise; forest floor dark green; crops/built-up read as fields/town in the lowland shot (`lowland=True`).
- Water: rivers as ribbons carved 3 m into the terrain, width by camera distance (clamped real…2× real), clipped out
  of lakes; turquoise (0.02,0.32,0.36), roughness ~0.12, specular IOR level ~0.3, intermittent foam ≤ 15 % width;
  lakes flat at the 10th-percentile shore height, deep (0.01,0.28,0.32) → shallow (0.10,0.55,0.55) by distance to shore.
- Roads: paved light tan; tracks thinner dusty tan (0.45,0.38,0.28), roughness 0.9.
- Trees: 3 conifer variants (blue pine / deodar silhouettes), instanced via Geometry Nodes on a point mesh; frustum-
  culled, full density to ~20 km, scale grows with distance up to 1.6×, tree scale ~2.5–3.5× real (poster convention),
  dark blue-green with a warm sunlit top. Buildings: hero ×2–5, gable/flat, mixed rust/teal/tin/timber roofs.
- Sky: the HDRI is **camera-visible only** (Light Path Is Camera Ray mix) so lighting stays the tuned Sky Texture +
  sun; rotated so its glow sits on the sun side; faded into the haze at the horizon.
- Haze: depth-curved mist in the compositor (≈0 under 10 km, strong only far), warm peach→blue. AgX view; the "Punchy"
  look is not in this build, contrast comes from the compositor.
- Cycles GPU (CUDA), adaptive sampling, OIDN, ≤ 4 bounces. Timings on the 1660: preview 768×512 @24 spp ≈ 8 s;
  2304×1536 @192 spp ≈ 155–205 s. Volumetric clouds were tried and removed (speckle, flat discs).
- Labels JSON per shot (`<shot>_labels.json`): projected px, distance, `visible` from a **terrain-only BVH** ray test
  (anchor = summit/ground + max(40 m, 0.4% of distance)·exag; visible if hit ≥ 0.97 × target distance), dedupe within
  300 m, `label_elevation_m` = the listed value nearest the DEM summit (searched within 500 m) if within 250 m, else
  DEM + flag. Top-level `heading_deg`, `exag`.
- Extra modes: `--passes` (depth/normal/edges/segmentation for paint-over), `--paint-base` (no wave strata),
  `--bake-albedo <dir> [--bake-only "cx,cy;..."]` (atlas: per-chunk 384 px colour + 96 px AO bake; upper 340 chunks in
  683 s, lower 827 s).

### 4.5 Atlas pack (`atlas_pack.py`) — contract in `docs/atlas-pack-v1.md`
```
python backend/tools/atlas_pack.py swat [--no-bake] [--only terrain,albedo,trees,vectors,models,places,sky,check,files]
python backend/tools/atlas_pack.py swat_lower
```
- Per-pack settings in the `PACKS` dict (title, subtitle, bake shot, exag, explore areas, neighbors, tier thresholds).
- Output `data/packs/<slug>/atlas/`: `meta.json`, `height.bin` (uint16), `far.bin`, `albedo/L0..L3/{cx}_{cy}.webp`
  (384/192/96/48 px per 128-cell chunk = 3.84 km) + `overview.webp` + `far.webp`, `trees/{cx}_{cy}.bin`, `vectors.json`
  (lakes, rivers, roads by class paved|jeep|minor|track|path, buildings w/d/angle/roof, routes as OSM-backed pieces),
  `places.json` (slug, name, short_name ≤ 22 chars, name_ur, kind, tier, x/z, optional anchor (WorldCover built-up
  centre for towns: Kalam 606 m, Matiltan 375, Utror 321, Thal 283), label_elevation_m, summary, timeline, facts,
  access, photos with attribution, model, confidence), `models/*.glb` + attribution, `photos/`, `sky.jpg`, `cover.webp`,
  `files.json` (offline list), `_check.png` (alignment eyeball image).
- Explore-dock cameras live in `PACKS[...]["explore"]` as (name, lat, lon, heading°, pitch°, distance m). Current
  headings: swat Kalam & Ushu 10°, Utror & Gabral 15°, Mahodand 345°, Kumrat 20°; swat-lower all four 25° (chosen by
  viewing each framing: key places unobstructed, sun raking from the side). Change them HERE, never in `meta.json`.
- Tiers: 1 towns/villages + major lakes (`MAJOR_LAKES` + any lake ≥ 0.15 km²); 2 peaks ≥ 5,500 m (lower pack:
  ≥ 2,500) and heritage; 3 other lakes; 4 the rest. Low-confidence places excluded.
- Road class fallback from the OSM highway tag (`HWY_CLASS`): motorway/trunk/primary/secondary → paved; tertiary →
  jeep; unclassified/residential/service/living_street → minor; track; path/footway/steps/bridleway/cycleway → path.
- Seam check on albedo tiles: report mean/P99/max neighbour edge difference (last: 6.6 / 63 / 195, no visible seams).
- **Regression rule:** after any change to the pipeline, rebuild the upper pack with `--no-bake` and compare hashes of
  `places.json` / `vectors.json` / `meta.json` (meta may differ only by intended new keys). This was done for the
  generalisation and must be done again.

---

## 5. Reference look and lessons (the style bible)

### 5.1 The reference
The owner's reference (`C:\Users\zeesh\AppData\Local\Temp\claude\...\images\1.png`, an AI poster "Northern Pakistan —
Roof of the World"): low oblique camera with horizon and sky; golden-hour warm low sun, cool blue shadows, glowing
snow; ochre/golden-brown rock with dark strata; dense individual conifers; saturated turquoise water with white
rapids; hero-scale coloured landmarks; painted trucks, tents, villages; cloud banks in valleys; tilt-shift blur; dark
label chips with elevations and leader lines; spaced-caps serif title with an italic subtitle between rules; compass
rose. Its geography is fake (K2, Swat, Deosai, Saiful Muluk in one valley) — copy the look, never the layout.

### 5.2 Approved outputs (the bar)
`data/renders/swat/overview_poster.png` (best; whole upper Swat), `data/renders/swat/kalam_poster.png`,
`data/renders/swat-lower/lower_poster.png` (acceptable; dark lower third, Mingora pale), live-map shots in
`data/atlas_shots/`: `home_final.png`, `mingora_close.png`, `dock_switched.png`, `int_day_live.png`.

### 5.3 Colour targets (sample pixels to verify; numbers are sRGB 0–255 unless noted)
| Element | Target |
|---|---|
| Sunlit rock | ≈ (187,154,118) – (191,156,114); R/B 1.55–1.75. Pink (R/B ~1.7 with lavender) and grey-beige (171,153,141) were both rejected. |
| Snow sunlit / shade | peach-white / clearly blue; never clipped |
| Shadows | deep teal-blue, never milky grey, never black mud. Live map: shadowed ground keeps ≥ 45% of lit luminance. |
| Darkest forest pixels | ~15–25 (poster); forest floor dark green, NEVER maroon/brown |
| Water (linear) | rivers base (0.02,0.32,0.36); lakes (0.01,0.28,0.32) → (0.10,0.55,0.55); rendered sample e.g. (0,76,102)–(28,92,111); G and B ≥ 1.6·R |
| Trees (live) | #1F3A2C → #2E5236, warm sunlit top; never orange |
| Sun colour | (1.0, 0.72–0.78, 0.45–0.55); elevation 10–18° (6° made valleys black) |
| Haze | ~0 below 8–10 km, strong only beyond ~35 km, peach (0.93,0.74,0.62)/(1.0,0.78,0.60) at the horizon |

### 5.4 Lessons (each was a real failure; check for them every review)
1. **Milky / flat** — haze applied uniformly, lifted blacks. Fix: depth-curved haze + S-curve.
2. **Subject in shadow** — low sun behind ridges leaves Kalam black. Put the sun behind-left of the camera
   (azimuth ≈ camera heading + 180 ± 35°) and/or raise it to 12–18°.
3. **Pink clay rock** → **grey-beige overcorrection** → settle on ochre with AO. Adjust in small steps and sample.
4. **Orange trees** from too strong a warm tint.
5. **Rivers white** from grazing sky reflection: lower specular, saturate base.
6. **Rivers wider than the lake** at close range → distance-scaled widths, clip rivers out of lakes.
7. **Wave-texture strata** produce parallel bands that every downstream step (img2img) faithfully preserves. Never use
   directional procedural textures on terrain.
8. **Close-ups expose the 30 m DEM** (melted slopes). Wide views are the product; close-up stills need detail painting.
9. **Renderer regrading the albedo** (ochre grade → maroon, green override → everything green). The baked albedo IS
   the poster palette; render it as-is under neutral lighting; correct only small, targeted things.
10. **AgX washed colours out in three.js** → ACES default; `?tm=agx` remains for testing.
11. **Model scale inheritance**: a ×30 hero scale made the Swat Museum a 1 km block. Scale by distance with caps.
12. **Invisible heritage**: 20 m stupas vanish at 3 km → minimum 42 px on screen.

### 5.5 Poster labels (`poster_labels.py`)
`python backend/tools/poster_labels.py <render.png> <labels.json> --title "Swat Valley" --subtitle "Kalam · Utror · Ushu · Mahodand" --out <poster.png> [--heading DEG] [--max-dist-km N]`
Chip: near-black warm #15120f at ~88%, 1 px light border (#e9e2d3 at 35%), soft drop shadow; name white semibold,
second line elevation "5,918 m" for peaks/lakes/passes; light leader + white dot with dark outline; title in spaced
uppercase serif with an italic subtitle between thin rules; vector 8-point compass rotated by −heading (true north);
attribution line bottom-left including "Heights exaggerated ×<exag>" from the JSON; 2× supersampling. Priority:
towns/major lakes → heritage (tier 1.5) → villages (1.7) → big peaks → other lakes → other peaks; ≤ 14 labels; greedy
collision avoidance over 8 directions × distances; anchors within 4% of edges dropped; keep clear of title/compass.

### 5.6 AI detail paint-over (parked)
`paintover.py`: tiled (1024 px, 128 overlap) SDXL img2img on the beauty render, RealVisXL V5.0 fp16 + diffusers
controlnet-depth-sdxl-1.0 + controlnet-canny-sdxl-1.0 (all OpenRAIL++, commercial OK), denoise ~0.5, depth 0.75, canny
0.45 (≤0.3 on rock), per-tile prompt hints from segmentation, water/road/sky kept from the original. Geometry guard
(Chamfer edge distance, edge recall within 3 px, lake teal fraction, skyline shift) must be reported. Verdict: helps
close-ups only; hurt wide shots (haze, lost snow). Parked until a richer base render exists (no strata; satellite-
derived rock colour; curvature AO). Never use it on wide shots.

---

## 6. 3D models

### 6.1 Procedural stupas (`backend/tools/blender/stupa.py`, specs `data/models3d/specs/<slug>.json`)
Lathe profiles (48–64 segments) + square/round bases + stairs; dimensions from sources (cited in the spec) or
estimated from photos (flagged). Masonry textures generated in numpy (fine coursed stone on the drum, irregular rubble
only on the lower flared zone), grass on the dome top only, baked to 1–2k JPEG in GLB. Targets ≤ 8k tris, ≤ 1.6 MB,
metres, +Y up, origin at ground centre, base at y=0. Shingardar: 18.5 m tall (published 18 m); dome = quarter-ellipse
rising 0.32·D above the top band, masonry to ~66–70% then grass shell. Honest fidelity 4–6/10; fine at map scale.

### 6.2 TRELLIS buildings (`buildings3d.py`, `trellis_*` on RunPod)
Microsoft TRELLIS v1 (`TRELLIS-image-large`, MIT — confirmed from LICENSE + model card), multi-image conditioning,
3 seeds × 2 variants, best kept by eye, ≤ 20k tris, baked 1024 texture. Install notes: spconv-cu126 on Py 3.12,
nvdiffrast needs CPATH to torch's CUDA headers, diff-gaussian-rasterization is required (texture bake renders
gaussians), flexicubes submodule missing (stubbed), baker leaks VRAM → one process per seed. Results: White Palace
7/10, Thal mosque 6/10, Swat Museum 6/10 (front only; sides invented). The pack step normalises scale
(`SCALE_GUESS` footprints are estimates: White Palace 40 m, Thal 25 m, Museum 45 m), removes fragments < 2% and
below-ground parts. Front-facing direction is NOT verified.

### 6.3 Placement in the live map (`web/js/atlas/landmarks.js`)
Fixed scale, camera-independent: real size × the user multiplier from the "Landmark size" slider (×20–×80, default
×20, never below real size), displayed footprint cap 1 km, opacity fade out to 15 km, stands on the lowest ground
under its footprint, trees cleared within the default displayed footprint + 30%, warm emissive lift + soft contact shadow.

---

## 7. Atlas renderer (`web/atlas.html`, `web/js/atlas/*.js`)

three.js **0.160** from the importmap (jsdelivr). Modules (each ≲ 400 lines): `pack.js` (load, heightAt, groundY),
`terrain.js` (chunked LOD 128/64/32/16 with skirts, per-chunk albedo LRU, overview fallback, far backdrop discarded
inside the near rect), `material.js` (MeshStandardMaterial + onBeforeCompile; global half-float height-gradient texture
for normals/curvature; micro detail normal on high tier; custom display-space haze curve), `shade.js` (CPU horizon
sweep → long terrain shadows), `sky.js` (sky.jpg background, sun DirectionalLight 4.5, HemisphereLight sky #9cb0d8 /
ground #a08a66 1.8, a 4096 shadow map for trees/buildings/landmarks near the camera, fog start ~8 km), `trees.js`
(InstancedMesh per chunk, 3 silhouettes ≤ 40 tris, height = 30 m × scale × tree_scale × distance ramp (1.3 near → 2.5
far) × jitter, lean ±4°, none on slopes > 50°, cap 120 k high / 30 k low, radius 12 / 7 km), `ribbon.js` + `water.js`
+ `roads.js` (per-feature ribbons, capped miters, segments > 2 km dropped; minor roads 30%, hidden > 4 km; tracks
dashed 35%, hidden > 3 km; jeep 60% in close views; routes overlay off unless Treks/layer), `landmarks.js`, `labels.js`
(chips, ~10 Hz greedy layout, UI occluder rects + 4% edge margin, tier 1 tries 8 directions × 60/100/140 px before
dropping, heritage icons, hidden-by-ridge style), `panel.js` (place sheet), `day.js` (planner day ribbon + numbered
stops), `offline.js`, `sheet.js`, `controls.js` (OrbitControls, pitch −15…−80°, distance 1–90 km, bounded pan, above
ground + 150 m, double-click fly, home, compass resets north), `ui.js`, `dispose.js` (pack switching without GPU leaks —
verified: 210 geometries / 207 textures identical after swat → lower → swat), `main.js`.

URL params: `pack`, `base`, `tier=high|low`, `fps=1` (overlay), `tm=agx`. Tone mapping ACES, exposure 1.0. Default time
5:17 pm (sun ~15°). Budgets (high tier, 1600×1000): ≤ 600 draw calls, ≤ 4 M triangles, ≤ 120 k trees; measured home
210 calls / 0.52 M tris; Kalam close 2.78 M tris / 120 k trees; low tier 66 calls / 1.05 M / 30 k.

---

## 8. UI design system

Approved canvas (5 artboards: map home, place panel, trek, "Swat Through Time", phone): see link at top. Rules:
- **The map is the hero.** UI is warm near-black glass over it. Tokens (`web/css/atlas.css`): `--glass rgba(24,20,17,.94)`,
  `--glass-soft rgba(24,20,17,.86)`, `--line rgba(243,235,221,.16)`, `--line-2 rgba(243,235,221,.32)`,
  `--cream #f3ebdd`, `--muted #c9bda9`, faint ≈ #a39782, **one accent** `--saffron #e9a23b` with `--on-saffron #1a140d`.
  Label chip #15120f @ 88%. Water icon tint #7fd3cb, peak/town icon #e9c88f.
- **Type:** Cormorant SC 600 (titles, place names; spaced caps), Cormorant Garamond italic (subtitle between two thin
  rules), Schibsted Grotesk (interface; also the old app's UI face), Literata (story text), Noto Nastaliq Urdu (Urdu,
  `lang="ur" dir="rtl"`). No Inter/Roboto/Arial, no emoji, no gradient washes, no left-border cards.
- **Layout (desktop):** cartouche top-left with a soft radial dark glow (subtitle ≥ 3:1 as large text; measured 3.6:1);
  "← All places" link; top-right search (340 px) + icon buttons (download, layers, menu) and a "Light" pill with a
  time-of-day slider ("Golden hour · 5:17 pm"); bottom-centre Explore dock (pack areas; selected = saffron fill; the
  neighbour pack as a dashed "Lower Swat ↓ / Swat Valley ↑" item); bottom-right compass (56 px round), zoom ±, home;
  attribution footer bottom-left.
- **Place sheet:** right, 440 px; photo 236 px with its attribution caption ON the photo; kind line in saffron caps;
  name 38 px + Urdu name on the right; 3 stats; summary in Literata 16 px; buttons Fly there (saffron primary), Plan a
  day, Listen; "From the sources" as `<details>` revealing the verbatim quote + source link; labels under the sheet
  hidden. Empty history = honest empty state (e.g. nearby region event), never filler.
- **Phone (390×844):** one finger MOVES the map (OrbitControls `touches.ONE = PAN`), pinch zooms + two-finger twist
  rotates, double-tap flies to the tapped point (touch never synthesizes dblclick; detected in `main.js`); the title
  cartouche is one compact line, tap it to reveal the subtitle; the dock is one horizontally scrollable row of
  **44 px** pills inside `.dockwrap` (a right-edge fade hints at more items and hides at the scroll end), zoom/icon
  buttons 44 px; the layers menu shows **steppers (± 44 px) and 44 px toggle rows** instead of sliders (`paired()` in
  `ui.js` keeps the hidden desktop slider and the stepper in sync); the place panel is a **two-state sheet**: it opens
  as a peek card (max-height 40 vh: grab handle, photo, name, stats, action row) — tap the grab handle or swipe up for
  the full sheet, swipe down to collapse, again to close (`panel.js` `togglePeek` + drag states); label blockers track
  the current state (`onState` → `labels.block`), and place flights shift the camera target so the anchor lands in the
  free space above the card (`flyToPlace` in `main.js`, the planner ribbon's screen-space trick).
- Accessibility: real `<button>`/`<a>`/`<input>`+`<label>`, `aria-label` on icon buttons, touch targets ≥ 44 px,
  text 4.5:1 (3:1 at ≥ 24 px), colours distinguished by lightness too.

---

## 9. App integration (done in `38eba22`)
- `regions.py`: `swat` and `swat-lower` with `"atlas": "<pack slug>"`, landmarks = tiers 1–2 inside the bundle bbox,
  two tours each. `/api/region/<slug>` returns the atlas field.
- `atlaspack.py`: the planner/facts read stops, facts, roads, heights from the pack (no Wikipedia/Overpass refetch).
- Planner speeds by class: **paved 40, minor 25, jeep 14, track 9 km/h**, slope penalty on jeep/track floored at half
  speed, paths at walking pace. Kalam → Matiltan → Ushu → Mahodand = 32.3 km, 2 h 42 (sourced 2–3 h). The LLM
  occasionally returns 502; retry once.
- Atlas "Plan a day" opens the existing `renderPlanner` in a sheet, "Show this day" drapes a saffron ribbon with
  numbered stops and fits the camera. "Listen" uses `makeListen`; disabled "Audio guide coming soon" when no clips.
- Offline: download button → dialog showing size with/without photos (~98 / ~55 MB upper) → posts `files.json` URLs
  to the service worker like place.js did. **The actual SW save path is untested in automation** (headless has no SW):
  test once by hand in Chrome (DevTools → Application → Cache Storage `tinyatlas-data-v1`).
- Static site: `pack.py` copies Atlas packs into `dist/packs/<slug>/atlas/` and writes a static `atlas.html`
  respecting BASE; proven under a `/tinyatlas/` subpath.

### 9.1 Audio guide (in flight at handoff)
Pipeline: `narration.py` (LLM placard stories from sourced facts only; cached by prompt hash in `data/llm/`) →
`audio.py <regions>` on the pod after `tts_setup.sh` (Kokoro-82M en/zh, MMS-TTS Urdu) → `/api/audio/<slug>`. Verify:
clip counts per language, EN durations ~30–90 s, three stories spot-checked against sources (a lake, a stupa, a town),
Listen plays in the Atlas, clips included in offline save. Then **terminate the pod**.

---

## 10. GPU / RunPod procedure
1. Read before mutate: `list-pods` (should be empty except your own), `list-gpu-types` with
   `include=["AVAILABILITY"], product=["POD"], cloud="COMMUNITY"`. State the hourly price to the owner before creating.
2. Prefer community cloud: RTX A4000 16 GB ~$0.17/h (TTS, light jobs), RTX 3090 24 GB ~$0.22/h (SDXL, TRELLIS).
   Templates: `runpod-torch-v280` (PyTorch 2.8, CUDA ≥ 12.8) or ComfyUI CUDA 13.0 (`wgd3p4n4o6`). Pass
   `allowedCudaVersions` matching an AVAILABLE version or creation fails.
3. `startJupyter: true`; put `POD_ID` and the generated `JUPYTER_PASSWORD` into `.env` as `POD_JUPYTER_TOKEN` (back up
   `.env` first). Wait for `https://<id>-8888.proxy.runpod.net/api/status` to return 403/200. Use `pod_run.py` /
   `pod_files.py` (never put tokens in argv).
4. Long jobs: `setsid nohup ... > /workspace/x.log 2>&1 < /dev/null &` and poll.
5. **Stop or terminate as soon as the batch is done** and say so. Community pods may not restart later (the host's GPU
   gets taken) — so treat stopped pods as disposable. Only touch pods created in your own session.
6. Spend so far: well under $2 total.

---

## 11. How the work is orchestrated (the subagent model)

The owner asked for this explicitly: **the lead agent is architect + reviewer; implementation is delegated to Sonnet
subagents** with precise instructions, then judged and guided. Keep doing it this way.

### 11.1 Lead responsibilities (never delegate these)
- Decide the approach and write contracts (e.g. `docs/atlas-pack-v1.md`) BEFORE parallel agents start, so they can work
  independently against the same interface.
- Read enough code to write exact specs (paths, line numbers, schemas, constants).
- Review every output by LOOKING at images and data yourself (§12). Never forward an agent's self-assessment as fact.
- Own outward-facing and billable actions: RunPod create/stop/terminate, commits, pushes, releases, publishing.
- Talk to the owner: short status, plain language, decisions they must make (cost, scope, destructive changes).

### 11.2 Writing a subagent prompt (template that worked)
1. First line: "Be efficient and concise." Environment facts (OS, shells, Python, Blender path, GPU, repo, branch).
   "Do NOT commit." Ownership: files it may edit; files another agent owns right now ("don't touch X").
2. CONTEXT: what exists, where, which doc to READ FIRST (contract, README, specific modules), the reference images.
3. GOAL in one sentence + the product principle that constrains it.
4. INPUTS with exact paths and schemas.
5. Numbered STEPS with concrete parameters, formulas and thresholds (not "make it nice": "sun elevation 9–11°,
   azimuth 210–220°").
6. VERIFY: measurable checks the agent must run and report (sample RGB, counts, hashes, guard metrics, `pytest`), and
   "VIEW the image yourself (the Read tool shows images) and compare with <reference>".
7. Iteration budget ("max 4 previews, then a final") and time-boxes for risky installs.
8. Final reply format and word limit, always including "candid gaps".
Run independent agents in parallel (`run_in_background`); sequence dependent ones.

### 11.3 Steering agents
- Follow-ups go to the SAME agent via SendMessage (it keeps its context): "Round N" with a numbered fix list in
  priority order, each with the observed symptom, the likely cause, and the measurable target.
- When you diagnose the cause yourself, say it precisely (e.g. "build_scene.py lines ~352–382: the Wave texture drives
  colour and bump"). Own your mistakes in the message if your earlier spec caused the problem.
- When a rate limit kills an agent: resume it with "a rate limit interrupted you; check the current state of <files>
  so you don't double-apply; continue from where you stopped".
- When two agents touch the same file (it happened: the pack agent edited roads.js), tell the owner of that file to
  re-read it and which spec wins.
- When an agent edits generated data by hand, port the change back into the generator immediately. Precedent: the
  renderer agent re-aimed the 8 area cameras directly in `meta.json`; the generator still had 305°, so any rebuild
  would have reverted them. Fixed by porting the values into `atlas_pack.py`, rebuilding with `--only terrain`, and
  proving the new `meta.json` equals the hand-fixed one (and `height.bin` hash unchanged).
- Time-box polish: after 2–3 rounds without convergence on a detail that doesn't matter at product scale, stop, log the
  exact fix for later, and move on (the Shingardar grass cap; the paint-over).
- Agents may refuse unsafe shortcuts (spoofing a UA to bypass a 403) — that is correct; give them the compliant fix.

---

## 12. How work is judged (review protocol)

### 12.1 Always
1. **Look at it.** Open every output image with the Read tool (downscale big ones to ~1536 px first with PIL). For
   live-map changes, take your own screenshot with `atlas_shot.py` if the agent did not view one.
2. **Compare with the bar** (§5.2) side by side, and with the previous round.
3. **Measure, don't eyeball colours:** sample RGB in PIL at named points; compare with §5.3.
4. **Verify claims against data**, not against the agent's summary: e.g. recompute lake area from WorldCover, sample
   DEM summits (`rasterio` + `pyproj` EPSG:32643) for disputed heights, find built-up centroids, check the labels JSON.
5. **Check for regressions:** tests, hashes, the other pack, the phone layout.
6. **Read the diff** of anything touching the server (`api.py`), the planner, the service worker, before committing;
   scan for secrets (`grep -E "sk-or|POD_JUPYTER|<token>"`).

### 12.2 Acceptance criteria by artefact
| Artefact | Accept when |
|---|---|
| Geo bundle | preview shows rivers/roads in valley floors; Kalam ≈ 2,000 m; histogram plausible; river vertices well below local mean |
| Research entry | OSM/Wikidata coord in the right sub-valley; verbatim quotes; licence-clean photos; confidence honest |
| Poster render | reads as the reference look; subject lit; no milky haze; colours inside §5.3; nothing moved; labels truthful (sourced heights, visibility) |
| Labels | correct heights (listed value checked vs DEM summit), tier-1 places present, no clipping by UI/edges, hidden places styled hidden |
| 3D model | silhouette and proportions match the photo at the compare angle; real metres; on the ground; size budgets |
| Live map | matches the poster at home view; close views not mud/not all-green; no streaks; budgets within limits; no console errors except expected 404s; panel matches the design; phone layout works |
| Integration | tests pass; planner times plausible against sources; offline list complete; static build works under a subpath |
| Paint-over | geometry guard numbers reported and not worse than the beauty; visibly better; never for wide shots |

### 12.3 Red flags that always mean "send it back"
- An agent says "looks good" without having viewed the image; reports a number it "estimated from the preview".
- A fix that changes colours globally to fix a local problem (regrading).
- Any invented coordinate, height or fact; any line drawn across a data gap.
- A label shown for something you cannot see, or a tier-1 place silently dropped.
- Hand-edited generated files without the generator updated.
- Times or distances that contradict a cited source by a wide margin (the 1 h 10 jeep-road plan).
- Anything that would publish or spend money without the owner's go-ahead.

---

## 13. Verification commands
```
python -m pytest -q                                     # from repo root; 120 tests, no network
cd backend && uvicorn tinyatlas.api:app --port 8000     # dev server (serves /packs and the web app)
python backend/tools/atlas_shot.py data/atlas_shots/x.png --pack swat --wait 4000 [--size 390x844 --tier low]
       [--view '{"e":..,"n":..,"heading":..,"pitch":..,"dist":..}'] [--eval JS] [--fps]
python backend/tools/smoke.py                           # end-to-end browser check of the app against the server
python -c "from PIL import Image; im=Image.open('x.png').convert('RGB'); print(im.getpixel((x,y)))"   # sample colours
```
Headless screenshots use SwiftShader: FPS from them is meaningless; draw calls / triangles / instance counts are valid.

---

## 14. Known defects and open items (fix in this order)
1. ~~Area camera headings not in the generator~~ — RESOLVED 2026-10-02 (see §4.5 and §11.3).
2. **Audio guide**: local bake-off (Kokoro/Chatterbox) was in flight in the working tree (`audio_local.py`,
   `tts_bakeoff.py`, `narration.py`, `listen.js`, `atlaspack.py` audio chunk slug) — uncommitted, not reviewed here.
   The old RunPod TTS pod `s9p3rr2my88itr` no longer serves (proxy 404 on every endpoint; no RunPod API key in `.env`
   to stop/terminate it) — if it still shows in the RunPod console, terminate it there.
3. **Offline save** never exercised with a real service worker: test by hand in Chrome.
4. **White Palace** — PARTLY RESOLVED 2026-10-02: the listed 2,175 m (Wikidata) was wrong; the DEM at the OSM pin is
   1,308 m and the label now uses it (gazetteer note added). TRELLIS silhouette verified against the photo (colonnaded
   veranda, central pediment, ~3:1 massing match); mesh artifacts at both flanks (floating fragments > the 2 % drop
   threshold) don't read at map scale. Absolute size stays a flagged estimate (no published dimensions). The pin sits
   33 m from an OSM stream — coordinate is sourced (OSM + Wikidata agree), so it stands; slope is 15°.
5. ~~Phone labels: chip shows while its anchor is off-screen~~ — RESOLVED 2026-10-02 (`labels.js`: candidates require
   the anchor dot inside the viewport).
6. **Lower Swat poster**: lower third too dark, Mingora pale, Elum/Malam Jabba not prominent, Barikot at the edge;
   White Palace and Shingardar below the frame.
7. **Close views** still darker than the posters in shade; trees read as simple cones up close.
8. **Lower Swat roads** were classified from highway tags only (no surface/tracktype review).
9. **Missing places/routes** (§3.3): need GPX or a checkable source. One Overpass tile (72.9–73.2 E, 35.55–35.85 N)
   never completed.
10. Shingardar grass cap smaller/raggeder than the photo (cosmetic at map scale).
11. Photos are ~43 MB of the upper pack: consider ≤ 1200 px and ≤ 4 per place for offline.

### 14.1 Accuracy pass 2026-10-02 (label elevations + pack hygiene; packs rebuilt, diffs reviewed)
- `label_elevation` now DEM-checks EVERY kind, not just peaks (±250 m, ±500 m for lakes — GLO-30 smooths cirque
  basins so published lake levels are the better value), and receives the ground sampled on the grid that actually
  contains the place (`Grid.sample` clamps out-of-bounds queries to the raster edge, so a far-grid place sampled
  against the near raster returned mountain heights). Fixes shipped: White Palace 2,175→1,308; Malam Jabba 2,804→2,486
  (pin is the hotel node); Lowari Tunnel 0→3,168 and Malakand Pass 0→1,088 (were literal zeros); Madyan 3,094→1,365,
  Miandam 3,458→1,823, Sheringal 3,228→1,456, Fatehpur 4,092→1,289, Jarogo waterfall 3,792→2,409 (stale values from
  an older gazetteer); Bashigram Lake 2,831→3,492; Ghochhar Sar label 4,497→6,249 with the summit snapped (dispute
  note in the gazetteer) and tier 4→2. Passes use the ground at the point, not a summit search.
- `step_models` now ships a model only with a place of that pack (areas + near/far bbox, same rule as `step_places`)
  and deletes stale model files: the upper pack carries only the Thal mosque, the lower pack its 7 (~6 MB less per
  pack, offline saves no longer cache dead models). Peak `ground_m` is sampled at the snapped pin.
- Model audit (measured, not guessed): stupas match their sourced specs (Amluk-Dara 34 m base/18.6 m tall, Saidu
  19.6 m plinth, Shingardar 18.6 m vs published 18 m, Gumbat podium 6.6 m); TRELLIS GLBs are 4.7–5.8 k tris with one
  1024 px bake each. The `SCALE_GUESS` widths (40/25/45 m) remain the only size anchor for the TRELLIS three.
- Live-map textures (`landmarks.js`): roughness clamped into a 0.55–0.95 matte band instead of forced ≥ 0.8, warm
  emissive lift 0.45→0.18, texture anisotropy 8 — the baked 1024 textures now read up close without losing the
  lift that makes maquettes visible against pale ground.

---

## 15. Next: the owner's approved plan (execute in order)
1. **Finish audio**, verify, terminate the pod (§10).
2. **Swat-only cleanup** — DONE in v2.1 (see `docs/CLEANUP-v2.1.md`). The method, for future cleanups:
   a. Build a reachability map from the entry points that remain: `web/index.html` → `main.js` → `home.js` (gallery,
      two Swat cards) and `web/atlas.html` → `js/atlas/*` (+ the planner/listen modules it imports), and the API
      endpoints those call (`/api/regions`, `/api/region`, `/api/plan`, `/api/audio`, facts, `/packs`).
   b. Delete everything unreachable: the Diorama (`place.js`, `scene.js`, `light.js`, `models.js`, `views.js`,
      `viewshed.js`, `panorama.js`, `keepsake.js`, `sun.js` if unused, the old poster/flat-map mode, `css/app.css` parts
      only the Diorama used), non-Swat regions in `regions.py`, "Build any place" (`builder.py`, `jobs.py`,
      `geocode.py`, their endpoints), backend modules and endpoints nothing calls anymore, tools for removed features,
      `web/models/*.glb` if unused, and the tests of removed code. Keep the Atlas pipeline tools.
   c. Present the full deletion list to the owner (or in the release notes) — git history keeps everything recoverable.
   d. Update README (Swat-only, the new run/build flow), the service worker shell list, the manifest.
   e. `pytest`, `smoke.py` (update it for the new app), screenshots of gallery + both packs + phone.
3. **Release** — v2.0.0 DONE (procedure below worked; note: fetch `origin/gh-pages` first, the local ref can be stale):
   a. Commit on `swat-illustrated-map`; merge into `main` (fast-forward or merge commit; no force-push); `git push origin main`.
   b. `git tag -a v2.0.0 -m "..."`; `git push origin v2.0.0`; `gh release create v2.0.0 --notes-file <notes>` (notes:
      what's new, data sources + licences, known issues from §14).
   c. Static site: find how v1.0.0 was published to `gh-pages` (inspect that branch's last commit and README "Static
      site"), then `python backend/tools/pack.py --api <live api url or none> --base-url <pages url>` → `dist/`, publish
      `dist/` to `gh-pages` the same way. Packs total ~270 MB (GitHub Pages limit 1 GB; no file near 100 MB). Check the
      live site loads both packs.
   d. Report the URLs to the owner.

---

## 16. Attribution block (must appear in the app and posters)
"Contains modified Copernicus DEM GLO-30 data … · © ESA WorldCover project 2021 (CC BY 4.0) · Imagery: Sentinel-2
cloudless 2016 by EOX IT Services GmbH (CC BY 4.0) · © OpenStreetMap contributors (ODbL) · Photos via Wikimedia Commons,
each credited · Sky: Poly Haven (CC0) · 3D shapes: TRELLIS (MIT), procedural stupas · Heights exaggerated ×<n>,
places drawn larger than life."
