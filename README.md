# Tiny Atlas

Turn a real region into an illustrated miniature 3D map. Geometry comes from open data
(OSM + elevation), so nothing about the terrain, roads or rivers is invented. Landmarks and the guide
come from Wikipedia/Wikivoyage text. An LLM (optional) only rephrases what was retrieved.

MVP region: **Hunza Valley** (Gilgit-Baltistan, Pakistan).

## Run
```
pip install -r backend/requirements.txt
cd backend && uvicorn tinyatlas.api:app --port 8000
# open http://localhost:8000/?region=hunza
python -m pytest            # from the repo root (no network needed)
```
First load fetches elevation tiles, OSM (Overpass, ~3 min for Hunza) and Wikipedia text, then caches
everything under `data/` (gitignored). Later loads are instant.

## What you get
- Textured 3D terrain: painted from the DEM (hillshade, toon-banded colours, snow line, water, roads), then
  restyled into a hand-painted look by ComfyUI (below); the painted version is the GPU-free fallback
- Landmarks with little 3D models; click one for its story and Wikipedia link
- A dotted route that follows the OSM road network between the sights (shortest order by road distance;
  sights far from any road, like summits, stay as markers but are not route stops)
- "Ask the guide": answers only from retrieved Wikipedia/Wikivoyage text, cites sources, and says
  "That isn't in my sources for this region." when it can't answer
- "Fly the route" camera flight, plus exports (below)

## LLM (optional)
Without a key the guide quotes the best-matching source sentences (`mode: extractive`), which is
literal and cannot bridge synonyms (the sources say "apricots", a question about "crops" is refused).
To use an LLM:
```
# .env in the repo root (gitignored)
OPENROUTER_API_KEY=sk-or-...
TINYATLAS_MODEL=deepseek/deepseek-v4.1-flash     # OpenRouter slug; verify it on openrouter.ai
```
Every answer is cached by prompt hash in `data/llm/`; token usage is appended to `data/llm/usage.jsonl`
and shown at `/api/status`, so spend can be checked against the budget.

## Tools (`backend/tools/`)
| Command | What it does |
|---|---|
| `python backend/tools/make_tiles.py hunza 3 3` | Depth + line passes per overlapping tile (ControlNet inputs) |
| `python backend/tools/make_texture.py hunza` | Paint the region texture (GPU-free) |
| `python backend/tools/stylize.py hunza` | AI-stylise the tiles via ComfyUI (`COMFY_URL`) and blend `texture_ai.png` |
| `python backend/tools/smoke.py` | End-to-end check: real click on a landmark, guide answer + refusal, no console errors |
| `python backend/tools/eval_guide.py` | Guide check against the real sources |
| `python backend/tools/screenshot.py URL out.png [--open SLUG] [--ask Q] [--frame T]` | Headless screenshot (Edge) |
| `python backend/tools/export.py video hunza` | 20 s flyover MP4 -> `data/export/` (needs ffmpeg) |
| `python backend/tools/export.py poster hunza` | Print poster PDF (4800 px wide art) -> `data/export/` |

Landmark models: drop a generated `web/models/<slug>.glb` (e.g. from Hunyuan3D) and it replaces the
procedural model automatically.

## AI stylisation (ComfyUI, on a rented GPU)
The viewer prefers `data/tiles/<region>/texture_ai.png` when it exists and falls back to the painted texture
(`/api/texture/<region>?style=auto|ai|painted`). To (re)generate it:
1. Start a ComfyUI pod with a 24 GB GPU (the Hunza run used a community RTX 3090 at $0.22/hr and the official
   "ComfyUI - CUDA 13.0" template) and put these in its `models/` folder:
   `checkpoints/v1-5-pruned-emaonly.safetensors` (stable-diffusion-v1-5/stable-diffusion-v1-5),
   `controlnet/control_v11f1p_sd15_depth.pth` and `controlnet/control_v11p_sd15_lineart.pth` (lllyasviel/ControlNet-v1-1).
2. `COMFY_URL=https://<pod>-8188.proxy.runpod.net python backend/tools/stylize.py hunza`
   Each tile is img2img (denoise 0.55) from the painted tile, pinned by the depth + line passes, same seed for
   every tile; overlaps are feather-blended and OSM water is painted back on top. Styled tiles are cached in
   `data/tiles/<region>/styled/`, so re-runs only pay for missing tiles. All 9 Hunza tiles took about 1 minute.
3. Terminate the pod. `backend/tools/pod_run.py` runs a shell command on a pod via its Jupyter terminal (handy
   for the model downloads).

Known artefacts: a cracked-mud pattern on large snow plateaus and a dendritic pattern on some snowfields.
Raising `--denoise` makes it more painterly; lowering it keeps more of the painted base.

## Not done yet
- **Hunyuan3D landmark models** (illustration -> GLB; needs ~12 GB VRAM and the Hunyuan3D ComfyUI nodes/weights).
  Landmarks use procedural models until then.
- No custom style LoRA yet; the look comes from the base SD1.5 checkpoint and the prompt in `stylize.py`.
- OSM buildings are fetched best-effort (`/api/features/hunza?buildings=true`) and not drawn; Overpass often
  504s on the dense bbox.

## Attribution
Elevation: Mapzen/AWS Terrain Tiles. Map data © OpenStreetMap contributors (ODbL).
Landmark and guide text © Wikipedia / Wikivoyage contributors (CC BY-SA); every answer links its source page.
