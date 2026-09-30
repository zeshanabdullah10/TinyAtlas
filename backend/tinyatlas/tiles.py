"""Tile passes: split a region into overlapping tiles and render the ControlNet inputs.

depth.png : 8-bit grey, brighter = higher, normalised with the *region-wide* min/max so
            every tile shares one height scale (needed for consistent style across tiles).
line.png  : white lines on black (roads, rivers, lake outlines) for a lineart ControlNet.
"""
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from . import osm, terrain

OUT = Path(__file__).resolve().parents[2] / "data" / "tiles"


@dataclass(frozen=True)
class Tile:
    ix: int
    iy: int
    bbox: tuple[float, float, float, float]  # west, south, east, north

    @property
    def name(self) -> str:
        return f"{self.ix}_{self.iy}"


def tile_grid(bbox, nx: int, ny: int, overlap: float = 0.125) -> list[Tile]:
    """nx * ny tiles covering bbox; each tile is grown by `overlap` (fraction of a tile) on
    every side (clamped to bbox) so neighbours share a blend zone."""
    w, s, e, n = bbox
    tw, th = (e - w) / nx, (n - s) / ny
    tiles = []
    for iy in range(ny):  # iy 0 = north row
        for ix in range(nx):
            tw0, tn0 = w + ix * tw, n - iy * th
            tiles.append(Tile(
                ix, iy,
                (max(w, tw0 - overlap * tw), max(s, tn0 - th - overlap * th),
                 min(e, tw0 + tw + overlap * tw), min(n, tn0 + overlap * th)),
            ))
    return tiles


def region_range(bbox, z: int = 11) -> tuple[float, float]:
    hm = terrain.heightmap(bbox, z=z, size=256)
    return float(hm.min()), float(hm.max())


def depth_image(tile: Tile, lo: float, hi: float, size: int = 1024, z: int = 13) -> Image.Image:
    hm = terrain.heightmap(tile.bbox, z=z, size=size)
    g = np.clip((hm - lo) / max(hi - lo, 1e-6), 0, 1)
    return Image.fromarray((g * 255).astype(np.uint8), "L")


def line_image(tile: Tile, feats: dict, region_bbox, size: int = 1024) -> Image.Image:
    """Rasterise region-normalised OSM polylines into this tile's pixel space."""
    rw, rs, re_, rn = region_bbox
    tw, ts, te, tn = tile.bbox
    img = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(img)

    def to_px(u, v):
        lon, lat = rw + u * (re_ - rw), rn - v * (rn - rs)
        return (lon - tw) / (te - tw) * (size - 1), (tn - lat) / (tn - ts) * (size - 1)

    for kind, width in (("lake", 2), ("river", 4), ("road", 3)):
        for line in feats.get(kind, []):
            d.line([to_px(u, v) for u, v in line], fill=255, width=width, joint="curve")
    return img


def render_region(name: str, bbox, nx: int = 3, ny: int = 3, size: int = 1024, out: Path = OUT) -> list[Path]:
    """Write depth + line PNGs for every tile of a region. Returns written paths."""
    lo, hi = region_range(bbox)
    feats = osm.features(bbox)
    written = []
    for t in tile_grid(bbox, nx, ny):
        d = out / name
        d.mkdir(parents=True, exist_ok=True)
        for kind, img in (("depth", depth_image(t, lo, hi, size)), ("line", line_image(t, feats, bbox, size))):
            p = d / f"{t.name}_{kind}.png"
            img.save(p)
            written.append(p)
    return written
