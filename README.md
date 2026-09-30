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
- Textured 3D terrain (painted from the DEM: hillshade, toon-banded elevation colours, snow line, water, roads)
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
| `python backend/tools/eval_guide.py` | Guide check against the real sources |
| `python backend/tools/screenshot.py URL out.png [--open SLUG] [--ask Q] [--frame T]` | Headless screenshot (Edge) |
| `python backend/tools/export.py video hunza` | 20 s flyover MP4 -> `data/export/` (needs ffmpeg) |
| `python backend/tools/export.py poster hunza` | Print poster PDF (4800 px wide art) -> `data/export/` |

Landmark models: drop a generated `web/models/<slug>.glb` (e.g. from Hunyuan3D) and it replaces the
procedural model automatically.

## Not done yet
- **AI stylisation pass** (ComfyUI depth+line ControlNet + style LoRA over the tile passes): the tile passes
  and overlap exist, but this machine has no SD/ControlNet models and only 6 GB VRAM.
- **Hunyuan3D landmark models** need ~12 GB VRAM (rented GPU).
- OSM buildings are fetched best-effort (`/api/features/hunza?buildings=true`) and not drawn; Overpass often
  504s on the dense bbox.

## Attribution
Elevation: Mapzen/AWS Terrain Tiles. Map data © OpenStreetMap contributors (ODbL).
Landmark and guide text © Wikipedia / Wikivoyage contributors (CC BY-SA); every answer links its source page.
