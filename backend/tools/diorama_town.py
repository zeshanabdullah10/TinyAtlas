"""Village houses for a built diorama where OSM maps no building: Microsoft's ML building footprints, then
illustrative houses on WorldCover built-up land.

    python backend/tools/diorama_town.py <site> [<site> ...]      (or --all)   [--worldcover data/inputs/WC_crop_N36_E072.tif]

Most Swat villages have no building footprints in OSM. Two open sources fill the gap, in this order:
1. Microsoft Global ML Building Footprints (detected by a model from Bing Maps imagery 2014-2024, CDLA Permissive
   2.0): data/inputs/msbuildings/<quadkey>.csv.gz, the zoom-9 tiles listed in dataset-links.csv there
   (https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv). A footprint is kept when no
   OSM building is within 7 m of it; it is drawn as the rectangle round it (they are rectangles).
2. ESA WorldCover 2021 "built-up" (class 50) cells on the site's own 10 m grid (the same nearest-cell sampling as
   diorama_build.py), where neither source shows a building: at most one illustrative house per cell.
Both are kept off roads and paths, rivers, the lake, the landmark's grounds and the walking circle; the WorldCover
houses also off slopes over 35 degrees. Nearest the arrival first, within `buildings_radius_m` when the site sets it,
capped. Writes web/data/diorama/<site>/town.json:

  houses   [[x, z, w, d, rot_deg, storeys, style, mapped], ...]  mapped 1 = an ML footprint, 0 = illustrative.
  hotels   [[name, x, z], ...]  OSM tourism=hotel/motel/guest_house points with no footprint (drawn as blocks).
  edits    the lines for meta.edits (written there now, with the source; the page adds them when a rebuild dropped them).

Storeys, walls and roofs are illustrative (style 0-3 upper-valley stone, timber, mud and tin; 4-6 lower-Swat plaster,
brick and concrete, by the ground height). Deterministic: rerunning gives the same file. Run it again after a rebuild.
"""
import gzip
import json
import math
import re
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from diorama_build import ROOT, SITES, geo, sample_tile, to_local  # noqa: E402

WC = ROOT / "data" / "inputs" / "WC_crop_N36_E072.tif"
MSB = ROOT / "data" / "inputs" / "msbuildings"
MSB_SOURCE = {"name": "Microsoft Global ML Building Footprints", "use": "building footprints where OSM maps none (detected by a model from Bing Maps imagery, 2014-2024); heights and looks are illustrative",
              "licence": "CDLA Permissive 2.0, Microsoft", "url": "https://github.com/microsoft/GlobalMLBuildingFootprints"}
CAP = 2600                     # houses per site at most (the page stays light); the nearest the arrival are kept
MARK = "illustrative houses stand where ESA WorldCover 2021 maps built-up land"
MLMARK = "are Microsoft's ML building footprints"


def quadkey(lat, lon, z=9):
    x = (lon + 180) / 360; s = math.sin(math.radians(lat)); y = 0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)
    tx, ty = int(x * 2 ** z), int(y * 2 ** z)
    return "".join(str((1 if tx & (1 << (i - 1)) else 0) + (2 if ty & (1 << (i - 1)) else 0)) for i in range(z, 0, -1))


def ml_footprints(boxes):
    """{site: [[(lat, lon), ...], ...]} for every site box [S, W, N, E], read once from the tiles that cover them."""
    out = {k: [] for k in boxes}
    keys = {quadkey(la, lo) for b in boxes.values() for la in (b[0], b[2]) for lo in (b[1], b[3])}
    num = re.compile(r"\[([0-9.]+), ([0-9.]+)\]")
    for k in sorted(keys):
        f = MSB / f"{k}.csv.gz"
        if not f.exists():
            print(f"  (no ML footprint tile {k}; download it from dataset-links.csv)")
            continue
        for line in gzip.open(f, "rt"):
            m = num.search(line)
            lon, lat = float(m[1]), float(m[2])
            hit = [s for s, b in boxes.items() if b[0] - 0.002 < lat < b[2] + 0.002 and b[1] - 0.002 < lon < b[3] + 0.002]
            if hit:
                ring = [(la, lo) for lo, la in json.loads(line)["geometry"]["coordinates"][0][:-1]]
                for s in hit:
                    out[s].append(ring)
    return out


def rect(pts):
    """The rectangle round a footprint, along its longest edge: centre x, z, length, width, bearing (deg, of the length)."""
    n = len(pts)
    i = max(range(n), key=lambda i: math.dist(pts[i], pts[(i + 1) % n]))
    a = math.atan2(pts[(i + 1) % n][1] - pts[i][1], pts[(i + 1) % n][0] - pts[i][0])
    u = [p[0] * math.cos(a) + p[1] * math.sin(a) for p in pts]
    v = [-p[0] * math.sin(a) + p[1] * math.cos(a) for p in pts]
    cu, cv = (min(u) + max(u)) / 2, (min(v) + max(v)) / 2
    return cu * math.cos(a) - cv * math.sin(a), cu * math.sin(a) + cv * math.cos(a), max(u) - min(u), max(v) - min(v), math.degrees(a) % 180


def look(H, r, c, q, big=False):
    """Storeys and style by the ground height (upper valleys: stone, timber, mud and tin; lower Swat: plaster, brick)."""
    if H[r, c] > 1250:
        return (3 if big else 1 if q < 0.5 else 2), (0 if q < 0.35 else 1 if q < 0.62 else 2 if q < 0.84 else 3)
    return (3 if big else 1 if q < 0.35 else 2 if q < 0.85 else 3), (4 if q < 0.6 else 5 if q < 0.82 else 6)


def h(a, b, c=0):
    """Deterministic [0, 1) from integers (the same in every run)."""
    x = (a * 374761393 + b * 668265263 + c * 2246822519) & 0xFFFFFFFF
    x = ((x ^ (x >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((x ^ (x >> 16)) & 0xFFFFFFFF) / 4294967296


def mark_line(mask, g, pts, r):
    """Mark grid cells within r metres of a polyline [[x, z], ...] (local metres)."""
    cell, cols, rows = g["cell"], g["cols"], g["rows"]
    x0, z0 = -g["W"] / 2, -g["H"] / 2
    k = int(math.ceil(r / cell)) + 1
    for i in range(len(pts)):
        a = pts[i]; b = pts[min(i + 1, len(pts) - 1)]
        L = math.hypot(b[0] - a[0], b[1] - a[1]); n = max(1, int(L / (cell * 0.5)))
        for j in range(n + 1):
            x = a[0] + (b[0] - a[0]) * j / n; z = a[1] + (b[1] - a[1]) * j / n
            c0, r0 = int(round((x - x0) / cell)), int(round((z - z0) / cell))
            for dr in range(-k, k + 1):
                for dc in range(-k, k + 1):
                    rr, cc = r0 + dr, c0 + dc
                    if 0 <= rr < rows and 0 <= cc < cols and math.hypot(x0 + cc * cell - x, z0 + rr * cell - z) <= r:
                        mask[rr, cc] = True


def town(name, wc, ml):
    d = ROOT / "web" / "data" / "diorama" / name
    meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
    site = SITES.get(name, {})
    gr = meta["grid"]
    g = geo({"bbox": gr["bbox"]})
    assert (g["cols"], g["rows"]) == (gr["cols"], gr["rows"]), f"{name}: grid does not match meta"
    cls = sample_tile(wc, 36.0, 72.0, 1 / 12000, g, 0)
    rows, cols, cell = g["rows"], g["cols"], g["cell"]
    x0, z0 = -g["W"] / 2, -g["H"] / 2
    Y0 = meta["lake"]["level"] if meta.get("lake") else meta["arrival"]["y"]
    H = np.frombuffer((d / "height.bin").read_bytes(), "<u2").reshape(rows, cols) / 10 + gr["hmin"]
    C = np.frombuffer((d / "cover.bin").read_bytes(), np.uint8).reshape(rows, cols)
    built = (cls == 50) & (C != 5)
    n_built = int(built.sum())

    block = np.zeros_like(built)
    # OSM buildings: every footprint in the extract when it is here (some are left out of meta by buildings_radius_m),
    # else the drawn ones. Their cells (and one around) are mapped ground, not ours to fill.
    osm_path = ROOT / "data" / "inputs" / "osm" / f"{name}.json"
    feet, ways, hotels = [], [], []
    if osm_path.exists():
        els = json.loads(osm_path.read_text(encoding="utf-8"))["elements"]
        for e in els:
            t = e.get("tags", {})
            if e["type"] == "way" and e.get("geometry"):
                pts = [to_local(g, p["lat"], p["lon"]) for p in e["geometry"]]
                if "building" in t:
                    feet.append(pts)
                elif "highway" in t:
                    ways.append((pts, 6 if t["highway"] in ("path", "footway", "steps", "track") else 8))
            if t.get("tourism") in ("hotel", "motel", "guest_house") and t.get("name"):
                if e["type"] == "node":
                    hx, hz = to_local(g, e["lat"], e["lon"])
                    hotels.append([t["name"], round(hx, 1), round(hz, 1)])
    for b in meta.get("buildings") or []:
        feet.append(b["pts"])
    for pts in feet:
        cx, cz = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
        mark_line(block, g, list(pts) + [[cx, cz]], 7)
    for pts, r in ways:
        mark_line(block, g, pts, r)
    mark_line(block, g, [p[:2] for p in meta["drive"]], 11)
    mark_line(block, g, meta["track"], 10)
    if meta.get("walk"):
        mark_line(block, g, meta["walk"].get("pts") or [], 5)
    for s in meta["streams"]:
        mark_line(block, g, s["pts"], 16 if s["kind"] == "river" else 7)
    block |= cls == 80                                    # open water the 2021 map shows (rivers, ponds)
    A, lm = meta["arrival"], meta.get("landmark")
    rr, cc = np.mgrid[0:rows, 0:cols]
    X, Z = x0 + cc * cell, z0 + rr * cell
    if lm:
        keep = max(lm.get("terrace_m") or 0, lm.get("clear_m") or 0, (lm.get("ring_m") or 52) + 10, 45)
        block |= np.hypot(X - lm["x"], Z - lm["z"]) < keep
    else:                                                 # the walking circle round the arrival (150 m) and its centre
        ra = np.hypot(X - A["x"], Z - A["z"])
        block |= (ra < 22) | (abs(ra - 150) < 7)
    gy, gx = np.gradient(H, cell)
    block |= np.degrees(np.arctan(np.hypot(gx, gy))) > 35
    free = built & ~block
    radius = site.get("buildings_radius_m")
    dist = np.hypot(X - A["x"], Z - A["z"])
    if radius:
        free &= dist <= radius
    idx = np.argwhere(free)
    idx = idx[np.argsort(dist[free], kind="stable")]

    # 1. ML footprints: not within 7 m of an OSM building, not on a road, river or the landmark's grounds
    near_osm = np.zeros_like(block)
    for pts in feet:
        cx, cz = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
        mark_line(near_osm, g, list(pts) + [[cx, cz]], 7)
    lane = np.zeros_like(block)
    for pts, r in ways:
        mark_line(lane, g, pts, r - 3)
    mark_line(lane, g, [p[:2] for p in meta["drive"]], 9)
    mark_line(lane, g, meta["track"], 7)
    for s_ in meta["streams"]:
        mark_line(lane, g, s_["pts"], 8 if s_["kind"] == "river" else 3)
    if lm:
        lane |= np.hypot(X - lm["x"], Z - lm["z"]) < keep
    else:
        lane |= np.hypot(X - A["x"], Z - A["z"]) < 22
    ml_houses = []
    for ring in ml:
        pts = [to_local(g, la, lo) for la, lo in ring]
        x, z, w, dd, rot = rect(pts)
        c, r = int(round((x - x0) / cell)), int(round((z - z0) / cell))
        if not (2 <= c < cols - 2 and 2 <= r < rows - 2) or w * dd < 12 or w * dd > 2500 or near_osm[r, c] or lane[r, c] or C[r, c] == 5:
            continue
        if radius and dist[r, c] > radius:
            continue
        storeys, style = look(H, r, c, h(r, c, 7), big=w * dd > 260)
        ml_houses.append((dist[r, c], [round(x, 1), round(z, 1), round(max(w, 3), 1), round(max(dd, 3), 1), round(rot), storeys, style, 1]))
    ml_houses.sort(key=lambda t: t[0])
    houses = [hh for _, hh in ml_houses[:CAP]]
    n_ml = len(houses)
    # where either source maps buildings within 30 m, the gaps between them are lanes and yards, not unmapped houses
    mapped = near_osm.copy()
    for hh in houses:
        c, r = int(round((hh[0] - x0) / cell)), int(round((hh[1] - z0) / cell))
        mapped[r, c] = True
    k = 3
    pad = np.pad(mapped, k)
    near = np.zeros_like(mapped)
    for dr in range(-k, k + 1):
        for dc in range(-k, k + 1):
            if dr * dr + dc * dc <= k * k:
                near |= pad[k + dr:k + dr + rows, k + dc:k + dc + cols]
    block |= near

    # 2. WorldCover built-up cells that are still empty: illustrative houses
    for r, c in idx:
        r, c = int(r), int(c)
        if block[r, c]:
            continue
        if h(r, c, 1) > 0.62:                             # not every built-up cell is a roof: yards, lanes, fields between
            continue
        x = x0 + c * cell + (h(r, c, 2) - 0.5) * 3
        z = z0 + r * cell + (h(r, c, 3) - 0.5) * 3
        w, dd = 5.5 + h(r, c, 4) * 4.0, 4.8 + h(r, c, 5) * 3.2
        asp = math.degrees(math.atan2(gy[r, c], gx[r, c]))      # long side along the contour, as hillside houses are built
        slope = math.hypot(gx[r, c], gy[r, c])
        rot = (asp + 90 if slope > 0.12 else 15 * round(h(r, c, 6) * 6)) % 180
        storeys, style = look(H, r, c, h(r, c, 7))
        houses.append([round(x, 1), round(z, 1), round(w, 1), round(dd, 1), round(rot), storeys, style, 0])
        if len(houses) >= CAP:
            break
    hotels = [hh for hh in hotels if abs(hh[1]) < g["W"] / 2 - 30 and abs(hh[2]) < g["H"] / 2 - 30     # on the model, not
              and not any(math.hypot(hh[1] - sum(p[0] for p in f) / len(f), hh[2] - sum(p[1] for p in f) / len(f)) < 15 for f in feet)]  # already a footprint
    n_wc = len(houses) - n_ml
    parts = []
    if n_ml:
        parts.append(f"{n_ml} buildings {MLMARK} where OSM maps none (detected by a model from Bing Maps imagery, 2014-2024; "
                     f"it can miss or merge houses){', the nearest the arrival within ' + str(radius) + ' m' if radius else ''}: "
                     "each is drawn as the rectangle round its footprint; storeys, walls and roofs are illustrative.")
    if n_wc:
        parts.append(f"{n_wc} {MARK} ({n_built} cells of 10 m in this model) and neither OSM nor the ML footprints show a building within 30 m: at most one per "
                f"cell{', nearest the arrival, within ' + str(radius) + ' m' if radius else ''}, kept off roads, rivers, the "
                f"landmark's grounds and slopes over 35 degrees. Their size, height, walls and roofs are illustrative, after "
                f"visitors' photos of Swat villages (stone, timber and mud or tin roofs above about 1,250 m; plaster and brick below).")
    if hotels:
        parts.append(f"The {len(hotels)} hotels OSM maps only as named points are drawn there as "
                     "three-storey blocks; their footprint, height and roof colour are illustrative.")
    out = {"v": 1, "source": "Microsoft Global ML Building Footprints (CDLA Permissive 2.0); ESA WorldCover 10 m 2021 v200 class 50 (built-up) on this model's grid; OSM buildings, roads and hotels",
           "built_cells": n_built, "houses": houses, "hotels": hotels, "edits": parts}
    (d / "town.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    before = json.dumps(meta)
    meta["edits"] = [e for e in meta["edits"] if MARK not in e and MLMARK not in e and "hotels OSM maps only as named points" not in e]
    meta["edits"] += parts
    meta["sources"] = [x for x in meta["sources"] if x["name"] != MSB_SOURCE["name"]] + ([MSB_SOURCE] if n_ml else [])
    if json.dumps(meta) != before:
        (d / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return n_ml, n_wc, len(hotels), n_built


if __name__ == "__main__":
    import tifffile
    args = sys.argv[1:]
    wc_path = WC
    if "--worldcover" in args:
        i = args.index("--worldcover"); wc_path = Path(args[i + 1]); del args[i:i + 2]
    names = sorted(p.parent.name for p in (ROOT / "web" / "data" / "diorama").glob("*/meta.json")) if args == ["--all"] else args
    wc = tifffile.imread(wc_path)
    boxes = {s: json.loads((ROOT / "web" / "data" / "diorama" / s / "meta.json").read_text(encoding="utf-8"))["grid"]["bbox"] for s in names}
    ml = ml_footprints(boxes)
    for s in names:
        n, k, o, b = town(s, wc, ml[s])
        print(f"{s:28} {n:5} ML footprints  {k:5} WorldCover houses  {o:2} hotels  ({b} built-up cells)")
