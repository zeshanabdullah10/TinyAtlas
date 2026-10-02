# Cleanup v2.1: the app becomes Swat-only

Owner decision (HANDOFF section 15.2). Everything below is recoverable from git history. Method: reachability from
`web/index.html` (landing page), `web/atlas.html` (Atlas renderer + planner + offline), the API calls those make
(`/api/plan`, `/api/status`, `/api/audio*`, `/packs`), the static-site builder and the Atlas pipeline tools.

## Deleted: web (19 files)
| File | Reason |
|---|---|
| `web/js/place.js`, `scene.js`, `light.js`, `models.js`, `views.js`, `viewshed.js`, `panorama.js`, `keepsake.js`, `sun.js` | The old Diorama interface; no remaining page imports them. |
| `web/css/app.css` | Styles of the Diorama and the old gallery; replaced by `css/home.css`. |
| `web/models/*.glb` (7: altit-fort, baltit-fort, hussaini-suspension-bridge, manthal-buddha-rock, raikot-bridge, shigar-palace, skardu-fort) | Hunza/Skardu maquettes; Atlas models ship inside each pack. |

Trimmed, not deleted: `web/js/api.js` (only `audio`, `audioUrl`, `plan`, `status` remain), `web/js/dom.js` (unused
helpers and the landmark-kind icons removed), `web/css/tokens.css` (lichen-grey museum palette replaced by the Atlas
palette), `web/icon.svg`, `manifest.webmanifest` (Swat name, dark colours), `web/sw.js` (shell list for the new home,
cache `tinyatlas-shell-v2`, old shell caches deleted on activate, dead URL patterns removed).

## Deleted: backend modules (13) and their tests (10)
| File | Reason |
|---|---|
| `tinyatlas/builder.py`, `jobs.py`, `geocode.py`, `discover.py` | "Build any place". |
| `tinyatlas/paint.py`, `tiles.py` | Painted textures and tile cache for non-Atlas places. |
| `tinyatlas/views.py`, `viewshed.py` | View previews and the panorama viewshed (Diorama only). |
| `tinyatlas/guide.py` | Extractive Q&A, stories and itineraries for the Diorama; the Atlas does not call it. |
| `tinyatlas/sources.py`, `osm.py`, `terrain.py` | Wikipedia/Overpass/terrain-tile fetching for non-Atlas places; the planner's non-Atlas branch (which used them) was removed. Atlas data comes from the pack. |
| `tinyatlas/facts.py` | LLM fact extraction from Wikivoyage for non-Atlas places. `/api/facts` stays and serves the pack's sourced facts through `atlaspack.facts`. |
| `tests/test_build.py`, `test_guide.py`, `test_facts.py`, `test_osm.py`, `test_paint.py`, `test_regions_geo.py`, `test_sources.py`, `test_terrain.py`, `test_tiles.py`, `test_viewshed.py` | Tests of the removed code. |

Kept on purpose: `stylize.py` (ComfyUI helpers that the parked `paintover.py` imports) with `test_stylize.py`;
`routing.py`, `sun.py`, `planner.py`, `llm.py`, `narration.py`, `atlaspack.py`.

## Rewritten
| File | Change |
|---|---|
| `tinyatlas/regions.py` | Only `swat` and `swat-lower`. Removed hunza, skardu, fairy-meadows, naran, deosai, khunjerab, the user-built `data/regions/*.json` handling (save/remove/dynamic registry) and unused keys (snowline, viewpoints, guide_pages, tz). The six leftover files in `data/regions/` (lake-louise, machu-picchu, mount-fuji, skardu, yosemite-valley, zermatt) are untracked data and are now ignored. |
| `tinyatlas/api.py` | From 433 to about 130 lines (see endpoints below). |
| `tinyatlas/planner.py` | Atlas path only: `_network`, `_fastest`, `_leg` and the OSM/terrain catalogue removed. |
| `backend/tools/pack.py` | Static site = web/ + the two Atlas packs (+ audio clips when `data/audio/<slug>/` has them) + sitemap (landing page and each map) + robots.txt; no per-place static pages; canonical and Open Graph URLs made absolute with `--base-url`. |
| `backend/tools/smoke.py` | New end-to-end check of the landing page, both packs, the planner sheet and the offline dialog. |
| `README.md` | Swat-only. |
| `backend/tests/test_api.py`, `test_pack.py`, `test_atlas.py` | Rewritten or adjusted for the new app (120 tests down to 53; every removed test covered deleted code). |

## Deleted: tools (16)
`build_region.py` (build any place), `make_texture.py`, `make_tiles.py`, `stylize.py` (painted/AI textures for non-Atlas
places), `previews.py` (view previews), `panorama.py`, `check_viewshed_port.mjs` (viewshed), `models3d.py`,
`h3d_setup.sh`, `h3d_worker.py` (Hunyuan3D maquettes for the old places), `screenshot.py`, `smoke.py` (old UI; rewritten),
`export.py` (flyover/poster of the Diorama), `eval_guide.py` (the guide is gone), `try_planner.py` (facts extractor
and non-Atlas planner).

## Removed endpoints
| Endpoint | Reason |
|---|---|
| `GET /api/geocode`, `POST /api/build`, `GET /api/jobs/{id}`, `DELETE /api/regions/{slug}` | Build any place. |
| `GET /api/terrain`, `/api/horizon`, `/api/near`, `/api/peaks`, `/api/features` | Diorama terrain and panorama grids. |
| `GET /api/views`, `/api/view-image` | View previews. |
| `GET /api/texture`, `/api/thumb` | Painted textures and gallery thumbnails. |
| `GET /api/pois` | Go mode (Diorama). |
| `GET /api/landmarks`, `/api/story`, `/api/itinerary`, `POST /api/guide` | Diorama guide; `api.region_landmarks()` stays as a Python helper for the planner and `tools/audio.py`. |

Kept: `GET /api/regions`, `/api/region/{slug}`, `/api/facts/{slug}`, `POST /api/plan/{slug}`, `GET /api/status`,
`/api/audio/{slug}`, `/api/audio-file/{slug}/{name}`, and the `/packs` static mount.

## Not touched (owned by the audio-guide work)
These still mention removed things and need a follow-up once the audio guide lands: `backend/tools/audio.py`
docstring and examples say `hunza skardu` (use `swat swat-lower`); `audio.py` calls `api.region_landmarks` and
`api._chunks`, which are kept. `narration.py` and `atlaspack.py` were not edited. Nothing in `web/js/listen.js` or
`web/js/atlas/panel.js` depends on a deleted file (listen.js uses `api.audio`/`api.audioUrl`, both kept).

## New (landing page)
`web/index.html`, `web/css/home.css`, `web/js/home.js`, `web/js/main.js` (rewritten), `web/data/home.json`,
`web/img/hero-1600.webp`, `hero-800.webp`, `og.jpg`, and `backend/tools/home_data.py` which regenerates the data and
pictures from the packs and `data/research/swat_timeline.json`.
