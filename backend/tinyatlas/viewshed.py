"""What can you see from here: the skyline and the named peaks visible from a point.

The panorama uses its own elevation grid reaching about 60 km around a place (the miniature itself is ~40 km
across, and the famous views are of mountains outside it: Rakaposhi from Karimabad). Rays are cast every quarter
degree of azimuth; earth curvature and standard refraction are applied. web/js/viewshed.js is a line-for-line port;
keep the two in step.

Distances are metres, angles degrees; azimuth clockwise from north. Grids are row 0 = north, col 0 = west.
"""
import math

import numpy as np

from . import osm, terrain

EARTH_R = 6_371_000.0
REFRACTION = 0.13                     # standard terrestrial refraction coefficient
BANDS_M = (2_000, 5_000, 10_000, 20_000, 40_000, 90_000)   # ridgeline layers, near to far
AZ_STEP = 0.25
EYE_M = 1.7
RADIUS_KM = 60


def wide_bbox(lat: float, lon: float, radius_km: float = RADIUS_KM):
    dlat = radius_km / 110.54
    dlon = radius_km / (111.32 * max(math.cos(math.radians(lat)), 0.05))
    return (round(lon - dlon, 5), round(lat - dlat, 5), round(lon + dlon, 5), round(lat + dlat, 5))


def region_wide(cfg: dict, size: int = 1024):
    """The panorama grid for a whole region: centred on it, reaching RADIUS_KM beyond its edges."""
    w, s, e, n = cfg["bbox"]
    half = max(terrain.bbox_size_m(cfg["bbox"])) / 2000
    return wide_dem((s + n) / 2, (w + e) / 2, size, radius_km=half + RADIUS_KM)


def wide_dem(lat: float, lon: float, size: int = 640, radius_km: float = RADIUS_KM):
    """(heights, bbox, (width_m, height_m)) for the panorama around lat, lon."""
    bbox = wide_bbox(lat, lon, radius_km)
    return terrain.heightmap(bbox, z=10, size=size), bbox, terrain.bbox_size_m(bbox)


PEAK_KINDS = ("peak", "volcano")


def peaks_query(bbox) -> str:
    w, s, e, n = bbox
    return f'[out:json][timeout:60];node["natural"~"^(peak|volcano)$"]["name"]({s},{w},{n},{e});out;'


def named_peaks(bbox, client=None) -> list[dict]:
    """[{name, lat, lon, ele}] from OpenStreetMap, English names where the map has them."""
    out = []
    for el in osm._run(peaks_query(bbox), client).get("elements", []):
        t = el.get("tags", {})
        name = t.get("name:en") or t.get("name")
        try:
            ele = float(str(t.get("ele", "")).replace("m", "").replace(",", "").strip())
        except ValueError:
            ele = None
        if name:
            out.append({"name": name, "lat": el["lat"], "lon": el["lon"], "ele": ele})
    return out


def to_rc(lat: float, lon: float, bbox, shape) -> tuple[float, float]:
    w, s, e, n = bbox
    return (n - lat) / (n - s) * (shape[0] - 1), (lon - w) / (e - w) * (shape[1] - 1)


def panorama_at(lat: float, lon: float, eye: float = EYE_M, client=None, grid=None, near=None) -> dict:
    """The panorama from a real place, with named peaks from OpenStreetMap. `grid` is a (hm, bbox, size) from
    wide_dem/region_wide to reuse (by default one is centred on the point); `near` a finer (hm, bbox)."""
    hm, bbox, size = grid or wide_dem(lat, lon)
    peaks = [{**p, "row": rc[0], "col": rc[1]} for p in named_peaks(bbox, client)
             for rc in [to_rc(p["lat"], p["lon"], bbox, hm.shape)]]
    return panorama(hm, size, to_rc(lat, lon, bbox, hm.shape), eye=eye, peaks=peaks, bbox=bbox, near=near)


def _sample(hm: np.ndarray, r, c):
    """Bilinear sample at fractional (row, col) arrays; NaN outside the grid."""
    R, C = hm.shape
    inside = (r >= 0) & (r <= R - 1) & (c >= 0) & (c <= C - 1)
    r, c = np.clip(r, 0, R - 1), np.clip(c, 0, C - 1)
    r0, c0 = np.floor(r).astype(int), np.floor(c).astype(int)
    r1, c1 = np.minimum(r0 + 1, R - 1), np.minimum(c0 + 1, C - 1)
    fr, fc = r - r0, c - c0
    v = (hm[r0, c0] * (1 - fc) + hm[r0, c1] * fc) * (1 - fr) + (hm[r1, c0] * (1 - fc) + hm[r1, c1] * fc) * fr
    return np.where(inside, v, np.nan)


def distances(max_m: float, n: int = 480, first: float = 40.0) -> np.ndarray:
    """Sample distances along a ray: dense near the observer, sparse far away."""
    return first * (max_m / first) ** (np.arange(n) / (n - 1))


def drop(d):
    """How far the ground falls below a flat line of sight at distance d (curvature less refraction)."""
    return d * d / (2 * EARTH_R) * (1 - REFRACTION)


def near_grid(cfg: dict, size: int = 1024):
    """(heights, bbox) of the region itself at about 40 m: narrow gorges (Karimabad looks up the Ultar gorge) close
    up in the coarser panorama grid, so close terrain is read from this one."""
    return terrain.heightmap(cfg["bbox"], z=12, size=size), cfg["bbox"]


def _heights(hm, bbox, near, r, c):
    """Heights at wide-grid positions (r, c); inside `near`'s bbox the near grid's value is used."""
    h = _sample(hm, r, c)
    if near is None or bbox is None:
        return h
    nh, (nw, ns, ne, nn) = near
    w, s, e, n = bbox
    lat = n - r / (hm.shape[0] - 1) * (n - s)
    lon = w + c / (hm.shape[1] - 1) * (e - w)
    nr = (nn - lat) / (nn - ns) * (nh.shape[0] - 1)
    nc = (lon - nw) / (ne - nw) * (nh.shape[1] - 1)
    hn = _sample(nh, nr, nc)
    return np.where(np.isnan(hn), h, hn)


def panorama(hm: np.ndarray, size_m, obs_rc, eye: float = EYE_M, peaks=(), az_step: float = AZ_STEP,
             bbox=None, near=None) -> dict:
    """Skyline layers and visible peaks from grid position obs_rc (row, col).

    Returns {elev, az: [...], bands: [[max angle per azimuth] per band], peaks: [{name, ele, az, alt, dist}]}.
    `peaks` are dicts with name, row, col and ele (metres, or None to read it from the grid). `near` is an optional
    (heights, bbox) of finer terrain used wherever it reaches; it needs the wide grid's `bbox`.
    """
    R, C = hm.shape
    dy, dx = size_m[1] / (R - 1), size_m[0] / (C - 1)          # metres per row / column
    r0, c0 = obs_rc
    height = lambda r, c: _heights(hm, bbox, near, r, c)
    h0 = float(height(np.array([r0]), np.array([c0]))[0]) + eye
    az = np.arange(0, 360, az_step)
    ds = distances(max(size_m) * 0.75)
    a = np.radians(az)[:, None]
    rr = r0 - np.cos(a) * ds[None, :] / dy
    cc = c0 + np.sin(a) * ds[None, :] / dx
    h = height(rr, cc)
    ang = np.degrees(np.arctan2(h - drop(ds)[None, :] - h0, ds[None, :]))
    ang = np.where(np.isnan(ang), -90.0, ang)
    run = np.maximum.accumulate(ang, axis=1)
    bands = [run[:, max(0, np.searchsorted(ds, b) - 1)].round(3).tolist() for b in BANDS_M]
    seen = []
    for p in peaks:
        pr, pc = p["row"], p["col"]
        north, east = (r0 - pr) * dy, (pc - c0) * dx
        dist = math.hypot(north, east)
        if dist < 200 or dist > ds[-1]:
            continue
        paz = math.degrees(math.atan2(east, north)) % 360
        ele = p.get("ele") or float(_sample(hm, np.array([pr]), np.array([pc]))[0])
        palt = math.degrees(math.atan2(ele - drop(dist) - h0, dist))
        # terrain in front of the summit, leaving out the summit's own cells (the grid's peak and the mapped
        # summit point rarely coincide, and a steep summit block would otherwise hide itself)
        k = ds < dist - max(3 * max(dx, dy), 0.03 * dist)
        pa = math.radians(paz)
        ray = height(r0 - math.cos(pa) * ds[k] / dy, c0 + math.sin(pa) * ds[k] / dx)
        block = np.degrees(np.arctan2(ray - drop(ds[k]) - h0, ds[k]))
        block = np.nanmax(block) if block.size and not np.all(np.isnan(block)) else -90.0
        if palt >= block - 0.05:
            seen.append({"name": p["name"], "ele": round(ele), "az": round(paz, 2), "alt": round(palt, 3),
                         "dist": round(dist)})
    seen.sort(key=lambda s: s["az"])
    return {"elev": round(h0 - eye), "az_step": az_step, "bands_m": list(BANDS_M), "bands": bands, "peaks": seen}
