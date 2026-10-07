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
        "drive_km": 0.6,                                # the page drives the last 600 m of the track (about a minute)
        "pack": "swat",
    },
    "white-palace": {
        "title": "White Palace",
        "subtitle": "Marghazar, Swat",
        "bbox": (34.641, 72.318, 34.687, 72.372),
        "arrival": {"name": "White Palace", "point": (34.66328, 72.34486)},   # the place point in regions.py
        "landmark": {"kind": "palace", "name": "White Palace", "point": (34.66328, 72.34486), "model": "palace.glb"},
        "drive_ways": [445432654, 1467739884],          # OSM road up the Marghazar valley from Saidu Sharif, past the palace gate
        "drive_start": (34.687, 72.3456),
        "track_ways": [445432654, 1467739884],
        "far_bbox": (34.575, 72.230, 34.755, 72.460),
        "osm_use": "the Marghazar road and streams",
        "road": "Marghazar road",
        "drive_km": 0.6,
        "pack": "swat-lower",
    },
}
# More sites, one JSON file each (backend/tools/diorama_sites/<site>.json, same keys as above; lists stand in for tuples).
for _f in sorted((Path(__file__).parent / "diorama_sites").glob("*.json")):
    SITES[_f.stem] = {k: tuple(v) if isinstance(v, list) and k != "drive_ways" and k != "track_ways" else v
                      for k, v in json.loads(_f.read_text(encoding="utf-8")).items()}
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


def trace_walk(site, ways, g, h, lake, lake_xz, start):
    """The foot route from the trailhead to the shore: the mapped OSM path, then (if it stops short) the easiest
    route over the DEM (cost = length x (1 + (slope / 0.25)^2)) to the nearest shore cell."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import dijkstra
    pts = [tuple(start)]
    if site.get("walk_ways"):
        line = chain(ways, site["walk_ways"], tuple(site["trailhead"]))
        pts += resample([to_local(g, la, lo) for la, lo in line], 4.0)
    inbox = lambda x, z: abs(x) < g["W"] / 2 - 20 and abs(z) < g["H"] / 2 - 20
    pts = [p for p in pts if inbox(*p)]
    near = lambda p: float(np.min(np.hypot(*(lake_xz - p).T)))
    k = next((i for i, p in enumerate(pts) if near(p) < 30), None)
    if k is None:                                   # leave the mapped path where it comes closest to the lake
        dl = [near(p) for p in pts]
        mapped = pts[: int(np.argmin(dl)) + 1]
    else:
        mapped = pts[: k + 1]
    traced = []
    if k is None:
        R, C = h.shape
        idx = np.arange(R * C).reshape(R, C)
        rows, cols, cost = [], [], []
        for dr, dc in ((0, 1), (1, 0), (1, 1), (1, -1)):
            a = idx[max(0, -dr):R - max(0, dr), max(0, -dc):C - max(0, dc)]
            b = idx[max(0, dr):R - max(0, -dr) or None, max(0, dc):C - max(0, -dc) or None]
            L = CELL * math.hypot(dr, dc)
            dh = np.abs(h.ravel()[b.ravel()] - h.ravel()[a.ravel()])
            w = L * (1 + (dh / L / 0.25) ** 2) + np.where(lake.ravel()[b.ravel()] | lake.ravel()[a.ravel()], 1e6, 0)
            rows += [a.ravel(), b.ravel()]; cols += [b.ravel(), a.ravel()]; cost += [w, w]
        G = coo_matrix((np.concatenate(cost), (np.concatenate(rows), np.concatenate(cols))), shape=(R * C, R * C)).tocsr()
        x0, z0 = mapped[-1]
        src = int(idx[int(round((z0 + g["H"] / 2) / CELL)), int(round((x0 + g["W"] / 2) / CELL))])
        dist, pred = dijkstra(G, indices=src, return_predecessors=True)
        shore = np.nonzero((~lake & (blur(lake.astype(float), 1) > 0.01)).ravel())[0]
        node = int(shore[np.argmin(dist[shore])])
        path = []
        while node != src and node >= 0:
            path.append(node); node = int(pred[node])
        traced = [((n % C) * CELL - g["W"] / 2, (n // C) * CELL - g["H"] / 2) for n in path[::-1]]
        if len(traced) > 2:
            arr = np.array(traced)
            traced = [tuple(arr[max(0, i - 2): i + 3].mean(0)) for i in range(len(arr))]
            traced = resample([mapped[-1]] + traced, 4.0)[1:]
    allp = mapped + traced
    ys = [float(bilerp(h, g, x, z)) for x, z in allp]
    L = lambda q: sum(math.dist(a, b) for a, b in zip(q, q[1:]))
    return {"trailhead": [round(start[0], 1), round(start[1], 1)],
            "pts": [[round(x, 1), round(z, 1), round(y, 1)] for (x, z), y in zip(allp, ys)][::2],
            "mapped_n": (len(mapped) + 1) // 2,
            "km": round(L(allp) / 1000, 2), "mapped_km": round(L(mapped) / 1000, 2),
            "traced_km": round((L(allp) - L(mapped)) / 1000, 2),
            "climb_m": round(float(np.sum(np.clip(np.diff(np.convolve(ys, np.ones(9) / 9, "valid")), 0, None))))}


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


def s2_water(base, g):
    """NDWI (green - nir) / (green + nir) from a Sentinel-2 L2A COG item on the local grid (nearest sample)."""
    import rasterio
    from rasterio.warp import transform, transform_bounds
    from rasterio.windows import from_bounds
    lon = g["w"] + np.arange(g["cols"]) * g["cell"] / g["mx"]
    lat = g["n"] - np.arange(g["rows"]) * g["cell"] / g["my"]
    LON, LAT = np.meshgrid(lon, lat)
    bands = {}
    with rasterio.Env(AWS_NO_SIGN_REQUEST="YES", GDAL_HTTP_MULTIRANGE="YES", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif"):
        for b in ("B03", "B08"):
            with rasterio.open(f"/vsicurl/{base.rstrip('/')}/{b}.tif") as ds:
                win = from_bounds(*transform_bounds("EPSG:4326", ds.crs, g["w"], g["s"], g["e"], g["n"], densify_pts=21), ds.transform)
                a = ds.read(1, window=win, boundless=True).astype(float)
                tr = ds.window_transform(win)
                X, Y = transform("EPSG:4326", ds.crs, LON.ravel().tolist(), LAT.ravel().tolist())
                col = np.clip(((np.array(X) - tr.c) / tr.a).astype(int), 0, a.shape[1] - 1)
                row = np.clip(((np.array(Y) - tr.f) / tr.e).astype(int), 0, a.shape[0] - 1)
                bands[b] = a[row, col].reshape(LON.shape)
    return (bands["B03"] - bands["B08"]) / (bands["B03"] + bands["B08"] + 1e-6)


def build(name, dem_path, wc_path, osm_path, s2=None):
    import tifffile
    site = SITES[name]
    g = geo(site)
    out = ROOT / "web" / "data" / "diorama" / name
    out.mkdir(parents=True, exist_ok=True)

    dem = tifffile.imread(dem_path)                      # 3600x3600, 1 degree tile; top-left from the name (N35_00_E072 -> 36N 72E)
    import re
    tn = re.search(r"N(\d+)_00_E(\d+)", Path(dem_path).name)
    dem_top, dem_left = (int(tn[1]) + 1.0, float(tn[2])) if tn else (36.0, 72.0)
    h = sample_tile(dem, dem_top, dem_left, 1 / 3600, g, 1)
    wc = tifffile.TiffFile(wc_path).pages[0].asarray()  # 36000x36000, top-left 36N 72E for N33E072
    cls = sample_tile(wc, 36.0, 72.0, 1 / 12000, g, 0)
    cover = np.vectorize(lambda v: COVER.get(int(v), 2))(cls).astype(np.uint8)

    has_lake = "lake_seed" in site
    lake = np.zeros(h.shape, bool)
    level, lake_source, sx, sz = None, None, 0.0, 0.0
    if has_lake:
        sx, sz = to_local(g, *site["lake_seed"])
        seed = (int(round((sz + g["H"] / 2) / CELL)), int(round((sx + g["W"] / 2) / CELL)))
        lake_source = "ESA WorldCover 2021"
        if s2:
            # Lake from a recent cloud-free Sentinel-2 scene: NDWI > 0.05, thin channels opened away, the patch nearest the seed.
            nd = s2_water(s2, g)
            wet = nd > 0.05
            wet = (blur((blur(wet.astype(float), 1) > 0.55).astype(float), 1) > 0.05) & wet
            rr, cc = np.nonzero(wet)
            k = np.argmin((rr - seed[0]) ** 2 + (cc - seed[1]) ** 2)
            seed = (int(rr[k]), int(cc[k]))
            cover[cover == 5] = 2
            cover[wet] = 5
            lake_source = "Sentinel-2 L2A " + s2.rstrip("/").split("/")[-1]
        # Lake: the water patch that holds the place point, cleaned by the DEM's flat surface.
        lake = flood(cover == 5, seed)                      # also follows the inflowing river upstream
        level = float(np.percentile(h[lake], 25))
        wet = (cover == 5) if s2 else (cover == 5) & (h < level + 4.0)   # Sentinel-2 water is trusted as mapped
        if not s2:
            wet = (blur((blur(wet.astype(float), 2) > 0.9).astype(float), 2) > 0.05) & wet   # opening drops the thin river channels
        near_seed = np.hypot(*np.mgrid[-seed[0]:g["rows"] - seed[0], -seed[1]:g["cols"] - seed[1]]) < 3
        mapped = lake                                       # the whole WorldCover patch, before the DEM cleaning
        lake = flood(wet | near_seed, seed)
        if not s2 and lake.sum() < 0.5 * mapped.sum():
            # The 30 m DSM over this water is too noisy to trust (the cleaning kept under half the mapped patch):
            # keep the WorldCover patch, with only its thin inflow channels opened away.
            op = (blur((blur(mapped.astype(float), 1) > 0.7).astype(float), 1) > 0.05) & mapped
            lake = flood(op | near_seed, seed)
            lake_source = "ESA WorldCover 2021 (DEM too noisy over the water to refine it)"
        level = float(np.median(h[lake]))
        cover[(cover == 5) & ~lake] = 2                     # stray water pixels elsewhere read as wet meadow
        cover[lake] = 5
        # Lake bed: deeper away from the shore (depth is illustrative; no bathymetry is published).
        inside = lake.astype(float)
        for _ in range(4):
            inside = blur(inside, 3) * lake
        h = np.where(lake, np.minimum(h, level - 0.6 - 9.0 * inside), h)
    if not has_lake:
        cover[cover == 5] = 2                           # no lake on this site: WorldCover water reads as wet meadow

    ways = {e["id"]: e for e in json.load(open(osm_path, encoding="utf-8"))["elements"] if e["type"] == "way"}

    # The drive: OSM jeep track to the first point within 40 m of the lake, resampled every 4 m.
    line = chain(ways, site["drive_ways"], site["drive_start"])
    pts = resample([to_local(g, la, lo) for la, lo in line], 4.0)
    inbox = [abs(x) < g["W"] / 2 - 60 and abs(z) < g["H"] / 2 - 60 for x, z in pts]
    first = 0 if inbox[0] else next((i for i in range(len(pts)) if all(inbox[i:i + 200])), 0)
    pts = pts[first:]                              # the drive starts where the road enters the model for good
    lr, lc = np.nonzero(lake)
    lake_xz = np.stack([lc * CELL - g["W"] / 2, lr * CELL - g["H"] / 2], 1)
    end = len(pts) - 1
    if "trailhead" in site:                        # the jeep stops where the walk to the lake begins
        tx, tz = to_local(g, *site["trailhead"])
        end = int(np.argmin([math.hypot(x - tx, z - tz) for x, z in pts]))
    elif has_lake:                                 # stop at the water
        for i, p in enumerate(pts):
            if np.min(np.hypot(*(lake_xz - p).T)) < 40:
                end = i
                break
    else:                                          # stop at the track point nearest the arrival point
        ax, az = to_local(g, *site["arrival"]["point"])
        end = int(np.argmin([math.hypot(x - ax, z - az) for x, z in pts]))
    drive = pts[: end + 1]
    # Round the OSM corners into drivable curves (moving average over ~28 m); the page drives exactly this line.
    arr = np.array(drive)
    sm = np.array([arr[max(0, i - 3): i + 4].mean(0) for i in range(len(arr))])
    drive = [tuple(p) for p in sm]
    # Buildings: OSM footprints inside the model (local metres), with their mapped levels when tagged.
    buildings = []
    for w in ways.values():
        t = w.get("tags", {})
        if "building" not in t or len(w.get("geometry", [])) < 4:
            continue
        fp = [to_local(g, p["lat"], p["lon"]) for p in w["geometry"]]
        if all(abs(x) < g["W"] / 2 - 20 and abs(z) < g["H"] / 2 - 20 for x, z in fp):
            lv = t.get("building:levels", "")
            buildings.append({"id": w["id"], "kind": t["building"], "levels": int(lv) if lv.isdigit() else None,
                              "pts": [[round(x, 1), round(z, 1)] for x, z in fp[:-1]]})
    walk = trace_walk(site, ways, g, h, lake, lake_xz, drive[-1]) if "trailhead" in site else None
    # A landmark stands on a level terrace of lawn (its grounds); trees are kept off it.
    if "landmark" in site:
        lx, lz = to_local(g, *site["landmark"]["point"])
        rr_, cc_ = np.mgrid[0:g["rows"], 0:g["cols"]]
        dl = np.hypot(cc_ * CELL - g["W"] / 2 - lx, rr_ * CELL - g["H"] / 2 - lz)
        ly = float(bilerp(h, g, lx, lz))
        t = np.clip((dl - 58) / 25, 0, 1)
        t = t * t * (3 - 2 * t)
        h = np.where(dl < 83, ly * (1 - t) + h * t, h)
        cover[(dl < 70) & (cover != 5)] = 2

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
            parts = [resample(p, 10.0)] if len(p) > 2 else []
            if "landmark" in site:                 # the river is cut where it meets the levelled grounds, never bridged across them
                lx, lz = to_local(g, *site["landmark"]["point"])
                cut, run = [], []
                for x, z in parts[0] if parts else []:
                    if math.hypot(x - lx, z - lz) > 110:
                        run.append((x, z))
                    elif run:
                        cut.append(run); run = []
                parts = cut + ([run] if run else [])
            for q in parts:
                if len(q) > 2:
                    streams.append({"kind": t["waterway"], "name": t.get("name"), "pts": [[round(x, 1), round(z, 1)] for x, z in q]})

    seglen = [math.dist(a, b) for a, b in zip(drive, drive[1:])]
    climb = float(np.sum(np.clip(np.diff(prof), 0, None)))
    grades = np.diff(prof) / np.maximum(seglen, 0.1)
    gsm = np.convolve(grades, np.ones(15) / 15, "same")
    # Where the visit happens: the lake (its centre, at its level) or a named viewpoint at the end of the drive.
    if has_lake:
        cx, cz = lake_xz.mean(0)
        arrival = {"kind": "lake", "name": site["title"], "x": round(float(cx), 1), "z": round(float(cz), 1), "y": round(level, 1)}
    else:
        ax, az = to_local(g, *site["arrival"]["point"])
        arrival = {"kind": "viewpoint", "name": site["arrival"]["name"], "x": round(ax, 1), "z": round(az, 1),
                   "y": round(float(bilerp(h, g, ax, az)), 1)}
    facts = {
        **({"lake_level_m": round(level),
            "lake_area_km2": round(float(lake.sum()) * CELL * CELL / 1e6, 2),
            "lake_length_km": round(float(np.ptp(lake_xz @ np.array(pca(lake_xz)))) / 1000, 2)} if has_lake else {}),
        "drive_km": round(sum(seglen) / 1000, 2),
        "drive_start_m": round(float(prof[0])),
        "drive_end_m": round(float(prof[-1])),
        "drive_climb_m": round(climb),
        "drive_max_grade_pct": round(float(np.max(np.abs(gsm))) * 100),
        "drive_minutes_at_9kmh": round(sum(seglen) / 1000 / 9 * 60),
        **({"walk_km": walk["km"], "walk_mapped_km": walk["mapped_km"], "walk_traced_km": walk["traced_km"],
            "walk_climb_m": walk["climb_m"]} if walk else {}),
        "box_km": [round(g["W"] / 1000, 2), round(g["H"] / 1000, 2)],
        "arrival_m": round(arrival["y"]),
    }
    meta = {
        "version": 1, "site": name, "title": site["title"], "subtitle": site["subtitle"], "road": site.get("road", "Mahodand Lake Road"), "pack": site.get("pack", "swat"),
        "grid": {"cols": g["cols"], "rows": g["rows"], "cell": CELL, "width": g["W"], "height": g["H"],
                 "hmin": hmin, "hmax": float(h.max()), "bbox": site["bbox"]},
        "far": {"cols": fg["cols"], "rows": fg["rows"], "cell": FAR_CELL, "x0": round(fx0, 1), "z0": round(fz0, 1),
                "hmin": fmin, "scale": 0.5},
        "lake": {"level": round(level, 1), "seed": [round(sx, 1), round(sz, 1)], "outline": lake_source} if has_lake else None,
        "arrival": arrival,
        "landmark": ({**{k: v for k, v in site["landmark"].items() if k != "point"}, "x": round(to_local(g, *site["landmark"]["point"])[0], 1),
                      "z": round(to_local(g, *site["landmark"]["point"])[1], 1)} if "landmark" in site else None),
        "drive": [[round(x, 1), round(z, 1), round(float(y), 2)] for (x, z), y in zip(drive, prof)],
        "track": track,
        "walk": walk,
        "buildings": buildings,
        "streams": streams,
        "facts": facts,
        "edits": [
            *(["Lake bed lowered under the measured water level; the depth shown is illustrative (no published bathymetry)."] if has_lake else []),
            "A bench up to 24 m wide is cut along the jeep track to the smoothed track profile (the 30 m DSM includes tree canopy).",
            "Road bumps and ruts in the drive are illustrative; the grade and the line of the track are real.",
            "Trees, shrubs, grass tufts and boulders are placed where WorldCover maps that cover; their size and number are illustrative.",
            *(["At the lake, the positions of the boats, tents, tea stalls and horses are illustrative (boating is described by the sources and seen in Commons photos).",
               "The shore path is traced 20 m outside the lake outline; it is not a mapped trail."] if has_lake else
              ["The walking loop is a 150 m circle around the arrival point; it is not a mapped trail."]),
            *(["The palace grounds are levelled to a terrace 58 m around the place point and kept as lawn."] if "landmark" in site else []),
            *(["The palace is the Atlas's TRELLIS model made from three CC BY-SA Wikimedia Commons photos (palace.attribution.txt), scaled to a 24 m front; the wings, lawn, tables and trees around it are laid out after visitors' photos. None of it is a survey (OSM maps no footprint)."] if "landmark" in site else []),
            *([f"The walk from the end of the jeep track follows the mapped OSM footpath for {walk['mapped_km']} km"
               + (f"; the last {walk['traced_km']} km is not mapped and is traced over the ground (easiest slope on the DEM)." if walk["traced_km"] else ".")]
              if walk else []),
            *([f"The {len(buildings)} buildings stand on their OSM footprints; their height (OSM levels where mapped, else one or two storeys), roofs and colours are illustrative, after visitors' photos."] if buildings else []),
            "Season colours, snow, ice and dawn mist are illustrative.",
            "Traffic on the drive is illustrative: the vehicle kinds are those seen on Swat roads (Willys jeeps, Hilux, Suzuki vans, Mehran cars, CD70 motorbikes, Qingqi rickshaws, painted trucks); their number and movement are not counted.",
        ],
        "sources": ([{"name": "Copernicus Sentinel-2 L2A", "use": f"the lake outline (NDWI, scene {lake_source.split()[-1]})",
                      "licence": "Contains modified Copernicus Sentinel data 2025", "url": "https://registry.opendata.aws/sentinel-2-l2a-cogs/"}] if s2 else []) + [
            {"name": "Copernicus DEM GLO-30", "use": "terrain heights", "licence": "© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA",
             "url": "https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model"},
            {"name": "ESA WorldCover 10 m 2021 v200", "use": "trees, meadow, rock, snow" + ("" if s2 else ", the lake outline"), "licence": "CC BY 4.0, © ESA WorldCover project 2021",
             "url": "https://esa-worldcover.org"},
            *([{"name": "White Palace model (TRELLIS, MIT)", "use": "the palace, generated from Commons photos by Adilswati, Arszul123 and Ihsan Farid",
                 "licence": "CC BY-SA 3.0 / 4.0 (texture derived from the photos)", "url": "https://commons.wikimedia.org/wiki/File:White_Palace_Maraghzar,_Swat.jpg"}]
              if site.get("landmark", {}).get("model") else []),
            {"name": "OpenStreetMap", "use": site.get("osm_use", "the jeep track (Mahodand Lake Road) and streams"), "licence": "ODbL, © OpenStreetMap contributors",
             "url": "https://www.openstreetmap.org/copyright"},
        ],
    }
    if site.get("drive_km"):
        meta = shorten(meta, site["drive_km"])
        facts = meta["facts"]
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps(facts, indent=1), g["cols"], g["rows"], len(drive))


def shorten(meta, km):
    """Keep the last `km` of the drive (the climb into the site), and measure its facts again from the same profile."""
    d = meta["drive"]
    acc, i = 0.0, len(d) - 1
    while i > 0 and acc < km * 1000:
        acc += math.dist(d[i][:2], d[i - 1][:2]); i -= 1
    d = meta["drive"] = d[i:]
    seg = [math.dist(a[:2], b[:2]) for a, b in zip(d, d[1:])]
    prof = np.array([p[2] for p in d])
    gsm = np.convolve(np.diff(prof) / np.maximum(seg, 0.1), np.ones(15) / 15, "same")
    F = meta["facts"]
    F.update(drive_km=round(sum(seg) / 1000, 2), drive_start_m=round(float(prof[0])), drive_end_m=round(float(prof[-1])),
             drive_climb_m=round(float(np.sum(np.clip(np.diff(prof), 0, None)))), drive_max_grade_pct=round(float(np.max(np.abs(gsm))) * 100),
             drive_minutes_at_9kmh=round(sum(seg) / 1000 / 9 * 60))
    return meta


def pca(xz):
    c = xz - xz.mean(0)
    w, v = np.linalg.eigh(c.T @ c)
    return v[:, -1]


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("site", choices=sorted(SITES))
    ap.add_argument("--dem")
    ap.add_argument("--worldcover")
    ap.add_argument("--osm")
    ap.add_argument("--shorten-only", action="store_true", help="trim an existing meta.json's drive to the site's drive_km")
    ap.add_argument("--s2", help="Sentinel-2 L2A COG item base URL (sentinel-cogs bucket) for the lake outline")
    a = ap.parse_args()
    if a.shorten_only:
        f = ROOT / "web" / "data" / "diorama" / a.site / "meta.json"
        f.write_text(json.dumps(shorten(json.loads(f.read_text(encoding="utf-8")), SITES[a.site]["drive_km"]), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        raise SystemExit
    build(a.site, a.dem, a.worldcover, a.osm, a.s2)
