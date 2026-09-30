import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from . import osm, paint, terrain, tiles
from .regions import REGIONS

app = FastAPI(title="Tiny Atlas")


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
