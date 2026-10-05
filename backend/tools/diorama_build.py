"""Build a diorama site (a small, drivable tabletop model of one attraction) from open data.

    python backend/tools/diorama_build.py mahodand --dem DEM.tif --worldcover WC.tif --osm OSM.json

Inputs (downloaded once, not committed):
  --dem         Copernicus GLO-30 DSM tile, e.g. Copernicus_DSM_COG_10_N35_00_E072_00_DEM.tif
                (s3://copernicus-dem-30m, 1 arc-second, EGM2008 heights)
  --worldcover  ESA WorldCover 10 m 2021 v200 tile, e.g. ESA_WorldCover_10m_2021_v200_N33E072_Map.tif
  --osm         Overpass JSON (`out geom;`) of highway + waterway ways over the site box

Outputs, committed under web/data/diorama/<site>/ (the page reads only these):
  far.bin       uint16 heights of the horizon ring, 60 m cells, half-metres above meta.far.hmin (farcover.bin alongside)
  height.bin    uint16 little-endian, row-major north to south, decimetres above meta.hmin, CELL m spacing
  cover.bin     uint8 per cell: 1 tree, 2 grass, 3 bare/rock, 4 snow/ice, 5 water, 6 moss, 7 shrub
  meta.json     grid, the drive (track points with real heights), lake, streams, measured facts, sources

Real data sets the facts: every number in meta.facts is measured here from the inputs. Two edits are made to the
terrain and both are listed in meta.edits: the lake bed is flattened under the measured water level, and a bench
of a few metres is cut along the jeep track (the DSM includes tree canopy and the 30 m grid cannot hold a 4 m road).
"""
import argparse
import json
import math
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
CELL = 10.0   # metres per grid cell
FAR_CELL = 60.0

SITES = {
    "mahodand": {
        "title": "Mahodand Lake",
        "subtitle": "Ushu valley, Upper Swat",
        "bbox": (35.672, 72.632, 35.724, 72.692),      # south, west, north, east
        "lake_seed": (35.70825, 72.65398),              # the place point in regions.py
        "drive_ways": [491297270],                      # OSM "Mahodand Lake Road", Kalam side to the lake
        "drive_start": (35.6773, 72.6784),
        "track_ways": [345805207, 491297270, 1156049685, 1156049686, 1156052434, 1156052435],
        "far_bbox": (35.600, 72.545, 35.796, 72.779),     # the horizon seen from the drive, coarse
    },
}
COVER = {10: 1, 20: 7, 30: 2, 40: 2, 50: 3, 60: 3, 70: 4, 80: 5, 90: 2, 95: 1, 100: 6}


def geo(site, key="bbox", cell=CELL):
    s, w, n, e = site[key]
    lat0 = (s + n) / 2
    my = 111132.95 - 559.82 * math.cos(2 * math.radians(lat0))      # metres per degree, WGS84 at lat0
    mx = 111412.84 * math.cos(math.radians(lat0)) - 93.5 * math.cos(3 * math.radians(lat0))
    W, H = (e - w) * mx, (n - s) * my
    cols, rows = int(W // cell) + 1, int(H // cell) + 1
    return dict(s=s, w=w, n=n, e=e, mx=mx, my=my, cols=cols, rows=rows, W=(cols - 1) * cell, H=(rows - 1) * cell, cell=cell)


def to_local(g, lat, lon):
    """Local metres, origin at the grid centre, x east, z south (three.js convention)."""
    return (lon - g["w"]) * g["mx"] - g["W"] / 2, (g["n"] - lat) * g["my"] - g["H"] / 2


def sample_tile(arr, top, left, step, g, order):
    """Resample a geographic tile (top-left corner, degrees per pixel) onto the local grid."""
    xs = np.arange(g["cols"]) * g["cell"] / g["mx"] + g["w"]
    ys = g["n"] - np.arange(g["rows"]) * g["cell"] / g["my"]
    fx = (xs - left) / step - 0.5
    fy = (top - ys) / step - 0.5
    if order == 0:
        return arr[np.rint(fy).astype(int)[:, None], np.rint(fx).astype(int)[None, :]]
    x0, y0 = np.floor(fx).astype(int), np.floor(fy).astype(int)
    tx, ty = (fx - x0)[None, :], (fy - y0)[:, None]
    a = arr.astype(np.float64)
    out = 0
    for dy, wy in ((0, 1 - ty), (1, ty)):              # bilinear; cubic overshoots on cliffs
        for dx, wx in ((0, 1 - tx), (1, tx)):
            out = out + a[(y0 + dy)[:, None], (x0 + dx)[None, :]] * wy * wx
    return out


def blur(a, r):
    k = np.ones(2 * r + 1) / (2 * r + 1)
    p = np.pad(a, r, mode="edge")
    p = np.apply_along_axis(lambda v: np.convolve(v, k, "valid"), 0, p)
    return np.apply_along_axis(lambda v: np.convolve(v, k, "valid"), 1, p)


def flood(mask, seed):
    out = np.zeros_like(mask)
    q = deque([seed])
    while q:
        r, c = q.popleft()
        if 0 <= r < mask.shape[0] and 0 <= c < mask.shape[1] and mask[r, c] and not out[r, c]:
            out[r, c] = True
            q.extend(((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)))
    return out


def chain(ways, ids, start):
    """Join OSM ways into one polyline beginning at the end nearest `start`."""
    segs = [[(p["lat"], p["lon"]) for p in ways[i]["geometry"]] for i in ids if i in ways]
    line = segs.pop(0)
    while segs:
        best = min(range(len(segs)), key=lambda k: min(math.dist(line[-1], segs[k][0]), math.dist(line[-1], segs[k][-1]),
                                                     math.dist(line[0], segs[k][0]), math.dist(line[0], segs[k][-1])))
        s = segs.pop(best)
        d = {(0, 0): math.dist(line[0], s[0]), (0, 1): math.dist(line[0], s[-1]),
             (1, 0): math.dist(line[-1], s[0]), (1, 1): math.dist(line[-1], s[-1])}
        end, side = min(d, key=d.get)
        if end == 1:
            line += s if side == 0 else s[::-1]
        else:
            line = (s[::-1] if side == 0 else s) + line
    if math.dist(line[-1], start) < math.dist(line[0], start):
        line.reverse()
    return line


def resample(pts, step):
    out, carry = [pts[0]], 0.0
    for a, b in zip(pts, pts[1:]):
        L = math.dist(a, b)
        t = step - carry
        while t <= L:
            out.append((a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L))
            t += step
        carry = L - (t - step)
    if math.dist(out[-1], pts[-1]) > 1:
        out.append(pts[-1])
    return out


def bilerp(h, g, x, z):
    c = (x + g["W"] / 2) / CELL
    r = (z + g["H"] / 2) / CELL
    c0, r0 = int(min(max(c, 0), g["cols"] - 2)), int(min(max(r, 0), g["rows"] - 2))
    tx, tz = c - c0, r - r0
    return (h[r0, c0] * (1 - tx) * (1 - tz) + h[r0, c0 + 1] * tx * (1 - tz)
            + h[r0 + 1, c0] * (1 - tx) * tz + h[r0 + 1, c0 + 1] * tx * tz)


def build(name, dem_path, wc_path, osm_path):
    import tifffile
    site = SITES[name]
    g = geo(site)
    out = ROOT / "web" / "data" / "diorama" / name
    out.mkdir(parents=True, exist_ok=True)

    dem = tifffile.imread(dem_path)                      # 3600x3600, top-left 36N 72E for the N35E072 tile
    dem_top, dem_left = 36.0, 72.0
    h = sample_tile(dem, dem_top, dem_left, 1 / 3600, g, 1)
    wc = tifffile.TiffFile(wc_path).pages[0].asarray()  # 36000x36000, top-left 36N 72E for N33E072
    cls = sample_tile(wc, 36.0, 72.0, 1 / 12000, g, 0)
    cover = np.vectorize(lambda v: COVER.get(int(v), 2))(cls).astype(np.uint8)

    # Lake: the WorldCover water patch that holds the place point, cleaned by the DEM's flat surface.
    sx, sz = to_local(g, *site["lake_seed"])
    seed = (int(round((sz + g["H"] / 2) / CELL)), int(round((sx + g["W"] / 2) / CELL)))
    lake = flood(cover == 5, seed)                      # also follows the inflowing river upstream
    level = float(np.percentile(h[lake], 25))
    wet = (cover == 5) & (h < level + 4.0)
    wet = (blur((blur(wet.astype(float), 2) > 0.9).astype(float), 2) > 0.05) & wet   # opening drops the thin river channels
    near_seed = np.hypot(*np.mgrid[-seed[0]:g["rows"] - seed[0], -seed[1]:g["cols"] - seed[1]]) < 3
    lake = flood(wet | near_seed, seed)
    level = float(np.median(h[lake]))
    cover[(cover == 5) & ~lake] = 2                     # stray water pixels elsewhere read as wet meadow
    cover[lake] = 5
    # Lake bed: deeper away from the shore (depth is illustrative; no bathymetry is published).
    inside = lake.astype(float)
    for _ in range(4):
        inside = blur(inside, 3) * lake
    h = np.where(lake, np.minimum(h, level - 0.6 - 9.0 * inside), h)

    ways = {e["id"]: e for e in json.load(open(osm_path, encoding="utf-8"))["elements"] if e["type"] == "way"}

    # The drive: OSM jeep track to the first point within 40 m of the lake, resampled every 4 m.
    line = chain(ways, site["drive_ways"], site["drive_start"])
    pts = resample([to_local(g, la, lo) for la, lo in line], 4.0)
    dist = np.full(lake.shape, 1e9)
    lr, lc = np.nonzero(lake)
    lake_xz = np.stack([lc * CELL - g["W"] / 2, lr * CELL - g["H"] / 2], 1)
    end = len(pts) - 1
    for i, p in enumerate(pts):
        if np.min(np.hypot(*(lake_xz - p).T)) < 40:
            end = i
            break
    drive = pts[: end + 1]
    # Round the OSM corners into drivable curves (moving average over ~28 m); the page drives exactly this line.
    arr = np.array(drive)
    sm = np.array([arr[max(0, i - 3): i + 4].mean(0) for i in range(len(arr))])
    drive = [tuple(p) for p in sm]
    # Road profile: DEM along the track, smoothed over ~80 m, then a bench cut so the track sits on it.
    prof = np.array([bilerp(h, g, x, z) for x, z in drive])
    k = 10
    prof = np.convolve(np.pad(prof, k, mode="edge"), np.ones(2 * k + 1) / (2 * k + 1), "valid")
    rr, cc = np.mgrid[0:g["rows"], 0:g["cols"]]
    gx, gz = cc * CELL - g["W"] / 2, rr * CELL - g["H"] / 2
    near = np.full(h.shape, 1e9)
    ph = np.zeros(h.shape)
    for (x, z), y in zip(drive, prof):
        d = np.hypot(gx - x, gz - z)
        m = d < near
        near[m], ph[m] = d[m], y
    wgt = np.clip(1 - (near - 7) / 16, 0, 1)
    wgt = wgt * wgt * (3 - 2 * wgt)
    h = np.where(near < 23, h * (1 - wgt) + ph * wgt, h)

    # Far ring: same sources, 60 m cells, positioned in the near grid's local frame.
    fg = geo(site, "far_bbox", FAR_CELL)
    fh = sample_tile(dem, dem_top, dem_left, 1 / 3600, fg, 1)
    fc = np.vectorize(lambda v: COVER.get(int(v), 2))(sample_tile(wc, 36.0, 72.0, 1 / 12000, fg, 0)).astype(np.uint8)
    fx0, fz0 = to_local(g, fg["n"], fg["w"])
    fmin = float(np.floor(fh.min() - 1))
    (out / "far.bin").write_bytes(np.clip(np.rint((fh - fmin) * 2), 0, 65535).astype("<u2").tobytes())
    (out / "farcover.bin").write_bytes(fc.tobytes())

    hmin = float(np.floor(h.min() - 1))
    q = np.clip(np.rint((h - hmin) * 10), 0, 65535).astype("<u2")
    (out / "height.bin").write_bytes(q.tobytes())
    (out / "cover.bin").write_bytes(cover.tobytes())

    def line_of(ids, start=None):
        pl = chain(ways, ids, start or site["drive_start"])
        return [[round(x, 1), round(z, 1)] for x, z in resample([to_local(g, la, lo) for la, lo in pl], 8.0)]

    track = line_of(site["track_ways"])
    streams = []
    for w in ways.values():
        t = w.get("tags", {})
        if t.get("waterway") in ("river", "stream"):
            p = [to_local(g, q_["lat"], q_["lon"]) for q_ in w["geometry"]]
            p = [(x, z) for x, z in p if abs(x) < g["W"] / 2 and abs(z) < g["H"] / 2]
            if len(p) > 2:
                streams.append({"kind": t["waterway"], "name": t.get("name"),
                                "pts": [[round(x, 1), round(z, 1)] for x, z in resample(p, 10.0)]})

    seglen = [math.dist(a, b) for a, b in zip(drive, drive[1:])]
    climb = float(np.sum(np.clip(np.diff(prof), 0, None)))
    grades = np.diff(prof) / np.maximum(seglen, 0.1)
    gsm = np.convolve(grades, np.ones(15) / 15, "same")
    facts = {
        "lake_level_m": round(level),
        "lake_area_km2": round(float(lake.sum()) * CELL * CELL / 1e6, 2),
        "lake_length_km": round(float(np.ptp(lake_xz @ np.array(pca(lake_xz)))) / 1000, 2),
        "drive_km": round(sum(seglen) / 1000, 2),
        "drive_start_m": round(float(prof[0])),
        "drive_end_m": round(float(prof[-1])),
        "drive_climb_m": round(climb),
        "drive_max_grade_pct": round(float(np.max(np.abs(gsm))) * 100),
        "drive_minutes_at_9kmh": round(sum(seglen) / 1000 / 9 * 60),
        "box_km": [round(g["W"] / 1000, 2), round(g["H"] / 1000, 2)],
    }
    meta = {
        "version": 1, "site": name, "title": site["title"], "subtitle": site["subtitle"],
        "grid": {"cols": g["cols"], "rows": g["rows"], "cell": CELL, "width": g["W"], "height": g["H"],
                 "hmin": hmin, "hmax": float(h.max()), "bbox": site["bbox"]},
        "far": {"cols": fg["cols"], "rows": fg["rows"], "cell": FAR_CELL, "x0": round(fx0, 1), "z0": round(fz0, 1),
                "hmin": fmin, "scale": 0.5},
        "lake": {"level": round(level, 1), "seed": [round(sx, 1), round(sz, 1)]},
        "drive": [[round(x, 1), round(z, 1), round(float(y), 2)] for (x, z), y in zip(drive, prof)],
        "track": track,
        "streams": streams,
        "facts": facts,
        "edits": [
            "Lake bed lowered under the measured water level; the depth shown is illustrative (no published bathymetry).",
            "A bench up to 24 m wide is cut along the jeep track to the smoothed track profile (the 30 m DSM includes tree canopy).",
            "Road bumps and ruts in the drive are illustrative; the grade and the line of the track are real.",
            "Trees, shrubs, grass tufts and boulders are placed where WorldCover maps that cover; their size and number are illustrative.",
            "At the lake, the boats, tents, tea stalls, horses, season colours, snow, ice and dawn mist are illustrative; no source places them yet.",
            "The shore path is traced 20 m outside the WorldCover lake outline; it is not a mapped trail.",
        ],
        "sources": [
            {"name": "Copernicus DEM GLO-30", "use": "terrain heights", "licence": "© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA",
             "url": "https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model"},
            {"name": "ESA WorldCover 10 m 2021 v200", "use": "trees, meadow, rock, snow, the lake outline", "licence": "CC BY 4.0, © ESA WorldCover project 2021",
             "url": "https://esa-worldcover.org"},
            {"name": "OpenStreetMap", "use": "the jeep track (Mahodand Lake Road) and streams", "licence": "ODbL, © OpenStreetMap contributors",
             "url": "https://www.openstreetmap.org/copyright"},
        ],
    }
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps(facts, indent=1), g["cols"], g["rows"], len(drive))


def pca(xz):
    c = xz - xz.mean(0)
    w, v = np.linalg.eigh(c.T @ c)
    return v[:, -1]


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("site", choices=sorted(SITES))
    ap.add_argument("--dem", required=True)
    ap.add_argument("--worldcover", required=True)
    ap.add_argument("--osm", required=True)
    a = ap.parse_args()
    build(a.site, a.dem, a.worldcover, a.osm)
