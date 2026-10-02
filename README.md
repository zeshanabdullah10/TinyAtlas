# Tiny Atlas: Swat

A true-to-the-ground, illustrated 3D map of Swat, Pakistan (Khyber Pakhtunkhwa). Upper Swat (Kalam, Utror, Ushu,
Mahodand, Kumrat) and Lower Swat (Mingora, the Gandhara stupas, Udegram, Barikot, Malam Jabba) are drawn in a
golden-hour poster style, while every ridge, river, road and place sits at its real coordinates.

**The rule everything follows: real data sets the facts, AI only paints.** Terrain, roads, water, places, heights,
distances and travel times come from open data. Image models are pinned to that geometry, the day planner may only
choose among measured options, every fact carries a verbatim quote from its source, and exaggeration (heights,
landmarks drawn larger than life) is labelled on the map.

## What a visitor can do
- **Open the landing page** (`/`): two valley cards with real figures read from the packs, a "Swat through time"
  strip of six eras with sources, and a plain statement of how the map is made.
- **Explore the map** (`/atlas.html?pack=swat` or `?pack=swat-lower`): fly, tilt and zoom a real-time 3D relief map,
  switch between the areas in the Explore dock, search places, and slide the sun through any time of day (default
  golden hour).
- **Read a place**: tap a label for its story, timeline and facts, each quoted from its source with a link, plus
  credited photos.
- **Plan a day** on the real roads: describe the trip, and the planner picks from the map's places; every leg is
  measured on the pack's roads with times by road type (paved 40, minor 25, jeep 14, track 9 km/h, slope-adjusted),
  shown as estimates, and drawn on the map.
- **Save a valley for offline** (download button): the whole pack goes into the service worker's cache.

The audio guide (narration and voices) is in progress and ships in the next release.

## Run
```
pip install -r backend/requirements.txt
cd backend && uvicorn tinyatlas.api:app --port 8000     # open http://localhost:8000
python -m pytest -q                                      # from the repo root, no network needed
python backend/tools/smoke.py                            # browser check of the running app (needs Playwright + Edge)
```
The server serves `web/` and the built packs under `/packs`. The two places are defined in
`backend/tinyatlas/regions.py`; each points at an Atlas pack in `data/packs/<slug>/atlas/` (gitignored, see below).

## Data and build pipeline
Everything under `data/` is generated and gitignored. Full step-by-step, with parameters and lessons, is in
`docs/HANDOFF.md`; the pack format is in `docs/atlas-pack-v1.md`.
```
python backend/tools/geo_bundle.py swat --bbox 72.10 35.30 72.90 35.85 --res 30     # DEM, land cover, satellite, OSM
python backend/tools/blender/prep.py data/bundles/swat                                # de-lit albedo, trees, lakes
blender -b -P backend/tools/blender/build_scene.py -- --bundle data/bundles/swat ...  # poster renders, albedo bake
python backend/tools/atlas_pack.py swat                                               # bundle + research -> Atlas pack
python backend/tools/home_data.py                                                     # landing-page stats, timeline, hero art
```
Other tools: `collect_photos.py` (licence-filtered Commons photos), `poster_labels.py`, `atlas_shot.py` (headless
screenshots), `buildings3d.py` + `trellis_*` (landmark shapes on a RunPod GPU), `paintover.py` (parked), `pod_run.py`
and `pod_files.py` (RunPod via Jupyter), `audio.py` and `tts_*` (audio guide, in progress).

## Static site
```
python backend/tools/pack.py --api https://api.example.org --base-url https://tinyatlas.example.org
```
writes `dist/`: the landing page, `atlas.html`, `packs/swat/atlas/` and `packs/swat-lower/atlas/`, `sitemap.xml` and
`robots.txt`. It works under a subpath (GitHub Pages: `--base-url https://user.github.io/tinyatlas`). Only the day
planner needs the live server; run it with `TINYATLAS_CORS=<site origin>` and an OpenRouter key. The planner is rate
limited per visitor (`LIMITS` in `api.py`).

## LLM
```
# .env in the repo root (gitignored)
OPENROUTER_API_KEY=sk-or-...
TINYATLAS_MODEL=deepseek/deepseek-v4.1-flash          # default for every task
TINYATLAS_MODEL_PLANNER=...                           # optional per task
```
Replies are cached by prompt hash in `data/llm/` and usage is shown at `/api/status`.

## Layout
```
backend/tinyatlas/  api (FastAPI)  regions  atlaspack  planner  routing  sun  llm  narration  stylize (used by paintover)
backend/tools/      Atlas pipeline, pack.py (static site), smoke.py, home_data.py, RunPod and audio tools
web/                index.html + js/home.js (landing), atlas.html + js/atlas/* (renderer and UI), planner.js, listen.js,
                    api.js, dom.js, css/{tokens,home,atlas}.css, sw.js (offline), manifest, data/home.json, img/
docs/               HANDOFF.md, atlas-pack-v1.md, CLEANUP-v2.1.md
```

## Design
Warm near-black glass over the picture, cream type, one saffron accent (`#e9a23b`). Cormorant SC for titles,
Cormorant Garamond italic for subtitles, Schibsted Grotesk for the interface, Literata for prose, Noto Nastaliq Urdu
for Urdu names. Tokens live in `web/css/tokens.css`.

## Known limits
- Heights are exaggerated and landmarks drawn larger than life; the map says so.
- Travel times are estimates from road class and slope, not traffic or closures.
- Some places have no verifiable coordinates yet and are left out rather than guessed (see `docs/HANDOFF.md` section 3.3).

## Attribution
Contains modified Copernicus DEM GLO-30 data, © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018,
provided under COPERNICUS by the European Union and ESA. © ESA WorldCover project 2021 (CC BY 4.0). Imagery:
Sentinel-2 cloudless 2016 by EOX IT Services GmbH (CC BY 4.0). © OpenStreetMap contributors (ODbL). Photos via
Wikimedia Commons, each credited (CC0, public domain, CC BY or CC BY-SA). Sky: Poly Haven (CC0). 3D shapes: TRELLIS
(MIT) and procedural stupas. Facts and history from Wikipedia and Wikidata (CC BY-SA), each linked.
