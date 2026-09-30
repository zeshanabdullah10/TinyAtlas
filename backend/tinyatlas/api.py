import numpy as np
from functools import lru_cache

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from pydantic import BaseModel

from . import guide, llm, osm, paint, sources, terrain, tiles
from .regions import REGIONS

app = FastAPI(title="Tiny Atlas")


def _region(name: str) -> dict:
    if name not in REGIONS:
        raise HTTPException(404, "unknown region")
    return REGIONS[name]


@lru_cache(maxsize=None)
def _landmarks(name: str) -> list[dict]:
    return sources.landmarks(_region(name))


@lru_cache(maxsize=None)
def _chunks(name: str) -> list[dict]:
    return sources.chunks(_region(name))


class Ask(BaseModel):
    question: str
    history: list[dict] = []


@app.get("/api/regions")
def regions():
    return {k: {"name": v["name"], "bbox": v["bbox"]} for k, v in REGIONS.items()}


@app.get("/api/terrain/{region}")
def terrain_mesh(region: str, size: int = 256):
    """Binary: uint32 rows, uint32 cols, float32 width_m, float32 height_m, float32[rows*cols] heights."""
    if region not in REGIONS:
        raise HTTPException(404, "unknown region")
    bbox = REGIONS[region]["bbox"]
    hm = terrain.heightmap(bbox, size=min(max(size, 16), 1024)).astype(np.float32)
    w, h = terrain.bbox_size_m(bbox)
    head = np.array([hm.shape[0], hm.shape[1]], dtype="<u4").tobytes() + np.array([w, h], dtype="<f4").tobytes()
    return Response(head + hm.astype("<f4").tobytes(), media_type="application/octet-stream")


@app.get("/api/features/{region}")
def region_features(region: str, buildings: bool = False):
    """OSM polylines in normalised (u east, v south) coords, grouped by kind."""
    if region not in REGIONS:
        raise HTTPException(404, "unknown region")
    try:
        return osm.features(REGIONS[region]["bbox"], buildings=buildings)
    except RuntimeError as exc:
        raise HTTPException(502, str(exc))


@app.get("/api/landmarks/{region}")
def region_landmarks(region: str):
    try:
        models = Path(__file__).resolve().parents[2] / "web" / "models"
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
    return guide.answer(question, _chunks(region), body.history)


@app.get("/api/itinerary/{region}")
def region_itinerary(region: str):
    return guide.itinerary(region_landmarks(region))


@app.get("/api/status")
def status():
    return {"llm": llm.available(), "model": llm.model(), "usage": llm.usage_totals()}


@app.get("/api/texture/{region}")
def region_texture(region: str):
    """Painted region texture (row 0 = north). Generated on first request, then cached on disk."""
    if region not in REGIONS:
        raise HTTPException(404, "unknown region")
    path = tiles.OUT / region / "texture.png"
    if not path.exists():
        path = paint.paint_region(region, REGIONS[region]["bbox"])
    return FileResponse(path, media_type="image/png")


WEB = Path(__file__).resolve().parents[2] / "web"
if WEB.exists():
    app.mount("/", StaticFiles(directory=WEB, html=True), name="web")
