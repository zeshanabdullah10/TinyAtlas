"""Procedural illustrated texture: hillshade + toon-banded elevation colours + water + roads.

This is the GPU-free baseline. Everything is derived from the DEM/OSM, so nothing is invented;
a ComfyUI img2img pass can later restyle these textures using the depth/line passes as guides.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from . import osm, regions, terrain, tiles

# (t, RGB) with t = 0 at the region's lowest ground and 1 at the snowline: valley green -> tan -> rock -> snow
RAMP = [
    (0.00, (150, 172, 96)),
    (0.22, (168, 176, 100)),
    (0.44, (196, 176, 120)),
    (0.64, (188, 160, 118)),
    (0.80, (160, 150, 138)),
    (0.93, (200, 196, 190)),
    (1.10, (250, 250, 252)),
]
# Seasons change the valley colours (t < 0.5 of the ramp) and how far the snow comes down. Snowline offsets are
# typical, not measured for a particular year; the viewer labels seasonal textures as illustrations.
SEASONS = {
    "summer": {"snow": 0.0, "valley": None},
    "spring": {"snow": -1100.0, "valley": [(0.00, (160, 184, 110)), (0.22, (184, 190, 124)), (0.44, (200, 182, 128))]},
    "autumn": {"snow": -500.0, "valley": [(0.00, (206, 150, 64)), (0.22, (196, 162, 88)), (0.44, (190, 166, 118))]},
    "winter": {"snow": None, "valley": [(0.00, (214, 212, 204)), (0.22, (222, 222, 218)), (0.44, (212, 206, 196))]},
}
ROCK = np.array([140, 128, 116], dtype=np.float64)
SNOW = np.array([250, 250, 255], dtype=np.float64)
WATER = np.array([74, 144, 196], dtype=np.float64)
ROAD_INK, ROAD_FILL, TRAIL = (92, 62, 40), (246, 232, 196), (128, 88, 58)


def smoothstep(a: float, b: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def blur(a: np.ndarray, sigma: float) -> np.ndarray:
    """Separable gaussian blur for float arrays (PIL's filter doesn't take float images)."""
    r = max(1, int(3 * sigma))
    k = np.exp(-(np.arange(-r, r + 1) ** 2) / (2 * sigma**2))
    k /= k.sum()
    h, w = a.shape
    p = np.pad(a, r, mode="edge")
    rows = sum(k[i] * p[i : i + h, :] for i in range(2 * r + 1))
    return sum(k[i] * rows[:, i : i + w] for i in range(2 * r + 1))


def climate(bbox, snowline: float | None = None) -> tuple[float, float]:
    """(lowest ground, snowline) in metres for a region. The snowline falls with latitude unless the region
    sets its own (dry continental ranges like the Karakoram keep snow far higher than the Alps)."""
    lat = abs((bbox[1] + bbox[3]) / 2)
    lo = float(np.percentile(terrain.heightmap(bbox, z=11, size=96), 1))
    sn = snowline or max(900.0, 4800.0 - 50.0 * max(0.0, lat - 15.0))
    return lo, max(sn, lo + 800.0)


def season_climate(clim: tuple[float, float], season: str) -> tuple[float, float]:
    """(lowest ground, snowline) for a season. Winter snow reaches most of the valley floor."""
    lo, snow = clim
    off = SEASONS[season]["snow"]
    if off is None:
        return lo, lo + 700.0
    return lo, max(snow + off, lo + 800.0)


def ramp_colors(elev: np.ndarray, lo: float = 1000.0, snow: float = 5500.0, season: str = "summer") -> np.ndarray:
    t = (elev - lo) / (snow - lo)
    valley = SEASONS[season]["valley"]
    ramp = RAMP if not valley else [*valley, *[p for p in RAMP if p[0] > valley[-1][0]]]
    xs = [p[0] for p in ramp]
    return np.stack([np.interp(t, xs, [p[1][c] for p in ramp]) for c in range(3)], axis=-1)


def slope_and_shade(hm: np.ndarray, dx: float, dy: float, az_deg: float = 315.0, alt_deg: float = 42.0):
    """hm rows run north->south. Returns (slope radians, hillshade 0..1) for a light at
    azimuth az (clockwise from north) and altitude alt."""
    gy, gx = np.gradient(hm, dy, dx)          # d/d(row south), d/d(col east)
    dz_e, dz_n = gx, -gy
    slope = np.arctan(np.hypot(dz_e, dz_n))
    n = np.stack([-dz_e, -dz_n, np.ones_like(hm)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    az, alt = np.radians(az_deg), np.radians(alt_deg)
    light = np.array([np.cos(alt) * np.sin(az), np.cos(alt) * np.cos(az), np.sin(alt)])
    return slope, np.clip(n @ light, 0, 1)


def colorize(hm: np.ndarray, slope: np.ndarray, shade: np.ndarray, bands: int = 5,
             lo: float = 1000.0, snowline: float = 5500.0, season: str = "summer") -> np.ndarray:
    """Base colour by elevation, rock on steep faces, snow high and gentle, then toon-banded light."""
    deg = np.degrees(slope)[..., None]
    col = ramp_colors(hm, lo, snowline, season)
    col = col * (1 - smoothstep(28, 48, deg)) + ROCK * smoothstep(28, 48, deg)
    snow = smoothstep(0.87, 1.02, (hm - lo) / (snowline - lo))[..., None] * (1 - smoothstep(38, 55, deg))
    col = col * (1 - snow) + SNOW * snow
    toon = np.floor(shade * bands + 0.5) / bands
    light = 0.5 + 0.7 * (0.45 * shade + 0.55 * toon)
    return np.clip(col * light[..., None], 0, 255)


def paint_tile(tile: tiles.Tile, feats: dict, region_bbox, size: int = 1024, z: int = 13,
               clim: tuple[float, float] | None = None, season: str = "summer") -> Image.Image:
    lo, snowline = season_climate(clim or climate(region_bbox), season)
    hm = terrain.heightmap(tile.bbox, z=z, size=size)
    wm, hm_m = terrain.bbox_size_m(tile.bbox)
    hm = blur(hm, 1.2)
    slope, shade = slope_and_shade(hm, wm / size, hm_m / size)
    rgb = colorize(hm, slope, shade, lo=lo, snowline=snowline, season=season)

    water = np.asarray(tiles.water_mask(tile, feats, region_bbox, size).filter(ImageFilter.GaussianBlur(0.8)), dtype=np.float64) / 255
    wshade = (0.85 + 0.15 * shade)[..., None]
    rgb = rgb * (1 - water[..., None]) + WATER * wshade * water[..., None]

    img = Image.fromarray(rgb.astype(np.uint8), "RGB")
    d = ImageDraw.Draw(img)
    to_px = tiles._px_mapper(tile, region_bbox, size)
    for line in feats.get("trail", []):           # footpaths: a thin, quiet line under the roads
        d.line([to_px(u, v) for u, v in line], fill=TRAIL, width=1)
    for line in feats.get("road", []):
        pts = [to_px(u, v) for u, v in line]
        d.line(pts, fill=ROAD_INK, width=4, joint="curve")
    for line in feats.get("road", []):
        pts = [to_px(u, v) for u, v in line]
        d.line(pts, fill=ROAD_FILL, width=2, joint="curve")
    return img


def core_box(tile: tiles.Tile, region_bbox, nx: int, ny: int, size: int) -> tuple[int, int, int, int]:
    """Pixel box (l, t, r, b) of the tile's non-overlap core inside its own image."""
    w, s, e, n = region_bbox
    cw, ch = (e - w) / nx, (n - s) / ny
    c_w, c_n = w + tile.ix * cw, n - tile.iy * ch
    tw, ts, te, tn = tile.bbox
    px = lambda lon: (lon - tw) / (te - tw) * size
    py = lambda lat: (tn - lat) / (tn - ts) * size
    return round(px(c_w)), round(py(c_n)), round(px(c_w + cw)), round(py(c_n - ch))


def paint_region(name: str, bbox, nx: int = 3, ny: int = 3, size: int = 1024, core: int = 800,
                 out: Path = tiles.OUT, season: str = "summer") -> Path:
    """Paint all tiles, crop overlaps, mosaic into one texture. Row 0 = north, col 0 = west.
    Summer is texture.png; other seasons are texture_<season>.png."""
    feats = osm.features(bbox)
    clim = climate(bbox, regions.REGIONS[name].get("snowline") if name in regions.REGIONS else None)
    mosaic = Image.new("RGB", (nx * core, ny * core))
    for t in tiles.tile_grid(bbox, nx, ny):
        img = paint_tile(t, feats, bbox, size, clim=clim, season=season)
        crop = img.crop(core_box(t, bbox, nx, ny, size)).resize((core, core), Image.LANCZOS)
        mosaic.paste(crop, (t.ix * core, t.iy * core))
    d = out / name
    d.mkdir(parents=True, exist_ok=True)
    path = d / ("texture.png" if season == "summer" else f"texture_{season}.png")
    mosaic.save(path)
    return path
