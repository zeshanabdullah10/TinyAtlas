import io
import json
import re
import time
from functools import lru_cache
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import BaseModel

from . import (builder, facts, geocode, guide, jobs, llm, osm, paint, planner, regions, sources, terrain, tiles,
               viewshed)
from .regions import REGIONS

app = FastAPI(title="Tiny Atlas")
ROOT = Path(__file__).resolve().parents[2]

# The static site (a CDN) calls this server only for live AI features; list its origin(s) in TINYATLAS_CORS.
_origins = [o.strip() for o in (llm._env("TINYATLAS_CORS") or "").split(",") if o.strip()]
if _origins:
    app.add_middleware(CORSMiddleware, allow_origins=_origins, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

# Per-visitor limits on the endpoints that cost money (LLM calls). In memory: fine for one server process.
LIMITS = {"plan": (12, 3600), "guide": (60, 3600)}          # calls per window (seconds)
_calls: dict[tuple[str, str], list[float]] = {}


def _rate_limit(request: Request, kind: str) -> None:
    n, window = LIMITS[kind]
    ip = request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "?")
    now = time.time()
    recent = [t for t in _calls.get((kind, ip), []) if now - t < window]
    if len(recent) >= n:
        raise HTTPException(429, "You've asked a lot in the last hour. Please try again a little later.")
    _calls[(kind, ip)] = recent + [now]
THUMBS = ROOT / "data" / "thumbs"
MAX_QUEUED_BUILDS = 3


def _region(name: str) -> dict:
    if name not in REGIONS:
        raise HTTPException(404, "unknown region")
    return REGIONS[name]


SEASONS = ("spring", "summer", "autumn", "winter")


def _texture_path(name: str, style: str = "auto", season: str = "summer") -> Path | None:
    tail = "" if season == "summer" else f"_{season}"
    ai, painted = tiles.OUT / name / f"texture_ai{tail}.png", tiles.OUT / name / f"texture{tail}.png"
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


def _cover(name: str) -> dict | None:
    """The picture for the place's card: its first viewpoint's evening preview (autumn, else any season)."""
    p = ROOT / "data" / "views" / name / "views.json"
    if not p.exists():
        return None
    for v in json.loads(p.read_text(encoding="utf-8")):
        for season in ("autumn", "summer", "spring", "winter"):
            img = v["images"].get(season, {}).get("evening")
            if img:
                return {"image": img, "view": v["name"], "labels": v["labels"]}
    return None


def _summary(name: str, cfg: dict) -> dict:
    w, h = terrain.bbox_size_m(cfg["bbox"])
    return {"name": cfg["name"], "subtitle": cfg.get("subtitle", ""), "bbox": cfg["bbox"],
            "center": cfg.get("center"), "tz": cfg.get("tz"), "view_from": cfg.get("view_from"),
            "builtin": bool(cfg.get("builtin")), "ready": _ready(name),
            "seasons": [s for s in SEASONS if _texture_path(name, season=s)], "cover": _cover(name),
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
            intro, url = sources.clean_lead(paras[0])[:420], page["url"]
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


@lru_cache(maxsize=8)
def _wide(name: str):
    return viewshed.region_wide(_region(name))


@lru_cache(maxsize=8)
def _near(name: str):
    return viewshed.near_grid(_region(name))


def _grid_response(hm, bbox) -> Response:
    """Binary grid: uint32 rows, uint32 cols, float32 width_m, float32 height_m, float64 x4 bbox (west, south, east,
    north), int16[rows*cols] metres (row 0 = north)."""
    w, h = terrain.bbox_size_m(bbox)
    head = (np.array(hm.shape, dtype="<u4").tobytes() + np.array([w, h], dtype="<f4").tobytes()
            + np.array(bbox, dtype="<f8").tobytes())
    return Response(head + np.clip(hm, -500, 9000).round().astype("<i2").tobytes(), media_type="application/octet-stream")


@app.get("/api/horizon/{region}")
def horizon_grid(region: str):
    """The panorama's elevation grid, reaching well beyond the region (see _grid_response for the format)."""
    hm, bbox, _ = _wide(region)
    return _grid_response(hm, bbox)


@app.get("/api/near/{region}")
def near_grid(region: str):
    """The region itself at about 40 m, for the panorama's close terrain (same format)."""
    return _grid_response(*_near(region))


@app.get("/api/peaks/{region}")
def region_peaks(region: str):
    """Named peaks from OpenStreetMap across the panorama grid."""
    _, bbox, _ = _wide(region)
    try:
        return viewshed.named_peaks(bbox)
    except RuntimeError as exc:
        raise HTTPException(502, str(exc))


VIEWS = ROOT / "data" / "views"


@app.get("/api/views/{region}")
def region_views(region: str):
    """Viewpoints with their painted previews (see backend/tools/previews.py); [] when none have been made."""
    _region(region)
    p = VIEWS / region / "views.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else []


@app.get("/api/view-image/{region}/{name}")
def view_image(region: str, name: str):
    _region(region)
    p = VIEWS / region / name
    if not re.fullmatch(r"[a-z0-9-]+_[a-z]+_[a-z]+\.jpg", name) or not p.exists():
        raise HTTPException(404, "no such picture")
    return FileResponse(p, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})


@app.get("/api/pois/{region}")
def region_pois(region: str):
    """Hospitals, fuel, ATMs and police from OpenStreetMap, for Go mode ([] if Overpass is unavailable)."""
    try:
        return osm.pois(_region(region)["bbox"])
    except RuntimeError:
        return []


AUDIO = ROOT / "data" / "audio"


@app.get("/api/audio/{region}")
def region_audio(region: str):
    """{landmark slug: {lang: {file, seconds, text}}} for the audio guide; {} when none has been made."""
    _region(region)
    p = AUDIO / region / "audio.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


@app.get("/api/audio-file/{region}/{name}")
def audio_file(region: str, name: str):
    _region(region)
    p = AUDIO / region / name
    if not re.fullmatch(r"[a-z0-9-]+\.(en|ur|zh)\.m4a", name) or not p.exists():
        raise HTTPException(404, "no such recording")
    return FileResponse(p, media_type="audio/mp4", headers={"Cache-Control": "public, max-age=86400"})


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
def ask_guide(region: str, body: Ask, request: Request):
    question = body.question.strip()[:500]
    if not question:
        raise HTTPException(400, "empty question")
    _rate_limit(request, "guide")
    _region(region)
    return guide.answer(question, _chunks(region), body.history)


@app.get("/api/itinerary/{region}")
def region_itinerary(region: str):
    """The region's first curated tour when it has one, otherwise a route worked out from its landmarks."""
    cfg = _region(region)
    bbox = cfg["bbox"]
    try:
        feats = osm.features(bbox)
        roads, trails = feats["road"], feats.get("trail")
    except RuntimeError:
        roads, trails = None, None            # Overpass down and nothing cached: fall back to straight legs
    tours = cfg.get("tours") or []
    tour = [sources.slugify(t) for t in tours[0]["stops"]] if tours else None
    it = guide.itinerary(region_landmarks(region), roads, terrain.bbox_size_m(bbox), trails, tour=tour)
    return {**it, "name": tours[0]["name"]} if tours else it


@app.get("/api/facts/{region}")
def region_facts(region: str):
    """Practical facts, each checked against a quote in its Wikivoyage/Wikipedia source (cached per region)."""
    _region(region)
    try:
        return facts.extract(region, _chunks(region))
    except llm.LLMUnavailable:
        return {"checked": None, "facts": []}


class PlanRequest(BaseModel):
    request: str
    month: int | None = None
    current: dict | None = None


@app.post("/api/plan/{region}")
def plan_trip(region: str, body: PlanRequest, request: Request = None):
    cfg = _region(region)
    text = body.request.strip()[:600]
    if not text:
        raise HTTPException(400, "tell the planner about your trip")
    if request is not None:
        _rate_limit(request, "plan")
    if not llm.available():
        raise HTTPException(503, "The planner needs an AI model, and this server has none configured.")
    month = body.month if body.month and 1 <= body.month <= 12 else time.gmtime().tm_mon
    try:
        return planner.plan(region, cfg, region_landmarks(region), region_facts(region)["facts"], text, month,
                            body.current)
    except llm.LLMUnavailable as exc:
        raise HTTPException(502, f"The planner couldn't make a plan just now ({exc}). Try again in a moment.")


@app.get("/api/status")
def status():
    return {"llm": llm.available(), "model": llm.model(), "usage": llm.usage_totals()}


@app.get("/api/texture/{region}")
def region_texture(region: str, style: str = "auto", season: str = "summer"):
    """Region texture (row 0 = north). style=ai|painted|auto; auto prefers the AI-stylised texture when it exists.
    season=spring|summer|autumn|winter. A painted texture is generated on first request, then cached on disk."""
    _region(region)
    if style not in ("auto", "ai", "painted"):
        raise HTTPException(400, "style must be auto, ai or painted")
    if season not in SEASONS:
        raise HTTPException(400, "season must be spring, summer, autumn or winter")
    path = _texture_path(region, style, season)
    if path is None and style == "ai":
        raise HTTPException(404, "no AI texture for this region and season yet (run backend/tools/stylize.py)")
    if path is None:
        path = paint.paint_region(region, REGIONS[region]["bbox"], season=season)
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
