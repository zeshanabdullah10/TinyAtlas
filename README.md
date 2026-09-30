# Tiny Atlas

A free travel companion for Northern Pakistan's valleys, built on 3D miniatures of the real terrain. See the view from
the best spots at any season and time of day, work out which summits you're looking at, plan a trip on the real roads,
and carry an audio guide that works with no signal.

**The rule everything follows: real data sets the facts, AI only paints, speaks and plans on top of them.** Terrain,
roads, water, summits, sunlight and travel times are computed from open data. Image models are pinned to that
geometry, the planner may only choose among measured options, extracted facts must quote their source, and anything
generated is labelled.

## What a traveller can do
- **See the view before you go** (Views tab). Every curated viewpoint has pictures for four seasons and three times
  of day, painted by SDXL over a depth image ray-cast from the real skyline, with water seeded where OpenStreetMap
  puts it. Summit names are laid over from the viewshed, never painted in.
- **What can I see from here?** Tap anywhere (or "What can I see from here?" on a landmark) for a 360° drawing of the
  skyline with every visible named summit, earth curvature and refraction included, the day's sun path drawn across
  it, and "Match my photo" to lay the labels over your own picture.
- **Real sun and seasons** (the sun button). Real shadows on the terrain for any date and time on the place's clock,
  one tap for sunrise, golden hour and sunset, "Play the day", and season textures that follow the date.
- **Plan by talking to the map** (Plan tab). Describe the trip; the planner picks stops into days, and every distance,
  time and altitude is recomputed by the server, with warnings for long days and fast altitude gain. Each day draws
  on the map.
- **Know before you go** (Place tab). Practical facts from Wikivoyage and Wikipedia, each kept only if its quote is
  really in the source.
- **Listen** (Place tab). Every landmark's placard plays its story in English, Urdu or Mandarin, with the text to
  read along; "Save for offline" (the download button) caches the whole place for the valley with no signal.
- **My trip.** Drop in trip photos: they are pinned by GPS and turned into a short film, all in the browser.
- **Ask the guide**, **fly the route**, share links, pictures, and "Build any place" for anywhere else.

## Run
```
pip install -r backend/requirements.txt
cd backend && uvicorn tinyatlas.api:app --port 8000         # open http://localhost:8000
python -m pytest                                          # from the repo root, no network needed
python backend/tools/smoke.py                             # end-to-end browser check against the running app
```
Built-in places live in `backend/tinyatlas/regions.py`: Hunza, Skardu, Fairy Meadows, Naran and Kaghan, Deosai and
Khunjerab, each with hand-checked landmarks, tours and viewpoints. Data is cached under `data/` (gitignored).

## Static site (what goes public)
```
python backend/tools/pack.py --api https://api.example.org --base-url https://tinyatlas.example.org
```
writes `dist/`: the app, one pack per place under `packs/<slug>/` (terrain, textures per season, panorama grids,
previews, audio, facts, points of interest), an indexable page per place under `place/<slug>/`, `sitemap.xml` and
`robots.txt`. Serve it from any CDN (Cloudflare Pages, GitHub Pages). Only the guide and the planner call the live
server; run that anywhere with `TINYATLAS_CORS=https://tinyatlas.example.org` and an OpenRouter key. Both endpoints
are rate limited per visitor (`LIMITS` in `api.py`).

## LLM
```
# .env in the repo root (gitignored)
OPENROUTER_API_KEY=sk-or-...
TINYATLAS_MODEL=deepseek/deepseek-v4.1-flash          # default for every task
TINYATLAS_MODEL_PLANNER=...                           # optional per task: _PLANNER, _EXTRACT, _NARRATION, _GUIDE
```
Answers are cached by prompt hash in `data/llm/`; empty replies are retried once and never cached; usage is logged to
`data/llm/usage.jsonl` and shown at `/api/status`.

## GPU batch jobs (RunPod)
All GPU work is precomputed; nothing runs on a GPU per visitor. With a ComfyUI pod (official "ComfyUI" template) and
`POD_ID` / `POD_JUPYTER_TOKEN` in `.env`:

| Job | Command | Models |
|---|---|---|
| Season textures | `COMFY_URL=... python backend/tools/stylize.py <region> --season autumn` | SD1.5 + depth/lineart ControlNet |
| View previews | `COMFY_URL=... python backend/tools/previews.py <region>` (`--dry` for depth only) | RealVisXL v5 + SDXL depth ControlNet |
| Audio guide | `python backend/tools/audio.py <region>` (needs `tts_setup.sh` run on the pod once) | Kokoro-82M (en, zh), MMS-TTS Urdu |
| Landmark models | `python backend/tools/models3d.py <region>` (needs `h3d_setup.sh` once) | Hunyuan3D-2 shape |

`pod_run.py` runs a command on the pod and `pod_files.py` copies files, both through Jupyter. Everything is cached,
so re-runs only pay for what is missing. Stop or terminate the pod when a batch is done.

## Tools
`panorama.py lat lon` lists the summits visible from a point; `try_planner.py region "request"` runs facts and the
planner from the shell; `screenshot.py` takes app screenshots (`--sun`, `--eval`, `--open`); `export.py` writes a
flyover video or print poster; `check_viewshed_port.mjs` checks the JS viewshed against Python.

## Design
A museum vitrine: a lichen-grey gallery wall, placard-white labels, a walnut plinth, plaster-white landmark
maquettes. Schibsted Grotesk for interface, Literata for stories, Noto Nastaliq Urdu for Urdu. Tokens live in
`web/css/tokens.css`; the only saturated colours are content (route, water, the sun).

## Architecture
```
backend/tinyatlas/  regions  terrain  osm  paint  tiles  stylize  routing  guide  sources  discover  geocode
                    sun  viewshed  views  planner  facts  narration  llm  builder+jobs  api (FastAPI)
web/js/             main  home  place  scene  light  sun  viewshed  panorama  views  planner  listen  keepsake  models  api  dom
web/                sw.js (offline)  manifest.webmanifest
backend/tools/      pack  stylize  previews  audio  models3d  panorama  try_planner  pod_run  pod_files  screenshot  export  smoke
```
`sun.js` and `viewshed.js` are line-for-line ports of their Python modules; keep them in step.

## Known limits
- Seasonal colours and snow are typical conditions, not a forecast; the app says so.
- Travel times are estimates from road steepness and walking pace, not traffic or road closures.
- Summit names depend on OpenStreetMap; a peak missing there is missing from the panorama.
- Place building has no login: run the full server locally or behind your own auth; the public site is static.

## Attribution
Elevation: Mapzen and AWS Terrain Tiles. Map data, summits and points of interest © OpenStreetMap contributors (ODbL).
Place search by Nominatim. Landmark photos and text © Wikipedia and Wikivoyage contributors (CC BY-SA, each linked).
View previews painted with RealVisXL; voices by Kokoro-82M and Meta MMS-TTS; landmark shapes by Tencent Hunyuan3D-2.
