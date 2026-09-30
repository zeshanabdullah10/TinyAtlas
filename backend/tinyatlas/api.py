import io
from functools import lru_cache
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import BaseModel

from . import builder, geocode, guide, jobs, llm, osm, paint, regions, sources, terrain, tiles
from .regions import REGIONS

app = FastAPI(title="Tiny Atlas")
ROOT = Path(__file__).resolve().parents[2]
THUMBS = ROOT / "data" / "thumbs"
MAX_QUEUED_BUILDS = 3


def _region(name: str) -> dict:
    if name not in REGIONS:
        raise HTTPException(404, "unknown region")
    return REGIONS[name]


def _texture_path(name: str, style: str = "auto") -> Path | None:
    ai, painted = tiles.OUT / name / "texture_ai.png", tiles.OUT / name / "texture.png"
    if style in ("auto", "ai") and ai.exists():
        return ai
    if style in ("auto", "painted") and painted.exists():
        return painted
    return None


def _ready(name: str) -> bool:
    return _texture_path(name) is not None


@lru_cache(maxsize=None)
def _landmarks(name: str) -> list[dict]:
    return sources.landmarks(_region(name))


@lru_cache(maxsize=None)
def _chunks(name: str) -> list[dict]:
    return sources.chunks(_region(name))


class Ask(BaseModel):
    question: str
    history: list[dict] = []


class Build(BaseModel):
    query: str
    name: str | None = None
    subtitle: str | None = None
    lat: float | None = None
    lon: float | None = None


def _summary(name: str, cfg: dict) -> dict:
    w, h = terrain.bbox_size_m(cfg["bbox"])
    return {"name": cfg["name"], "subtitle": cfg.get("subtitle", ""), "bbox": cfg["bbox"],
            "center": cfg.get("center"), "builtin": bool(cfg.get("builtin")), "ready": _ready(name),
            "size_km": [round(w / 1000, 1), round(h / 1000, 1)], "landmarks": len(cfg.get("landmarks", []))}


@app.get("/api/regions")
def list_regions():
    return {k: _summary(k, v) for k, v in REGIONS.items()}


@app.get("/api/region/{region}")
def region_details(region: str):
    """Summary plus an intro paragraph (from the first guide page) for the header."""
    cfg = _region(region)
    intro, url = "", ""
    for host, title in cfg.get("guide_pages", [])[:2]:
        try:
            page = sources.fetch_page(host, title)
        except Exception:
            continue
        paras = [p.strip() for p in page["text"].split("\n\n") if len(p.strip()) > 80 and not p.startswith("=")]
        if paras and not page["missing"]:
            intro, url = paras[0][:420], page["url"]
            break
    return {**_summary(region, cfg), "intro": intro, "intro_url": url}


@app.get("/api/geocode")
def geocode_search(q: str):
    if len(q) > 120:
        raise HTTPException(400, "query too long")
    try:
        return geocode.search(q)
    except Exception as exc:
        raise HTTPException(502, f"place search is unavailable: {exc}")


@app.post("/api/build")
def build_region(body: Build):
    """Start (or reuse) a build. Returns {status: done, result: slug} for an existing region, else a job."""
    query = body.query.strip()[:120]
    if not query:
        raise HTTPException(400, "type a place name")
    place = None
    if body.lat is not None and body.lon is not None:
        if not (-90 <= body.lat <= 90 and -180 <= body.lon <= 180):
            raise HTTPException(400, "coordinates out of range")
        place = {"name": (body.name or query)[:80], "subtitle": (body.subtitle or "")[:120],
                 "lat": body.lat, "lon": body.lon}
    else:
        try:
            found = geocode.search(query)
        except Exception as exc:
            raise HTTPException(502, f"place search is unavailable: {exc}")
        if not found:
            raise HTTPException(404, f"No place found for “{query}”. Try a town, a mountain or a landmark name.")
        place = found[0]
    slug = regions.slugify(place["name"])
    if slug in REGIONS and _ready(slug):
        return {"status": "done", "result": slug}
    if sum(1 for j in jobs.JOBS.values() if j.status in ("queued", "running")) >= MAX_QUEUED_BUILDS:
        raise HTTPException(429, "Several miniatures are already being built. Try again in a few minutes.")
    return builder.start(query, place).to_dict()


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "unknown job")
    return job.to_dict()


@app.delete("/api/regions/{region}")
def delete_region(region: str):
    if region in regions.BUILTIN:
        raise HTTPException(403, "built-in regions can't be removed")
    if not regions.remove(region):
        raise HTTPException(404, "unknown region")
    _landmarks.cache_clear()
    _chunks.cache_clear()
    return {"removed": region}


@app.get("/api/terrain/{region}")
def terrain_mesh(region: str, size: int = 256):
    """Binary: uint32 rows, uint32 cols, float32 width_m, float32 height_m, float32[rows*cols] heights."""
    bbox = _region(region)["bbox"]
    hm = terrain.heightmap(bbox, size=min(max(size, 16), 1024)).astype(np.float32)
    w, h = terrain.bbox_size_m(bbox)
    head = np.array([hm.shape[0], hm.shape[1]], dtype="<u4").tobytes() + np.array([w, h], dtype="<f4").tobytes()
    return Response(head + hm.astype("<f4").tobytes(), media_type="application/octet-stream")


@app.get("/api/features/{region}")
def region_features(region: str, buildings: bool = False):
    """OSM polylines in normalised (u east, v south) coords, grouped by kind."""
    try:
        return osm.features(_region(region)["bbox"], buildings=buildings)
    except RuntimeError as exc:
        raise HTTPException(502, str(exc))


@app.get("/api/landmarks/{region}")
def region_landmarks(region: str):
    try:
        models = ROOT / "web" / "models"
        return [{**l, "model": (models / f"{l['slug']}.glb").exists()} for l in _landmarks(region)]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, f"could not load landmarks: {exc}")


@app.get("/api/story/{region}/{slug}")
def landmark_story(region: str, slug: str):
    lm = next((l for l in region_landmarks(region) if l["slug"] == slug), None)
    if lm is None:
        raise HTTPException(404, "unknown landmark")
    return {**guide.story(lm, _chunks(region)), "name": lm["name"], "url": lm["url"]}


@app.post("/api/guide/{region}")
def ask_guide(region: str, body: Ask):
    question = body.question.strip()[:500]
    if not question:
        raise HTTPException(400, "empty question")
    _region(region)
    return guide.answer(question, _chunks(region), body.history)


@app.get("/api/itinerary/{region}")
def region_itinerary(region: str):
    bbox = _region(region)["bbox"]
    try:
        roads = osm.features(bbox)["road"]
    except RuntimeError:
        roads = None            # Overpass down and nothing cached: fall back to straight legs
    return guide.itinerary(region_landmarks(region), roads, terrain.bbox_size_m(bbox))


@app.get("/api/status")
def status():
    return {"llm": llm.available(), "model": llm.model(), "usage": llm.usage_totals()}


@app.get("/api/texture/{region}")
def region_texture(region: str, style: str = "auto"):
    """Region texture (row 0 = north). style=ai|painted|auto; auto prefers the AI-stylised texture when it exists.
    The painted texture is generated on first request, then cached on disk."""
    _region(region)
    if style not in ("auto", "ai", "painted"):
        raise HTTPException(400, "style must be auto, ai or painted")
    if style == "ai" and not (tiles.OUT / region / "texture_ai.png").exists():
        raise HTTPException(404, "no AI texture for this region yet (run backend/tools/stylize.py)")
    path = _texture_path(region, style)
    if path is None:
        path = paint.paint_region(region, REGIONS[region]["bbox"])
    return FileResponse(path, media_type="image/png")


@app.get("/api/thumb/{region}")
def region_thumb(region: str, w: int = 560):
    """Small JPEG of the region texture for the gallery, cached and rebuilt when the texture changes."""
    _region(region)
    src = _texture_path(region)
    if src is None:
        raise HTTPException(404, "not built yet")
    w = min(max(w, 120), 1200)
    THUMBS.mkdir(parents=True, exist_ok=True)
    out = THUMBS / f"{region}_{w}.jpg"
    if not out.exists() or out.stat().st_mtime < src.stat().st_mtime:
        im = Image.open(src).convert("RGB")
        im = im.resize((w, round(w * im.height / im.width)), Image.LANCZOS)
        im.save(out, quality=86, optimize=True)
    return FileResponse(out, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=300"})


WEB = ROOT / "web"
if WEB.exists():
    app.mount("/", StaticFiles(directory=WEB, html=True), name="web")
