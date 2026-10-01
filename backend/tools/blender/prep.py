"""Prep a geo bundle for Blender.  python backend/tools/blender/prep.py data/bundles/swat [--no-trees]

Writes height.npy (float32 m), landcover_hi.npy (uint8), albedo.png (satellite de-lit with the DEM hillshade at the
acquisition sun, az 145 / el 55), and trees.npy (N x 3 float32: x_m east of bundle west edge, y_m north of bundle
south edge, scale 0.7-1.3) -- ~1 tree per 400 m^2 inside ESA class-10 pixels (deterministic seed).
"""
import argparse, json
from pathlib import Path
import numpy as np
from PIL import Image
import rasterio

Image.MAX_IMAGE_PIXELS = None


def hillshade(h, res, az, el):
    gy, gx = np.gradient(h, res)           # gy: d/d(row) (south positive)
    nx, ny, nz = -gx, gy, np.ones_like(h)  # normal, x east, y north
    a, e = np.radians(az), np.radians(el)
    s = np.array([np.sin(a) * np.cos(e), np.cos(a) * np.cos(e), np.sin(e)])
    return np.clip((nx * s[0] + ny * s[1] + nz * s[2]) / np.sqrt(nx**2 + ny**2 + 1), 0, 1)


def make_lakes(b, meta, lc):
    """lakes.json: OSM water rings unioned with the connected WorldCover water (class 80) components, smoothed.
    Polygons are in near-bundle 30 m pixel coords (same convention as osm.json px)."""
    from scipy import ndimage as ndi
    from skimage import measure
    from PIL import ImageDraw
    osm = json.loads((b / "osm.json").read_text(encoding="utf-8"))
    H, W = lc.shape
    k = W / meta["width"]  # landcover_hi px per bundle px
    m = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(m)
    rings = [w for w in osm["water"] if len(w["pts"]) >= 4]
    for w in rings:
        d.polygon([(q[2] * k, q[3] * k) for q in w["pts"]], fill=1)
    osm_mask = np.asarray(m, bool)
    union = osm_mask | (lc == 80)
    union = ndi.binary_closing(union, iterations=2)
    lab, n = ndi.label(union)
    keep = np.unique(lab[osm_mask]); keep = keep[keep > 0]
    out = []
    px_area = (meta["res"] / k) ** 2
    for i in keep:
        comp = lab == i
        area = comp.sum() * px_area
        if area < 3000: continue
        sm = ndi.gaussian_filter(comp.astype(np.float32), 1.2)
        for c in measure.find_contours(np.pad(sm, 1), 0.5):
            if len(c) < 8: continue
            c = c - 1
            poly = [[float((x + 0.5) / k), float((y + 0.5) / k)] for y, x in c[::3]]
            x_, y_ = np.array(poly).T * meta["res"]
            a_ = abs(0.5 * np.sum(x_ * np.roll(y_, -1) - np.roll(x_, -1) * y_))
            if a_ < 3000: continue   # holes / specks
            cx, cy = np.mean(poly, 0)
            nm = None
            for w in rings:
                if w.get("name") and np.hypot(np.mean([q[2] for q in w["pts"]]) - cx, np.mean([q[3] for q in w["pts"]]) - cy) < 40: nm = w["name"]; break
            out.append({"name": nm, "area_km2": round(a_ / 1e6, 4), "pts": poly})
    (b / "lakes.json").write_text(json.dumps(out), encoding="utf-8")
    for l in out:
        if l["name"] and "Mahun" in l["name"] or l["name"] and "Mahod" in l["name"]: print("lake", l["name"], l["area_km2"], "km2")
    print("lakes", len(out))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("bundle")
    ap.add_argument("--no-trees", action="store_true")
    ap.add_argument("--density", type=float, default=1 / 400.0, help="trees per m^2 in tree pixels")
    a = ap.parse_args()
    b = Path(a.bundle)
    meta = json.loads((b / "meta.json").read_text())
    with rasterio.open(b / "height.tif") as s:
        h = s.read(1).astype(np.float32)
    np.save(b / "height.npy", h)
    lc = np.asarray(Image.open(b / "landcover_hi.png"))
    np.save(b / "landcover_hi.npy", lc)
    res = meta["res"]

    sat = Image.open(b / "satellite.jpg").convert("RGB")
    sw, sh_ = sat.size
    hs = hillshade(h, res, 145, 55)
    hs_r = np.asarray(Image.fromarray(hs).resize((sw, sh_), Image.BILINEAR), dtype=np.float32)
    f = (0.35 + 0.65 * hs_r)[..., None]
    flat = 0.35 + 0.65 * np.sin(np.radians(55))
    rgb = np.asarray(sat, dtype=np.float32) / 255.0
    rgb = np.clip(rgb / f * flat, 0, 1)
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    rgb = np.clip(lum[..., None] + (rgb - lum[..., None]) * 1.15, 0, 1)
    Image.fromarray((rgb * 255 + 0.5).astype(np.uint8)).save(b / "albedo.png")
    print("albedo", (sw, sh_))

    if (b / "osm.json").exists():
        make_lakes(b, meta, lc)

    if not a.no_trees:
        rng = np.random.default_rng(12345)
        H, W = lc.shape
        px = res / 2.0
        gy, gx = np.gradient(h, res)
        slope = np.degrees(np.arctan(np.hypot(gx, gy)))
        slope_hi = np.asarray(Image.fromarray(slope.astype(np.float32)).resize((W, H), Image.BILINEAR))
        ys, xs = np.nonzero((lc == 10) & (slope_hi < 55))
        lam = a.density * px * px
        n = rng.poisson(lam, len(xs))
        idx = np.repeat(np.arange(len(xs)), n)
        x = (xs[idx] + rng.random(len(idx))) * px
        y = (H - (ys[idx] + rng.random(len(idx)))) * px
        sc = rng.uniform(0.7, 1.3, len(idx))
        t = np.stack([x, y, sc], 1).astype(np.float32)
        np.save(b / "trees.npy", t)
        print("trees", len(t))


main()
