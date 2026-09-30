# Tiny Atlas

Miniature 3D maps of real places, shown like museum objects. Every miniature is drawn from open elevation and
map data, so nothing about the terrain, roads or water is invented. Landmarks and the guide come from Wikipedia and
Wikivoyage text; the guide only answers from what it retrieved and says so when it can't.

Search any town, mountain or landmark and Tiny Atlas builds a miniature of it in about a minute.

## Run
```
pip install -r backend/requirements.txt
cd backend && uvicorn tinyatlas.api:app --port 8000
# open http://localhost:8000
python -m pytest            # from the repo root, no network needed
python backend/tools/smoke.py   # end-to-end browser check against the running app
```
The collection ships with Hunza Valley (AI watercolour texture) and Zermatt, Mount Fuji, Machu Picchu and Yosemite
Valley (painted texture), all built by the same pipeline you get from "Add a place". Data is cached under `data/`
(gitignored), so a fresh checkout rebuilds them on first use: `python backend/tools/build_region.py "Zermatt" "Mount Fuji"`.

## What you can do
- **Browse and add places.** The home page is a gallery. "Add a place" searches Nominatim, lets you pick the right
  match (there are many Cappadocias), then builds it in the background with visible progress: landmarks from Wikipedia
  geosearch, elevation tiles, OpenStreetMap roads, trails and water, the painted texture, and the guide's sources.
- **Explore the miniature.** Terrain on a walnut plinth, landmarks as small models with labels that step aside for each
  other and for the panels, a vertical-scale slider, layers, a compass, share links (`?region=hunza&lm=baltit-fort`),
  and a saved picture with the attribution baked in.
- **Follow the route.** Landmarks are joined in the shortest order by road distance (footpaths where there are no roads).
  The list shows distance between stops and the elevation profile; scrub the profile to move a marker along the map.
  Summits and glaciers only become stops when a road or path passes right beside them.
- **Fly the route.** A camera flight that keeps clear of the terrain, with a caption for each stop.
- **Ask the guide.** Cited answers from Wikipedia and Wikivoyage. Without an LLM key it quotes the best-matching
  sentences; with one, it puts the retrieved text into words and is told to refuse when the excerpts don't answer.
- **Phone-friendly.** Panels become bottom sheets. Keyboard shortcuts: `F` fly, `R` reset, `L` labels, `/` guide, `?` help.

## Design
The concept is a museum vitrine: a lichen-grey gallery wall, placard-white labels, a walnut plinth. The one big moment
is the terrain rising out of the plinth on entry (skipped under reduced motion). Type is Schibsted Grotesk for titles
and interface and Literata for stories. Tokens live in `web/css/tokens.css`; the only saturated colours are content
(the route and the water). Contrast is at least 4.5:1 for text on every surface it appears on.

## Architecture
```
backend/tinyatlas/  regions (registry)  geocode  discover (landmarks)  sources (Wikipedia/Wikivoyage)  guide (RAG, route)
                    terrain  osm  paint  tiles  routing  llm  builder+jobs  stylize (AI pass)  api (FastAPI)
web/                index.html  css/{tokens,app}.css  js/{main,home,place,scene,models,api,dom}.js  (Three.js from a CDN)
backend/tools/      build_region  make_texture  stylize  export  smoke  screenshot  eval_guide  pod_run
```

## LLM (optional)
```
# .env in the repo root (gitignored)
OPENROUTER_API_KEY=sk-or-...
TINYATLAS_MODEL=deepseek/deepseek-v4.1-flash     # OpenRouter slug
```
Every answer is cached by prompt hash in `data/llm/`, empty completions are never cached, and token use is appended to
`data/llm/usage.jsonl` and shown at `/api/status`.

## AI watercolour texture (optional, needs a rented GPU)
The viewer prefers `data/tiles/<region>/texture_ai.png` and falls back to the painted texture.
1. Start a ComfyUI pod with a 24 GB GPU and put `v1-5-pruned-emaonly.safetensors` (checkpoints),
   `control_v11f1p_sd15_depth.pth` and `control_v11p_sd15_lineart.pth` (controlnet) in its `models/` folder.
2. `COMFY_URL=https://<pod>-8188.proxy.runpod.net python backend/tools/stylize.py <region>`
   Each tile is img2img from the painted tile, pinned by depth and line passes, blended across overlaps, with OSM water
   painted back on top. Styled tiles are cached, so re-runs only pay for missing tiles (about a minute for nine tiles).
3. Terminate the pod. `backend/tools/pod_run.py` runs a shell command on a pod through its Jupyter terminal.

Only Hunza has the AI texture so far. Known artefacts: a cracked-mud pattern on some large snow plateaus.

## Exports
`python backend/tools/export.py video <region>` writes a 20 s flyover MP4 and `... poster <region>` a print PDF, both to
`data/export/` (needs ffmpeg and an installed Edge or Chrome).

## Not done
- Hunyuan3D landmark models (illustration to GLB; needs about 12 GB VRAM). Landmarks use procedural models; drop a
  `web/models/<slug>.glb` and it replaces one automatically.
- AI texture for the four newer regions.
- OSM buildings are fetched on request (`/api/features/<region>?buildings=true`) but not drawn; Overpass often times out on
  dense areas. Place search runs on submit, not while typing, as Nominatim's usage policy asks.
- Anyone who can reach the server can add or remove places; there is no login. Run it locally or behind your own auth.

## Attribution
Elevation: Mapzen and AWS Terrain Tiles. Map data © OpenStreetMap contributors (ODbL). Place search by Nominatim.
Landmark photos and text © Wikipedia and Wikivoyage contributors (CC BY-SA, each linked to its page).
