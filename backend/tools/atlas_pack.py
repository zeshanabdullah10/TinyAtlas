"""Build an Atlas pack (docs/atlas-pack-v1.md) from a geo bundle + research data.

    python backend/tools/atlas_pack.py <bundle> [--no-bake] [--only albedo,vectors,places,models,sky,terrain,trees,check,files]

<bundle> is a name in data/bundles/ (its far backdrop is <bundle>_far); the pack slug is the bundle name with "_" -> "-".
Per-pack settings (title, home camera, place filter, neighbours) live in PACKS below.

Output: data/packs/<slug>/atlas/.  The near-terrain albedo is baked by Blender (build_scene.py --bake-albedo,
one 384 px DIFFUSE-colour tile + one 96 px AO tile per 128-cell chunk); the rest is numpy / PIL / shapely / trimesh.
"""
import argparse, json, math, re, shutil, subprocess, sys, time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from pyproj import Transformer

sys.path.insert(0, str(Path(__file__).resolve().parent))
from shortname import short_name

ROOT = Path(__file__).resolve().parents[2]
BLENDER = Path("D:/TinyAtlas/tools/blender-5.2.2-windows-x64/blender.exe")
CC = 128                       # chunk cells
PXC = 384                      # L0 tile px
OV_SHOT = dict(lat=35.60, lon=72.60, heading=5.0, pitch=-31.0, dist=42000.0, sun_az=215.0, sun_el=15.0, sun_color=(1.0, 0.74, 0.46))
PACKS = {
    "swat": dict(title="Swat Valley", subtitle="Kalam \u00b7 Utror \u00b7 Ushu \u00b7 Mahodand", shot=OV_SHOT, exag=1.6, bake_shot="overview",
                 areas=None, peak_tier2_min=5500, drop_empty_routes=False,
                 neighbors=[{"slug": "swat-lower", "title": "Lower Swat", "edge": "south"}],
                 # Explore-dock cameras: (name, lat, lon, heading°, pitch°, distance m). Headings chosen by viewing each
                 # framing: no ridge in front of the key places, sun (~215°) raking from the side, not into the camera.
                 explore=[("Kalam & Ushu", 35.54, 72.64, 10, -30, 15000), ("Utror & Gabral", 35.50, 72.445, 15, -30, 11000),
                          ("Mahodand", 35.708, 72.654, 345, -30, 9000), ("Kumrat", 35.52, 72.22, 20, -30, 14000)]),
    "swat_lower": dict(title="Lower Swat", subtitle="Mingora \u00b7 Udegram \u00b7 Malam Jabba \u00b7 Bahrain",
                       shot=dict(lat=34.84, lon=72.40, heading=25.0, pitch=-28.0, dist=36000.0, sun_az=238.0, sun_el=14.0, sun_color=(1.0, 0.76, 0.5)),
                       exag=1.8, bake_shot="lower", lowland=True, areas={"swat-lower", "swat-mid", "malam-jabba", "gateway"}, peak_tier2_min=2500,
                       drop_empty_routes=True, neighbors=[{"slug": "swat", "title": "Swat Valley", "edge": "north"}],
                       explore=[("Mingora & Saidu Sharif", 34.76, 72.36, 25, -30, 9000), ("Udegram & Barikot", 34.72, 72.26, 25, -30, 14000),
                                ("Malam Jabba", 34.805, 72.53, 25, -30, 12000), ("Madyan & Bahrain", 35.17, 72.54, 25, -30, 12000)]),
}
HWY_CLASS = {"motorway": "paved", "trunk": "paved", "primary": "paved", "secondary": "paved", "tertiary": "jeep",
             "unclassified": "minor", "residential": "minor", "service": "minor", "living_street": "minor",
             "track": "track", "path": "path", "footway": "path", "steps": "path", "bridleway": "path", "cycleway": "path"}
GAZETTEER = "data/research/swat_gazetteer.json"
SCALE_GUESS = {"white-palace-marghazar": 40.0, "jamia-masjid-thal": 25.0, "swat-museum": 45.0}   # footprint widths, estimates
TRELLIS = set(SCALE_GUESS)
MAJOR_LAKES = ("mahodand", "kundol", "spin khwar", "izmis", "kharkhari")   # tier 1 regardless of area; others if >= 0.15 km2
HERITAGE = {"stupa", "fort_ruin", "archaeological_site", "museum", "palace", "mosque", "rock_carving"}

T0 = time.time()


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


def jdump(p, obj):
    Path(p).write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def srgb2lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin2srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


class Grid:
    def __init__(self, name):
        self.dir = ROOT / "data" / "bundles" / name
        self.meta = json.loads((self.dir / "meta.json").read_text(encoding="utf-8"))
        t = self.meta["transform"]
        self.res, self.x0, self.y1 = self.meta["res"], t[2], t[5]
        self.W, self.H = self.meta["width"], self.meta["height"]
        self.h = np.load(self.dir / "height.npy").astype(np.float32)

    def sample(self, x_m, z_m):
        """bilinear DEM at scene-style metres from this grid's NW corner (cells are pixel-centred)."""
        c = np.clip(np.asarray(x_m, float) / self.res - 0.5, 0, self.W - 1.001)
        r = np.clip(np.asarray(z_m, float) / self.res - 0.5, 0, self.H - 1.001)
        c0, r0 = c.astype(int), r.astype(int); fc, fr = c - c0, r - r0
        h = self.h
        return (h[r0, c0] * (1 - fc) * (1 - fr) + h[r0, c0 + 1] * fc * (1 - fr) + h[r0 + 1, c0] * (1 - fc) * fr + h[r0 + 1, c0 + 1] * fc * fr)


def save_webp(arr, path, q=82):
    Image.fromarray(arr).save(path, "WEBP", quality=q, method=4)


# ---------------------------------------------------------------- terrain
def step_terrain(ctx):
    near, far, out = ctx["near"], ctx["far"], ctx["out"]
    for g, fn in ((near, "height.bin"), (far, "far.bin")):
        lo, hi = float(g.h.min()), float(g.h.max())
        g.hmin, g.hmax = lo, hi
        v = np.round((g.h - lo) / (hi - lo) * 65535).astype("<u2")
        v.tofile(out / fn)
    m = near.meta
    x0, y1 = near.x0, near.y1
    ncx, ncy = -(-near.W // CC), -(-near.H // CC)
    tr = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True)
    cfg = ctx["cfg"]; sh = cfg["shot"]
    tx, ty = tr.transform(sh["lon"], sh["lat"])
    tx_s, tz_s = tx - x0, y1 - ty
    ground = float(near.sample(tx_s, tz_s))
    attrib = [m["layers"][k]["attribution"] for k in ("height", "landcover", "satellite", "osm") if k in m["layers"]]
    attrib += ["Sky: Poly Haven 'belfast_sunset_puresky' HDRI, CC0", "Landmark shapes: TRELLIS (Microsoft, MIT licence)",
               "Photos: Wikimedia Commons contributors, licences as credited per photo"]
    meta = {
        "version": 1, "slug": ctx["slug"], "title": cfg["title"], "subtitle": cfg["subtitle"],
        "crs": m["crs"], "origin_utm": [x0, y1], "res_m": int(near.res), "cols": near.W, "rows": near.H,
        "size_m": [near.W * near.res, near.H * near.res], "hmin": round(near.hmin, 2), "hmax": round(near.hmax, 2),
        "chunk_cells": CC, "chunks": [ncx, ncy], "albedo_levels": 4, "albedo_px_m": 10,
        "far": {"origin_m": [far.x0 - x0, y1 - far.y1], "size_m": [far.W * far.res, far.H * far.res], "cols": far.W, "rows": far.H,
                "res_m": int(far.res), "hmin": round(far.hmin, 2), "hmax": round(far.hmax, 2)},
        "exag_default": cfg["exag"], "tree_scale_default": 2.5, "landmark_scale_default": 30,
        "sun_default": {"azimuth_deg": sh["sun_az"], "elevation_deg": sh["sun_el"], "color": list(sh["sun_color"])},
        "home_camera": {"target": [round(tx_s, 1), round(ground, 1), round(tz_s, 1)], "heading_deg": sh["heading"],
                        "pitch_deg": sh["pitch"], "distance_m": sh["dist"]},
        "attribution": attrib,
    }
    if cfg.get("neighbors"): meta["neighbors"] = cfg["neighbors"]
    areas = []
    for nm, lat, lon, hd, pt, dist in cfg.get("explore", []):
        ax, ay = tr.transform(lon, lat); xs, zs = ax - x0, y1 - ay
        areas.append({"name": nm, "camera": {"target": [round(xs, 1), round(float(near.sample(xs, zs)), 1), round(zs, 1)],
                                             "heading_deg": hd, "pitch_deg": pt, "distance_m": dist}})
    if areas: meta["areas"] = areas
    jdump(out / "meta.json", meta)
    ctx["meta"] = meta
    log("terrain", (out / "height.bin").stat().st_size, (out / "far.bin").stat().st_size)


# ---------------------------------------------------------------- albedo
def run_bake(raw_dir, ncx, ncy, ctx):
    n = len(list(raw_dir.glob("col_*.npy"))) if raw_dir.exists() else 0
    if n >= ncx * ncy and len(list(raw_dir.glob("ao_*.npy"))) >= ncx * ncy:
        log("bake tiles present", n); return None
    log("running Blender bake ...")
    t = time.time()
    subprocess.run([str(BLENDER), "-b", "-P", str(ROOT / "backend/tools/blender/build_scene.py"), "--", "--bundle", f"data/bundles/{ctx['bundle']}",
                    "--far", f"data/bundles/{ctx['bundle']}_far", "--gazetteer", GAZETTEER, "--shot", ctx["cfg"]["bake_shot"],
                    "--bake-albedo", str(raw_dir.parent)], cwd=ROOT, check=True,
                   stdout=subprocess.DEVNULL)
    return time.time() - t


def far_recolour(far_dir, lowland=False):
    """numpy version of the poster palette (build_scene.make_terrain_material) on the far albedo, no procedural noise."""
    alb = np.asarray(Image.open(far_dir / "albedo.png").convert("RGB"), np.float32) / 255
    lc = np.load(far_dir / "landcover_hi.npy")
    h = np.load(far_dir / "height.npy").astype(np.float32)
    meta = json.loads((far_dir / "meta.json").read_text(encoding="utf-8"))
    gy, gx = np.gradient(h, meta["res"])
    slope = np.degrees(np.arctan(np.hypot(gx, gy))).astype(np.float32)
    H, W = alb.shape[:2]
    up = lambda a: np.asarray(Image.fromarray(a).resize((W, H), Image.BILINEAR))
    slope, h = up(slope), up(h)
    ss = lambda x: np.clip(x, 0, 1) ** 2 * (3 - 2 * np.clip(x, 0, 1))
    c = lambda k: (lc == k).astype(np.float32)
    lin = srgb2lin(alb)
    lum = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    base = np.clip(lum[..., None] + (lin - lum[..., None]) * 1.12, 0, 1)
    mix = lambda f, a, b: a * (1 - f[..., None] if hasattr(f, "shape") else 1 - f) + np.asarray(b, np.float32) * (f[..., None] if hasattr(f, "shape") else f)
    snow = np.maximum(c(70), ss((h - 4250) / 400) * np.clip((40 - slope) / 10, 0, 1))
    snow = snow * np.clip(1 - (slope - 39) / 7, 0, 1)
    rock = np.maximum(np.clip((slope - 36) / 10, 0, 1), 0.8 * np.maximum(c(60), c(100))) * (1 - snow)
    meadow = np.maximum(c(30), (0.95 if lowland else 0.6) * c(40)) * (1 - rock)
    forest = c(10) * (1 - rock)
    forest_col = mix(0.30, base, (0.05, 0.10, 0.03)) if lowland else mix(0.35, base, (0.028, 0.065, 0.022))
    tint = np.array([0.165, 0.17, 0.03], np.float32) * 0.65 + np.array([0.15, 0.15, 0.04], np.float32) * 0.35
    meadow_col = mix(0.25, mix(0.62, base, tint), (0, 0, 0))
    rb = mix(0.08, mix(0.12, mix(0.8, base, (0.34, 0.21, 0.08)), (0.40, 0.34, 0.27)), (0, 0, 0)) * np.array([1.09, 0.95, 0.72], np.float32)
    rock_col = mix(0.2, rb, (0.06, 0.04, 0.03))
    col = mix(forest, base, forest_col)
    col = mix(meadow, col, meadow_col)
    if lowland:
        built = c(50) * (1 - rock)
        col = mix(built, col, mix(0.6, base, (0.42, 0.33, 0.24)))
    col = mix(rock, col, rock_col)
    col = mix(snow, col, (0.92, 0.94, 0.98))
    out = (lin2srgb(col) * 255 + 0.5).astype(np.uint8)
    im = Image.fromarray(out)
    return im.resize((2048, round(2048 * H / W)), Image.LANCZOS)


def step_albedo(ctx, bake=True):
    near, out = ctx["near"], ctx["out"]
    ncx, ncy = -(-near.W // CC), -(-near.H // CC)
    raw = ROOT / "data" / "packs" / ctx["slug"] / "_bake" / "raw"
    secs = run_bake(raw, ncx, ncy, ctx) if bake else None
    done = raw.parent / "bake_done.json"
    ctx["bake_seconds"] = json.loads(done.read_text())["seconds"] if done.exists() else secs
    for lv in range(4):
        (out / "albedo" / f"L{lv}").mkdir(parents=True, exist_ok=True)
    tiles = {}
    for cy in range(ncy):
        for cx in range(ncx):
            col = np.load(raw / f"col_{cx}_{cy}.npy").astype(np.float32) / 255
            ao = np.load(raw / f"ao_{cx}_{cy}.npy")[..., 0]
            ao = np.asarray(Image.fromarray(ao).filter(ImageFilter.GaussianBlur(0.8)).resize((PXC, PXC), Image.BICUBIC), np.float32) / 255
            f = 0.5 + 0.5 * np.clip(ao, 0, 1)            # AO multiplied in at strength 0.5
            t = (np.clip(col * f[..., None], 0, 1) * 255 + 0.5).astype(np.uint8)
            tiles[cx, cy] = t
            im = Image.fromarray(t)
            for lv in range(4):
                s = PXC >> lv
                save_webp(np.asarray(im if lv == 0 else im.resize((s, s), Image.LANCZOS)), out / "albedo" / f"L{lv}" / f"{cx}_{cy}.webp")
    # seam check: last column of a tile vs first column of its east neighbour (and rows vs south neighbour)
    dx, dy, base = [], [], []
    for (cx, cy), t in tiles.items():
        base.append(np.abs(t[:, -1].astype(int) - t[:, -2]).mean())
        if (cx + 1, cy) in tiles:
            dx.append(np.abs(t[:, -1].astype(int) - tiles[cx + 1, cy][:, 0]))
        if (cx, cy + 1) in tiles:
            dy.append(np.abs(t[-1].astype(int) - tiles[cx, cy + 1][0]))
    d = np.concatenate([a.ravel() for a in dx + dy])
    ctx["seam"] = dict(mean=float(d.mean()), p99=float(np.percentile(d, 99)), max=int(d.max()),
                       neighbour_column_mean_within_tile=float(np.mean(base)), pairs=len(dx) + len(dy))
    log("seam", ctx["seam"])
    # overview: true-size mosaic at 3 px per 30 m cell, then 2048 wide
    mos = np.zeros((near.H * 3, near.W * 3, 3), np.uint8)
    for (cx, cy), t in tiles.items():
        c1, r1 = min(cx * CC + CC, near.W), min(cy * CC + CC, near.H)
        w, h = (c1 - cx * CC) * 3, (r1 - cy * CC) * 3
        tt = t if (w == PXC and h == PXC) else np.asarray(Image.fromarray(t).resize((w, h), Image.LANCZOS))
        mos[cy * CC * 3: cy * CC * 3 + h, cx * CC * 3: cx * CC * 3 + w] = tt
    ov = Image.fromarray(mos).resize((2048, round(2048 * near.H / near.W)), Image.LANCZOS)
    ov.save(out / "albedo" / "overview.webp", "WEBP", quality=85, method=4)
    del mos
    far_recolour(ctx["far"].dir, ctx["cfg"].get("lowland", False)).save(out / "albedo" / "far.webp", "WEBP", quality=82, method=4)
    log("albedo done")


# ---------------------------------------------------------------- trees
def step_trees(ctx):
    near, out = ctx["near"], ctx["out"]
    (out / "trees").mkdir(exist_ok=True)
    t = np.load(near.dir / "trees.npy")
    x = t[:, 0].astype(np.float64)                       # m east of the west edge
    z = near.H * near.res - t[:, 1].astype(np.float64)   # file y is m north of the south edge
    ok = (x >= 0) & (x < near.W * near.res) & (z >= 0) & (z < near.H * near.res)
    x, z, s = x[ok], z[ok], t[ok, 2]
    cx, cy = (x // (CC * near.res)).astype(int), (z // (CC * near.res)).astype(int)
    key = cy * 1000 + cx
    order = np.argsort(key, kind="stable")
    key, x, z, s = key[order], x[order], z[order], s[order]
    cuts = np.flatnonzero(np.diff(key)) + 1
    for a, b in zip(np.r_[0, cuts], np.r_[cuts, len(key)]):
        k = key[a]
        np.column_stack([x[a:b], z[a:b], s[a:b]]).astype("<f4").tofile(out / "trees" / f"{k % 1000}_{k // 1000}.bin")
    log("trees", len(x))


# ---------------------------------------------------------------- vectors
def label_items(ctx):
    """gazetteer (non-low) + OSM named peaks with ele; same item set the poster labels use (build_scene.py)."""
    near = ctx["near"]
    osm = ctx["osm"]
    gaz = ctx["gaz"]
    items = []
    tr = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True)
    for g in gaz:
        if g.get("coord_confidence") == "low": continue
        x, y = tr.transform(g["lon"], g["lat"])
        txt = " ".join([str(g.get("elevation_note") or ""), str(g.get("notes") or "")] +
                       [str(f.get("quote", "")) + " " + str(f.get("text", "")) for f in (g.get("facts") or [])])
        items.append(dict(g=g, slug=g["slug"], name=g["name"], kind=g.get("kind"), src="gazetteer", ele=g.get("elevation_m"), xy=(x, y), text=txt))
    for p in osm["peaks"]:
        if p.get("name") and p.get("ele"):
            x, y = tr.transform(p["pt"][0], p["pt"][1])
            items.append(dict(g=None, slug=None, name=p["name"], kind="peak", src="osm_peak", ele=p["ele"], xy=(x, y), text="", osm=p))
    return items


def label_elevation(it, items, near):
    """Poster rule (build_scene.py labels): peaks = DEM max within 500 m; sourced value nearest it within 250 m, else DEM."""
    x_, y_ = it["xy"]
    xs, zs = x_ - near.x0, near.y1 - y_
    if it["kind"] in ("peak", "mountain", "volcano", "saddle"):
        o = np.arange(-500, 501, 100.0)
        gx, gz = np.meshgrid(xs + o, zs + o)
        dem = float(near.sample(gx.ravel(), gz.ravel()).max())
        cands = []
        for o2 in items:
            if math.hypot(o2["xy"][0] - x_, o2["xy"][1] - y_) < 300:
                try: cands.append(float(str(o2["ele"]).replace("m", "").strip()))
                except ValueError: pass
                for mm in re.findall(r"(\d{1,2},\d{3}|\d{4})\s*m", o2.get("text", "")):
                    cands.append(float(mm.replace(",", "")))
        cands = [c for c in cands if abs(c - dem) <= 250]
        return (min(cands, key=lambda c: abs(c - dem)) if cands else round(dem, 1)), dem
    try: listed = float(str(it["ele"]).replace("m", "").strip()) if it["ele"] not in (None, "") else None
    except ValueError: listed = None
    return (listed if listed is not None else round(float(near.sample(xs, zs)), 1)), None


def step_vectors(ctx):
    from shapely.geometry import LineString, Point, Polygon
    near, out, osm = ctx["near"], ctx["out"], ctx["osm"]
    res = near.res
    R = lambda v: round(float(v), 1)
    Wm, Hm = near.W * res, near.H * res
    inside = lambda p: 0 <= p[0] <= Wm and 0 <= p[1] <= Hm

    def line(pts_px):   # osm pts: [lon, lat, px_x, px_y]
        return [[p[2] * res, p[3] * res] for p in pts_px]

    def simp(pts, tol=6.0):
        if len(pts) < 3: return [[R(a), R(b)] for a, b in pts]
        ls = LineString(pts).simplify(tol, preserve_topology=False)
        return [[R(a), R(b)] for a, b in ls.coords]

    # lakes
    lakes = []
    gaz_lakes = [g for g in ctx["gaz"] if g.get("kind") == "lake" and g.get("coord_confidence") != "low"]
    tr = ctx["tr"]
    gl_xy = {g["slug"]: np.array(tr.transform(g["lon"], g["lat"])) - [near.x0, 0] for g in gaz_lakes}
    lake_area = {}
    for lk in json.loads((near.dir / "lakes.json").read_text(encoding="utf-8")):
        ring = [[p[0] * res, p[1] * res] for p in lk["pts"]]
        if len(ring) < 4: continue
        a = np.array(ring)
        hb = near.sample(a[:, 0], a[:, 1])
        if np.percentile(hb, 90) - np.percentile(hb, 10) > 40: continue          # not a flat water body (poster rule)
        level = float(np.percentile(hb, 10)) + 0.8
        poly = Polygon(ring)
        if not poly.is_valid: poly = poly.buffer(0)
        slug, name = None, lk.get("name")
        best = 400.0
        for g in gaz_lakes:
            x, y = tr.transform(g["lon"], g["lat"]); pt = Point(x - near.x0, near.y1 - y)
            d = 0.0 if poly.contains(pt) else poly.distance(pt)
            if d < best: best, slug, name = d, g["slug"], g["name"]
        if slug: lake_area[slug] = max(lake_area.get(slug, 0), lk["area_km2"])
        sr = [[R(x), R(z)] for x, z in LineString(ring).simplify(4.0).coords]
        if sr[0] != sr[-1]: sr.append(sr[0])
        if len(sr) < 4: continue
        lakes.append({"name": name, "slug": slug, "level_m": round(level, 1), "rings": [sr]})
    ctx["lake_area"] = lake_area
    # rivers / streams
    rivers = []
    for w in osm["waterways"]:
        if len(w["pts"]) < 2: continue
        k = "river" if w["waterway"] == "river" else "stream"
        rivers.append({"name": w.get("name"), "kind": k, "width_m": 30 if k == "river" else 10, "pts": simp(line(w["pts"]), 5.0)})
    # roads
    cls = {w["way_id"]: w for w in json.loads((ROOT / "data/research/swat_road_classes.json").read_text(encoding="utf-8"))["ways"]}
    roads = []
    for r in osm["roads"]:
        if len(r["pts"]) < 2: continue
        c = cls.get(r["id"], {}).get("jeep_class")
        if c == "paved_or_regular": k = "paved"
        elif c == "trail": k = "path"
        elif c in ("jeep_only", "likely_jeep"): k = "track" if r["highway"] == "track" else "jeep"
        elif c == "unknown": k = "track"
        else: k = HWY_CLASS.get(str(r["highway"]).replace("_link", ""), "minor")
        roads.append({"name": r.get("name"), "class": k, "pts": simp(line(r["pts"]), 5.0)})
    # buildings
    buildings = []
    for b in json.loads((near.dir / "buildings.json").read_text(encoding="utf-8")):
        p = [(q[0] - near.x0, near.y1 - q[1]) for q in b["pts"]]
        if len(p) < 3: continue
        poly = Polygon(p)
        if not poly.is_valid: poly = poly.buffer(0)
        if poly.is_empty or poly.area < 4: continue
        rect = poly.minimum_rotated_rectangle
        c = np.array(rect.exterior.coords)[:4]
        e0, e1 = c[1] - c[0], c[2] - c[1]
        l0, l1 = np.hypot(*e0), np.hypot(*e1)
        if l0 < l1: e0, e1, l0, l1 = e1, e0, l1, l0
        ang = math.degrees(math.atan2(e0[1], e0[0])) % 180.0          # long axis, from +x (east) toward +z (south)
        cen = rect.centroid
        buildings.append({"x": R(cen.x), "z": R(cen.y), "w": R(l0), "d": R(l1), "angle_deg": R(ang), "roof": "gable" if poly.area < 250 else "flat"})
    # routes
    routes = []
    for rt in json.loads((ROOT / "data/research/swat_routes.json").read_text(encoding="utf-8")):
        pts = [(x - near.x0, near.y1 - y) for x, y in (tr.transform(lo, la) for lo, la in rt["geometry"])]
        pieces, cur = [], []
        for p in pts:
            if not inside(p) or (cur and math.hypot(p[0] - cur[-1][0], p[1] - cur[-1][1]) > 500):
                if len(cur) > 1: pieces.append(cur)
                cur = []
            if inside(p): cur.append(p)
        if len(cur) > 1: pieces.append(cur)
        if ctx["cfg"]["drop_empty_routes"] and not pieces: continue
        routes.append({"slug": rt["slug"], "name": rt["name"], "kind": rt["kind"], "confidence": rt["confidence"],
                       "length_km": rt["length_km"], "ascent_m": rt["ascent_m"], "pieces": [simp(p, 5.0) for p in pieces]})
    ctx["vectors"] = {"lakes": lakes, "rivers": rivers, "roads": roads, "buildings": buildings, "routes": routes}
    jdump(out / "vectors.json", ctx["vectors"])
    log("vectors", {k: len(v) for k, v in ctx["vectors"].items()}, (out / "vectors.json").stat().st_size)


# ---------------------------------------------------------------- models
def normalise_glb(src, dst, width_m):
    """TRELLIS GLB -> real-metre, ground-centred, +y up: drop vertex-connected fragments < 2% of faces, set footprint width."""
    import trimesh
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    sc = trimesh.load(str(src))
    m = list(sc.geometry.values())[0] if hasattr(sc, "geometry") else sc
    v, f = m.vertices, m.faces
    key = np.round(v / 1e-4).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True); inv = inv.ravel()
    ff = inv[f]; n = inv.max() + 1
    a = np.concatenate([ff[:, 0], ff[:, 1]]); b = np.concatenate([ff[:, 1], ff[:, 2]])
    nc, lab = connected_components(coo_matrix((np.ones(len(a)), (a, b)), shape=(n, n)), directed=False)
    fl = lab[ff[:, 0]]
    cnt = np.bincount(fl, minlength=nc)
    keep = cnt[fl] >= 0.02 * len(f)
    m.update_faces(keep); m.remove_unreferenced_vertices()
    lo, hi = m.bounds
    ground = lo[1]                                       # ground plane = base of the main body; nothing lies below it by construction
    scale = width_m / max(hi[0] - lo[0], hi[2] - lo[2])
    T = np.eye(4); T[:3, :3] *= scale
    T[:3, 3] = [-(lo[0] + hi[0]) / 2 * scale, -ground * scale, -(lo[2] + hi[2]) / 2 * scale]
    m.apply_transform(T)
    m.export(str(dst))
    return dict(dropped_faces=int((~keep).sum()), faces=len(m.faces), size_m=[round(float(x), 1) for x in m.bounds[1] - m.bounds[0]])


def step_models(ctx):
    out = ctx["out"]
    (out / "models").mkdir(exist_ok=True)
    readme = (ROOT / "data/models3d/README.md").read_text(encoding="utf-8").splitlines()
    ctx["models"] = {}
    areas = ctx["cfg"]["areas"]
    ok = None if areas is None else {g["slug"] for g in ctx["gaz"] if g.get("area") in areas}
    for f in sorted((ROOT / "data/models3d").glob("*.glb")):
        slug = f.stem
        if ok is not None and slug not in ok: continue
        dst = out / "models" / f.name
        if slug in TRELLIS:
            info = normalise_glb(f, dst, SCALE_GUESS[slug]); info["estimated_scale"] = True
        else:
            shutil.copy(f, dst); info = {"estimated_scale": False}
        att = ROOT / "data/models3d" / f"{slug}.attribution.txt"
        if att.exists():
            txt = att.read_text(encoding="utf-8")
        else:
            txt = "Procedural maquette generated for Tiny Atlas (backend/tools/blender/stupa.py).\n" + "\n".join(
                l for l in readme if l.startswith(f"- {slug}.glb"))
        (out / "models" / f"{slug}.attribution.txt").write_text(txt, encoding="utf-8")
        ctx["models"][slug] = info
        log("model", slug, info)


# ---------------------------------------------------------------- places
def built_anchor(lc, px_m, x, z, rad=1500.0, cell=300.0, min_px=40, min_off=250.0):
    """Centre of the densest cell x cell box of WorldCover class 50 (built-up) within rad of (x, z); None unless it has
    >= min_px built pixels and lies > min_off from the node."""
    from scipy.ndimage import uniform_filter
    n = int(round(cell / px_m))
    c0, r0 = int((x - rad) / px_m), int((z - rad) / px_m)
    c1, r1 = int((x + rad) / px_m) + 1, int((z + rad) / px_m) + 1
    c0, r0, c1, r1 = max(c0, 0), max(r0, 0), min(c1, lc.shape[1]), min(r1, lc.shape[0])
    if c1 - c0 < n or r1 - r0 < n: return None
    b = (lc[r0:r1, c0:c1] == 50).astype(np.float32)
    cnt = uniform_filter(b, size=n, mode="constant") * n * n
    rr, cc = np.mgrid[r0:r1, c0:c1]
    ax, az = (cc + 0.5) * px_m, (rr + 0.5) * px_m
    cnt[np.hypot(ax - x, az - z) > rad] = -1
    i = np.unravel_index(int(cnt.argmax()), cnt.shape)
    if cnt[i] < min_px - 0.5: return None
    X, Z = float(ax[i]), float(az[i])
    return [round(X, 1), round(Z, 1)] if math.hypot(X - x, Z - z) > min_off else None


def step_places(ctx):
    near, far, out = ctx["near"], ctx["far"], ctx["out"]
    items = label_items(ctx)
    gaz_xy = [it["xy"] for it in items if it["src"] == "gazetteer"]
    Wm, Hm = near.W * near.res, near.H * near.res
    fx0, fz0 = far.x0 - near.x0, near.y1 - far.y1
    fW, fH = far.W * far.res, far.H * far.res
    places, dropped = [], []
    lake_area = ctx.get("lake_area", {})
    lc = np.load(near.dir / "landcover_hi.npy")
    lc_px = near.W * near.res / lc.shape[1]
    for it in items:
        if it["src"] == "osm_peak":
            if float(it["ele"]) < 4500 or any(math.hypot(it["xy"][0] - x, it["xy"][1] - y) < 300 for x, y in gaz_xy): continue
        if ctx["cfg"]["areas"] is not None and (it["g"] or {}).get("area") not in ctx["cfg"]["areas"]: continue
        x, z = it["xy"][0] - near.x0, near.y1 - it["xy"][1]
        in_near = 0 <= x <= Wm and 0 <= z <= Hm
        in_far = fx0 <= x <= fx0 + fW and fz0 <= z <= fz0 + fH
        if not (in_near or in_far):
            dropped.append(it["slug"] or it["name"]); continue
        lab, dem_max = label_elevation(it, items, near)
        if it["kind"] == "peak" and dem_max is not None:       # snap to the DEM summit within 500 m (poster rule)
            o = np.arange(-500, 501, 30.0)
            gx, gz = np.meshgrid(x + o, z + o)
            hh = near.sample(gx.ravel(), gz.ravel()); i = int(hh.argmax())
            x, z = float(gx.ravel()[i]), float(gz.ravel()[i])
        ground = float(near.sample(x, z)) if in_near else float(far.sample(x - fx0, z - fz0))
        g = it["g"] or {}
        kind = it["kind"]
        if kind in ("town", "village"): tier = 1
        elif kind == "lake": tier = 1 if (lake_area.get(it["slug"], 0) >= 0.15 or any(m in it["name"].lower() or m.replace(" ", "-") in str(it["slug"]) for m in MAJOR_LAKES)) else 3
        elif kind == "peak" and lab >= ctx["cfg"]["peak_tier2_min"]: tier = 2
        elif kind in HERITAGE: tier = 2
        else: tier = 4
        slug = it["slug"] or re.sub(r"[^a-z0-9]+", "-", it["name"].lower()).strip("-")
        photos = []
        pdir = ROOT / "data/photos" / slug
        if (pdir / "manifest.json").exists():
            man = json.loads((pdir / "manifest.json").read_text(encoding="utf-8"))
            (out / "photos" / slug).mkdir(parents=True, exist_ok=True)
            for p in man["photos"]:
                if len(photos) >= 6: break
                src = pdir / p["file"]
                if not src.exists(): continue
                im = Image.open(src).convert("RGB")
                im.thumbnail((1600, 1600), Image.LANCZOS)
                fn = f"{len(photos) + 1:02d}.jpg"
                im.save(out / "photos" / slug / fn, "JPEG", quality=85, optimize=True)
                photos.append({"file": f"photos/{slug}/{fn}", "attribution": p.get("attribution"), "url": p.get("page")})
        model = f"models/{slug}.glb" if (out / "models" / f"{slug}.glb").exists() else None
        pl = {"slug": slug, "name": it["name"], "short_name": short_name(it["name"]), "name_ur": g.get("name_ur"), "kind": kind, "area": g.get("area", ""),
              "x": round(x, 1), "z": round(z, 1), "ground_m": round(ground, 1), "label_elevation_m": lab, "tier": tier,
              "summary": g.get("summary", ""), "timeline": g.get("timeline") or [], "facts": g.get("facts") or [],
              "access": g.get("access", ""), "hidden_gem": bool(g.get("hidden_gem", False)), "photos": photos, "model": model,
              "confidence": g.get("coord_confidence", "medium") if g else "medium"}
        if kind in ("town", "village"):
            an = built_anchor(lc, lc_px, x, z)
            if an:
                pl["anchor"], pl["anchor_source"] = an, "worldcover-built"
                print("ANCHOR", slug, an, round(math.hypot(an[0] - x, an[1] - z)), "m")
        if model and slug in TRELLIS:
            pl["estimated_scale"] = True
        places.append(pl)
    places.sort(key=lambda p: (p["tier"], p["name"]))
    jdump(out / "places.json", places)
    ctx["places"], ctx["dropped"] = places, dropped
    log("places", len(places), "dropped (outside near+far):", len(dropped), dropped)


# ---------------------------------------------------------------- sky
def step_sky(ctx):
    import cv2
    hdr = cv2.imread(str(ROOT / "data/assets/belfast_sunset_puresky_4k.hdr"), cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)[..., ::-1]
    hdr = cv2.resize(hdr, (2048, 1024), interpolation=cv2.INTER_AREA).astype(np.float32)
    lum = hdr @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    x = hdr * (0.28 / math.exp(np.log(lum + 1e-4).mean()))
    x = x * (1 + x / 16.0) / (1 + x)                     # extended Reinhard keeps the warm sun glow
    Image.fromarray((lin2srgb(x) * 255 + 0.5).astype(np.uint8)).save(ctx["out"] / "sky.jpg", quality=90)
    log("sky")


# ---------------------------------------------------------------- check
def step_check(ctx):
    out = ctx["out"]
    meta = json.loads((out / "meta.json").read_text(encoding="utf-8"))
    vec = json.loads((out / "vectors.json").read_text(encoding="utf-8"))
    places = json.loads((out / "places.json").read_text(encoding="utf-8"))
    im = Image.open(out / "albedo" / "overview.webp").convert("RGB")
    k = im.width / meta["size_m"][0]
    d = ImageDraw.Draw(im)
    P = lambda pts: [(x * k, z * k) for x, z in pts]
    for lk in vec["lakes"]:
        d.polygon(P(lk["rings"][0]), outline=(0, 255, 255), fill=(0, 200, 255))
    for r in vec["rivers"]:
        d.line(P(r["pts"]), fill=(60, 120, 255), width=1)
    col = {"paved": (255, 255, 255), "jeep": (255, 200, 0), "minor": (200, 200, 120), "track": (255, 140, 0), "path": (255, 0, 255)}
    for r in vec["roads"]:
        d.line(P(r["pts"]), fill=col[r["class"]], width=1)
    for b in vec["buildings"]:
        d.point((b["x"] * k, b["z"] * k), fill=(255, 0, 0))
    for r in vec["routes"]:
        for pc in r["pieces"]:
            d.line(P(pc), fill=(255, 0, 0), width=2)
    for p in places:
        x, z = p["x"] * k, p["z"] * k
        d.ellipse((x - 3, z - 3, x + 3, z + 3), fill=(255, 255, 0), outline=(0, 0, 0))
        if p["tier"] <= 2: d.text((x + 5, z - 5), p["name"], fill=(255, 255, 255))
    im.save(out / "_check.png")
    log("check written")


def list_files(out):
    """[{path, bytes}] for every file the renderer may fetch (not the _check.png debug image, _bake, or files.json itself)."""
    skip = {"_check.png", "files.json"}
    return [{"path": p.relative_to(out).as_posix(), "bytes": p.stat().st_size} for p in sorted(out.rglob("*"))
            if p.is_file() and p.name not in skip and "_bake" not in p.relative_to(out).parts]


def step_files(ctx):
    files = list_files(ctx["out"])
    jdump(ctx["out"] / "files.json", files)
    log(f"files.json: {len(files)} files, {sum(f['bytes'] for f in files) / 1e6:.1f} MB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("bundle")
    ap.add_argument("--no-bake", action="store_true", help="do not (re)run Blender; use tiles in data/packs/<slug>/_bake/raw")
    ap.add_argument("--only", default="")
    A = ap.parse_args()
    bundle = A.bundle
    slug = bundle.replace("_", "-")
    out = ROOT / "data" / "packs" / slug / "atlas"
    out.mkdir(parents=True, exist_ok=True)
    (out / "photos").mkdir(exist_ok=True)
    ctx = dict(slug=slug, bundle=bundle, cfg=PACKS[bundle], out=out, near=Grid(bundle), far=Grid(bundle + "_far"), tr=Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True),
               osm=json.loads((ROOT / f"data/bundles/{bundle}/osm.json").read_text(encoding="utf-8")),
               gaz=json.loads((ROOT / GAZETTEER).read_text(encoding="utf-8")))
    steps = A.only.split(",") if A.only else ["terrain", "albedo", "trees", "vectors", "models", "places", "sky", "check", "files"]
    for s in steps:
        if s == "albedo": step_albedo(ctx, bake=not A.no_bake)
        elif s == "terrain": step_terrain(ctx)
        elif s == "trees": step_trees(ctx)
        elif s == "vectors": step_vectors(ctx)
        elif s == "models": step_models(ctx)
        elif s == "places":
            if "lake_area" not in ctx: step_vectors(ctx)
            if "models" not in ctx: ctx["models"] = {}
            step_places(ctx)
        elif s == "sky": step_sky(ctx)
        elif s == "check": step_check(ctx)
        elif s == "files": step_files(ctx)
    if "seam" in ctx:
        print("SEAM", json.dumps(ctx["seam"]), "BAKE_SECONDS", ctx.get("bake_seconds"))


if __name__ == "__main__":
    main()
