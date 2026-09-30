"""Elevation tiles -> heightmap -> grid mesh.

Uses AWS Terrarium tiles (open data, no key): elevation_m = R*256 + G + B/256 - 32768.
"""
import io
import math
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
import numpy as np
from PIL import Image

TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
CACHE = Path(__file__).resolve().parents[2] / "data" / "dem"


def lonlat_to_tile(lon: float, lat: float, z: int) -> tuple[float, float]:
    n = 2**z
    x = (lon + 180.0) / 360.0 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def decode_terrarium(rgb: np.ndarray) -> np.ndarray:
    rgb = rgb.astype(np.float64)
    return rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768


def fetch_tile(z: int, x: int, y: int, client: httpx.Client | None = None) -> np.ndarray:
    path = CACHE / f"{z}_{x}_{y}.png"
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        c = client or httpx
        r = c.get(TILE_URL.format(z=z, x=x, y=y), timeout=30)
        r.raise_for_status()
        tmp = path.with_suffix(f".{threading.get_ident()}.tmp")
        tmp.write_bytes(r.content)
        tmp.replace(path)                      # atomic: readers never see a half-written tile
    img = Image.open(io.BytesIO(path.read_bytes())).convert("RGB")
    return decode_terrarium(np.asarray(img))


def prefetch(z: int, xs, ys, workers: int = 8) -> None:
    """Download any missing tiles in parallel (they are then read from the disk cache)."""
    missing = [(x, y) for y in ys for x in xs if not (CACHE / f"{z}_{x}_{y}.png").exists()]
    if len(missing) < 2:
        return
    with httpx.Client(timeout=30) as client, ThreadPoolExecutor(workers) as pool:
        list(pool.map(lambda t: fetch_tile(z, t[0], t[1], client), missing))


def heightmap(bbox: tuple[float, float, float, float], z: int = 11, size: int = 256) -> np.ndarray:
    """bbox = (west, south, east, north) in degrees. Returns a size x size array of metres,
    row 0 = north edge."""
    w, s, e, n = bbox
    x0, y0 = lonlat_to_tile(w, n, z)
    x1, y1 = lonlat_to_tile(e, s, z)
    tx0, tx1 = int(math.floor(x0)), int(math.floor(x1))
    ty0, ty1 = int(math.floor(y0)), int(math.floor(y1))
    prefetch(z, range(tx0, tx1 + 1), range(ty0, ty1 + 1))
    rows = []
    for ty in range(ty0, ty1 + 1):
        rows.append(np.hstack([fetch_tile(z, tx, ty) for tx in range(tx0, tx1 + 1)]))
    mosaic = np.vstack(rows)
    px0, px1 = (x0 - tx0) * 256, (x1 - tx0) * 256
    py0, py1 = (y0 - ty0) * 256, (y1 - ty0) * 256
    crop = mosaic[int(py0) : max(int(py1), int(py0) + 2), int(px0) : max(int(px1), int(px0) + 2)]
    return resample(crop, size)


def resample(a: np.ndarray, size: int) -> np.ndarray:
    """Bilinear resample to size x size."""
    h, w = a.shape
    ys = np.linspace(0, h - 1, size)
    xs = np.linspace(0, w - 1, size)
    y0 = np.floor(ys).astype(int)
    x0 = np.floor(xs).astype(int)
    y1 = np.minimum(y0 + 1, h - 1)
    x1 = np.minimum(x0 + 1, w - 1)
    fy = (ys - y0)[:, None]
    fx = (xs - x0)[None, :]
    top = a[np.ix_(y0, x0)] * (1 - fx) + a[np.ix_(y0, x1)] * fx
    bot = a[np.ix_(y1, x0)] * (1 - fx) + a[np.ix_(y1, x1)] * fx
    return top * (1 - fy) + bot * fy


def grid_mesh(hm: np.ndarray, width_m: float, height_m: float, exaggeration: float = 1.0):
    """Return (vertices Nx3 float32, faces Mx3 int32). x east, y up, z south; centred on origin."""
    rows, cols = hm.shape
    xs = np.linspace(-width_m / 2, width_m / 2, cols)
    zs = np.linspace(-height_m / 2, height_m / 2, rows)
    gx, gz = np.meshgrid(xs, zs)
    verts = np.stack([gx, (hm - hm.min()) * exaggeration, gz], axis=-1).reshape(-1, 3).astype(np.float32)
    idx = np.arange(rows * cols).reshape(rows, cols)
    a, b, c, d = idx[:-1, :-1], idx[:-1, 1:], idx[1:, :-1], idx[1:, 1:]
    faces = np.concatenate([np.stack([a, c, b], -1).reshape(-1, 3), np.stack([b, c, d], -1).reshape(-1, 3)])
    return verts, faces.astype(np.int32)


def bbox_size_m(bbox) -> tuple[float, float]:
    w, s, e, n = bbox
    lat = math.radians((s + n) / 2)
    return (e - w) * 111_320 * math.cos(lat), (n - s) * 110_540
