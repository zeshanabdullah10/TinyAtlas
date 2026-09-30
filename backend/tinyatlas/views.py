"""See the view before you go: an eye-level depth image of the real skyline from a viewpoint, for an image model to
paint over (ComfyUI depth ControlNet), plus where each visible summit falls in that picture.

The camera is angle-linear (the same degrees per pixel across and up), matching the panorama drawing, so labels
computed from the viewshed land on the painted peaks. The depth image is what pins the painting to the terrain;
labels are overlaid by the app and never painted in.
"""
import math

import numpy as np
from PIL import Image

from . import viewshed

W, H, FOV = 1216, 832, 50.0       # SDXL's native 3:2 size; degrees across (H * FOV / W up)


def best_heading(pano: dict, fov: float = FOV) -> float:
    """The direction to face: the window of `fov` degrees whose visible summits stand highest in the view."""
    if not pano["peaks"]:
        return 180.0
    best, score = 180.0, -1.0
    for az in range(0, 360, 2):
        s = sum(p["alt"] + 2 for p in pano["peaks"] if abs((p["az"] - az + 540) % 360 - 180) < fov / 2 * 0.8)
        if s > score:
            best, score = float(az), s
    return best


def depth_image(hm, size_m, obs_rc, heading: float, bbox=None, near=None, eye: float = viewshed.EYE_M,
                w: int = W, h: int = H, fov: float = FOV, horizon: float = 0.62):
    """(depth PIL image, metres to the ground per pixel with inf for sky, degrees per pixel).
    Near ground is bright, distant ground dark, sky black. `horizon` is where 0 degrees sits (fraction of height)."""
    R, C = hm.shape
    dy, dx = size_m[1] / (R - 1), size_m[0] / (C - 1)
    r0, c0 = obs_rc
    height = lambda r, c: viewshed._heights(hm, bbox, near, r, c)
    h0 = float(height(np.array([r0]), np.array([c0]))[0]) + eye
    dpp = fov / w
    az = heading + (np.arange(w) - w / 2 + 0.5) * dpp
    alt = (h * horizon - np.arange(h) - 0.5) * dpp                       # row 0 = top of the picture
    ds = viewshed.distances(max(size_m) * 0.75, n=900, first=15.0)
    a = np.radians(az)[:, None]
    ground = height(r0 - np.cos(a) * ds[None, :] / dy, c0 + np.sin(a) * ds[None, :] / dx)
    ang = np.degrees(np.arctan2(ground - viewshed.drop(ds)[None, :] - h0, ds[None, :]))
    ang = np.where(np.isnan(ang), -90.0, ang)
    run = np.maximum.accumulate(ang, axis=1)                             # per column: highest angle reached so far
    dist = np.full((h, w), np.inf)
    for x in range(w):
        idx = np.searchsorted(run[x], alt)                               # first sample whose terrain reaches the ray
        hit = idx < len(ds)
        dist[hit, x] = ds[idx[hit]]
    near_m, far_m = 300.0, max(size_m) * 0.75          # spend the grey levels on the mountains, not the foreground
    v = 1 - np.log(np.clip(dist, near_m, far_m) / near_m) / math.log(far_m / near_m)
    img = np.where(np.isinf(dist), 0, 30 + 225 * v)
    # where each pixel meets the ground, as (lat, lon), so map layers (water) can be projected into the picture
    ww, ss, ee, nn = bbox if bbox is not None else (0, 0, 1, 1)
    d = np.where(np.isinf(dist), 0.0, dist)
    rr = r0 - np.cos(np.radians(az))[None, :] * d / dy
    cc = c0 + np.sin(np.radians(az))[None, :] * d / dx
    ground = (nn - rr / (R - 1) * (nn - ss), ww + cc / (C - 1) * (ee - ww), np.isfinite(dist))
    return Image.fromarray(img.astype(np.uint8), "L"), dist, dpp, ground


def water_raster(region_bbox, feats: dict, size: int = 3072):
    """(mask image, bbox): OSM lakes filled and rivers drawn, over the region, for projecting into views."""
    from PIL import ImageDraw
    img = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(img)
    px = lambda line: [(u * (size - 1), v * (size - 1)) for u, v in line]
    for line in feats.get("lake", []):
        if len(line) >= 4 and line[0] == line[-1]:
            d.polygon(px(line), fill=255)
    for line in feats.get("river", []):
        d.line(px(line), fill=255, width=max(2, size // 700))
    return img, region_bbox


def water_in_view(ground, raster) -> np.ndarray:
    """Boolean (h, w): the pixel looks at mapped water."""
    lat, lon, hit = ground
    img, (w, s, e, n) = raster
    a = np.asarray(img)
    size = a.shape[0]
    r = np.round((n - lat) / (n - s) * (size - 1)).astype(int)
    c = np.round((lon - w) / (e - w) * (size - 1)).astype(int)
    inside = hit & (r >= 0) & (r < size) & (c >= 0) & (c < size)
    out = np.zeros(lat.shape, dtype=bool)
    out[inside] = a[r[inside], c[inside]] > 127
    return out


def init_image(dist: np.ndarray, water: np.ndarray, far_m: float) -> Image.Image:
    """A rough colour start for img2img: pale sky, ground fading with distance, water blue where the map has it."""
    h, w = dist.shape
    t = np.clip(np.log(np.clip(dist, 300, far_m) / 300) / math.log(far_m / 300), 0, 1)[..., None]
    ground = np.array([112, 108, 92]) * (1 - t) + np.array([168, 176, 188]) * t
    sky = np.linspace([150, 182, 214], [214, 224, 232], h)[:, None, :].repeat(w, axis=1)
    rgb = np.where(np.isinf(dist)[..., None], sky, ground)
    rgb = np.where(water[..., None], np.array([60, 128, 150]), rgb)
    return Image.fromarray(rgb.astype(np.uint8), "RGB")


def place_labels(pano: dict, heading: float, dpp: float, w: int = W, h: int = H, horizon: float = 0.62) -> list[dict]:
    """Visible summits in picture coordinates (fractions of width and height), left to right."""
    out = []
    for p in pano["peaks"]:
        dx = (p["az"] - heading + 540) % 360 - 180
        x = w / 2 + dx / dpp
        y = h * horizon - p["alt"] / dpp
        if 0 <= x <= w and 0 <= y <= h:
            out.append({"name": p["name"], "ele": p["ele"], "dist": p["dist"], "x": round(x / w, 4), "y": round(y / h, 4)})
    return sorted(out, key=lambda p: p["x"])


TIMES = {
    "sunrise": "at sunrise, first pink alpenglow on the snowy summits, cool blue shadows in the valley",
    "midday": "in clear midday light, deep blue sky",
    "evening": "at golden hour, warm evening light on the peaks, long soft shadows",
}
SEASONS = {
    "spring": "spring, blossoming apricot and cherry trees, fresh green terraces, late snow high up",
    "summer": "summer, small green terraced fields and poplars on the valley floor, bare dry rocky slopes, "
              "snow only on the high peaks",
    "autumn": "autumn, golden poplars and orange orchards, dry grass, fresh snow on the peaks",
    "winter": "winter, deep snow on the slopes and valley, frozen river",
}


def prompt(place: str, time: str, season: str, water: bool = False) -> str:
    # the depth image has no water in it: when the map shows water in view it is seeded blue in the start picture,
    # and the prompt says so too
    lake = ("a calm turquoise mountain lake in the foreground reflecting the peaks, "
            if water or "lake" in place.lower() else "")
    frozen = "frozen and snow covered " if lake and season == "winter" else ""
    return (f"landscape photograph of the view from {place}, northern Pakistan, {frozen}{lake}colossal glaciated "
            f"mountain peaks rising above a deep valley, {SEASONS[season]}, {TIMES[time]}, sharp detail, atmospheric "
            "perspective, shot on a full frame camera, 35mm lens, national geographic travel photography")


NEGATIVE = ("text, letters, watermark, signature, frame, border, people, cars, blurry, lowres, deformed, cartoon, "
            "painting, illustration, oversaturated, hdr, photo collage, split image")
