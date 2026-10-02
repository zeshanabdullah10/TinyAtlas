import json
import re
import time
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import atlaspack, llm, planner
from .regions import REGIONS

app = FastAPI(title="Tiny Atlas")
app.add_middleware(GZipMiddleware, minimum_size=1000)
ROOT = Path(__file__).resolve().parents[2]

# The static site (a CDN) calls this server only for the live planner; list its origin(s) in TINYATLAS_CORS.
_origins = [o.strip() for o in (llm._env("TINYATLAS_CORS") or "").split(",") if o.strip()]
if _origins:
    app.add_middleware(CORSMiddleware, allow_origins=_origins, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

# Per-visitor limits on the endpoints that cost money (LLM calls). In memory: fine for one server process.
LIMITS = {"plan": (12, 3600)}          # calls per window (seconds)
_calls: dict[tuple[str, str], list[float]] = {}


def _rate_limit(request: Request, kind: str) -> None:
    n, window = LIMITS[kind]
    ip = request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "?")
    now = time.time()
    recent = [t for t in _calls.get((kind, ip), []) if now - t < window]
    if len(recent) >= n:
        raise HTTPException(429, "You've asked a lot in the last hour. Please try again a little later.")
    _calls[(kind, ip)] = recent + [now]


def _region(name: str) -> dict:
    if name not in REGIONS:
        raise HTTPException(404, "unknown region")
    return REGIONS[name]


@lru_cache(maxsize=None)
def _landmarks(name: str) -> list[dict]:
    cfg = _region(name)
    return atlaspack.landmarks(cfg["atlas"], cfg)


@lru_cache(maxsize=None)
def _chunks(name: str) -> list[dict]:
    cfg = _region(name)
    return atlaspack.chunks(cfg["atlas"], cfg)


def _summary(name: str, cfg: dict) -> dict:
    w, h = atlaspack.size_m(cfg["atlas"]) if atlaspack.available(cfg["atlas"]) else (0.0, 0.0)
    return {"name": cfg["name"], "subtitle": cfg.get("subtitle", ""), "bbox": cfg["bbox"], "center": cfg.get("center"),
            "ready": atlaspack.available(cfg["atlas"]), "atlas": cfg["atlas"], "atlas_cover": atlaspack.cover_url(cfg["atlas"]),
            "size_km": [round(w / 1000, 1), round(h / 1000, 1)], "landmarks": len(cfg.get("landmarks", []))}


@app.get("/api/regions")
def list_regions():
    return {k: _summary(k, v) for k, v in REGIONS.items()}


@app.get("/api/region/{region}")
def region_details(region: str):
    return _summary(region, _region(region))


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


def region_landmarks(region: str) -> list[dict]:
    """The region's configured places with their pack stories (the planner and tools/audio.py read these)."""
    _region(region)
    return _landmarks(region)


@app.get("/api/facts/{region}")
def region_facts(region: str):
    """Sourced facts for the region's places, read from its pack."""
    return atlaspack.facts(_region(region)["atlas"], _region(region))


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


PACKS = ROOT / "data" / "packs"
PACKS.mkdir(parents=True, exist_ok=True)
app.mount("/packs", StaticFiles(directory=PACKS), name="packs")   # Atlas packs (docs/atlas-pack-v1.md)

WEB = ROOT / "web"
if WEB.exists():
    app.mount("/", StaticFiles(directory=WEB, html=True), name="web")
