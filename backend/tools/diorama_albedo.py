"""Bake real ground colour for the dioramas from the Atlas packs' Sentinel-2 cloudless albedo.

    python backend/tools/diorama_albedo.py [site ...] [--all] [--check]

Source: the Atlas packs' baked albedo (data/packs/<pack>/atlas/albedo/L0/{cx}_{cy}.webp, 10 m/px, 384 px per 128-cell
chunk; far.webp for what the near grids do not cover): Sentinel-2 cloudless 2016 by EOX IT Services GmbH, CC BY 4.0,
contains modified Copernicus Sentinel data 2016. Pack frame: UTM (meta.crs), x = E - origin_utm[0], z = origin_utm[1] - N.

Writes, next to each site's meta.json (the site itself is not rebuilt):
  albedo.webp      the near grid at 5 m/px: (2*cols-1) x (2*rows-1) px, pixel (i, j) centred on local
                   x = -W/2 + 5 i, z = -H/2 + 5 j, so every other pixel sits on a grid vertex
  albedo_far.webp  the far ring at 30 m/px, (2*cols-1) x (2*rows-1) px, pixel (i, j) centred on far x0 + 30 i, z0 + 30 j
The relief shading Sentinel-2 caught (its morning sun from the south-east) is partly divided out with the site's own DEM,
so the page's sun does not light slopes the photo already shaded.
--check measures the alignment: how far the lake cells of cover.bin and the OSM track line must move to sit best on the
dark water and the pale track in the image (metres; 0 = aligned).
"""
import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[2]
SITES = ROOT / "web" / "data" / "diorama"
PACKS = ROOT / "data" / "packs"
CC, PXC, RES = 128, 384, 30.0          # chunk cells, L0 tile px, pack cell metres (docs/atlas-pack-v1.md "Chunks")
NEAR_PX, FAR_PX = 5.0, 30.0
# Registration: across the sites where the check has a clear signal (lakes, paved roads with contrast > 0.02) the
# image sat a median 5 m south of cover.bin's lakes and the OSM roads (half a 10 m source pixel), so it is read 5 m south.
SHIFT_Z = 5.0
SOURCE = {"name": "Sentinel-2 cloudless 2016 by EOX IT Services GmbH", "use": "ground colour",
          "licence": "CC BY 4.0, contains modified Copernicus Sentinel data 2016", "url": "https://s2maps.eu"}


def frame(bbox):
    s, w, n, e = bbox
    lat0 = math.radians((s + n) / 2)
    return dict(s=s, w=w, n=n, e=e, my=111132.95 - 559.82 * math.cos(2 * lat0),
                mx=111412.84 * math.cos(lat0) - 93.5 * math.cos(3 * lat0))


def bilinear(img, fx, fy):
    """img HxWxC float; fx, fy pixel coordinates (centre of pixel 0 = 0). Returns samples and an inside mask."""
    H, W = img.shape[:2]
    inside = (fx >= -0.5) & (fx <= W - 0.5) & (fy >= -0.5) & (fy <= H - 0.5)
    fx, fy = np.clip(fx, 0, W - 1.0001), np.clip(fy, 0, H - 1.0001)
    x0, y0 = fx.astype(int), fy.astype(int)
    tx, ty = (fx - x0)[..., None], (fy - y0)[..., None]
    a, b, c, d = img[y0, x0], img[y0, x0 + 1], img[y0 + 1, x0], img[y0 + 1, x0 + 1]
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty, inside


class Pack:
    def __init__(self, slug):
        self.slug, d = slug, PACKS / slug / "atlas"
        self.meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
        self.dir = d / "albedo"
        self.cols, self.rows = self.meta["cols"], self.meta["rows"]
        self.utm = Transformer.from_crs("EPSG:4326", self.meta["crs"], always_xy=True)
        self.ox, self.oy = self.meta["origin_utm"]
        self._far = None

    def xz(self, lat, lon):
        E, N = self.utm.transform(lon, lat)
        return np.asarray(E) - self.ox, self.oy - np.asarray(N)

    def covers(self, x, z):
        return (x >= 0) & (z >= 0) & (x <= self.cols * RES) & (z <= self.rows * RES)

    def mosaic(self, x, z, step):
        """Bilinear L0 samples at pack (x, z), box-filtered to `step` metres per px first (10 = native)."""
        k = max(1, int(round(step / 10)))
        m = self.covers(x, z)
        out = np.zeros(x.shape + (3,), np.float32)
        if not m.any():
            return out, m
        c0 = max(int(np.floor(x[m].min() / (CC * RES))), 0); c1 = min(int(np.floor(x[m].max() / (CC * RES))), -(-self.cols // CC) - 1)
        r0 = max(int(np.floor(z[m].min() / (CC * RES))), 0); r1 = min(int(np.floor(z[m].max() / (CC * RES))), -(-self.rows // CC) - 1)
        px = CC * 3                                    # 10 m px per full chunk
        mos = np.zeros(((r1 - r0 + 1) * px, (c1 - c0 + 1) * px, 3), np.float32)
        for cy in range(r0, r1 + 1):
            for cx in range(c0, c1 + 1):
                f = self.dir / "L0" / f"{cx}_{cy}.webp"
                if not f.exists():
                    continue
                im = Image.open(f).convert("RGB")
                w = (min(cx * CC + CC, self.cols) - cx * CC) * 3
                h = (min(cy * CC + CC, self.rows) - cy * CC) * 3
                if (w, h) != im.size:                  # edge chunk: the partial area was stretched to the full tile
                    im = im.resize((w, h), Image.LANCZOS)
                mos[(cy - r0) * px:(cy - r0) * px + h, (cx - c0) * px:(cx - c0) * px + w] = np.asarray(im, np.float32)
        mos = srgb2lin(mos / 255)
        if k > 1:
            H, W = mos.shape[0] // k * k, mos.shape[1] // k * k
            mos = mos[:H, :W].reshape(H // k, k, W // k, k, 3).mean(axis=(1, 3))
        cell = 10.0 * k
        s, ins = bilinear(mos, (x - c0 * CC * RES) / cell - 0.5, (z - r0 * CC * RES) / cell - 0.5)
        return np.where(m[..., None], s, 0), m & ins

    def far(self, x, z):
        if self._far is None:
            self._far = srgb2lin(np.asarray(Image.open(self.dir / "far.webp").convert("RGB"), np.float32) / 255)
        f = self.meta["far"]
        H, W = self._far.shape[:2]
        sx, sz = f["size_m"][0] / W, f["size_m"][1] / H
        return bilinear(self._far, (x - f["origin_m"][0]) / sx - 0.5, (z - f["origin_m"][1]) / sz - 0.5)


def srgb2lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin2srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def lum(c):
    return c @ np.array([0.2126, 0.7152, 0.0722], np.float32)


def site_points(m, which):
    """lat/lon of every albedo pixel centre of the near grid or the far ring (and the grid shape in px)."""
    g = m["grid"]
    fr = frame(g["bbox"])
    if which == "near":
        nx, ny, step = 2 * g["cols"] - 1, 2 * g["rows"] - 1, NEAR_PX
        lon = fr["w"] + np.arange(nx) * step / fr["mx"]
        lat = fr["n"] - (np.arange(ny) * step + SHIFT_Z) / fr["my"]
    else:
        f = m["far"]
        # the far ring was sampled in its own box's frame (diorama_build geo(site, "far_bbox")) and placed at its NW corner
        fw = fr["w"] + (f["x0"] + g["width"] / 2) / fr["mx"]
        fn = fr["n"] - (f["z0"] + g["height"] / 2) / fr["my"]
        ff = frame((fn - (f["rows"] - 1) * f["cell"] / fr["my"], fw, fn, fw + 1))
        nx, ny, step = 2 * f["cols"] - 1, 2 * f["rows"] - 1, FAR_PX
        lon = fw + np.arange(nx) * step / ff["mx"]
        lat = fn - (np.arange(ny) * step + SHIFT_Z) / ff["my"]
    LON, LAT = np.meshgrid(lon, lat)
    return LAT, LON


def pick(packs, m):
    """The pack whose near grid covers the site's near box (meta.pack is only a hint)."""
    s, w, n, e = m["grid"]["bbox"]
    lat, lon = np.array([s, s, n, n, (s + n) / 2]), np.array([w, e, w, e, (w + e) / 2])
    order = sorted(packs.values(), key=lambda p: (-p.covers(*p.xz(lat, lon)).sum(), p.slug != m.get("pack")))
    return order


def sample(order, LAT, LON, step):
    out = np.zeros(LAT.shape + (3,), np.float32)
    done = np.zeros(LAT.shape, bool)
    for p in order:
        x, z = p.xz(LAT, LON)
        s, ok = p.mosaic(x, z, step)
        ok &= ~done
        out[ok] = s[ok]; done |= ok
    if not done.all():                               # beyond every near grid: the packs' coarse far backdrop
        p = order[0]
        x, z = p.xz(LAT, LON)
        s, ok = p.far(x, z)
        if done.any():                               # far.webp is graded differently: match it to L0 where both exist
            both = done & ok
            if both.sum() > 500:
                for ch in range(3):
                    a, b = np.polyfit(s[both][:, ch], out[both][:, ch], 1)
                    s[..., ch] = np.clip(s[..., ch] * a + b, 0, 1)
        out[~done] = s[~done]
    return out, done


def deshade(col, heights, step, cell):
    """Divide out part of the relief shading the satellite saw (sun ~SE, ~55 deg up at the 10:30 overpass in summer)."""
    from PIL import ImageFilter
    h = heights
    gz, gx = np.gradient(h, cell)                     # gz: toward south, gx: toward east
    n = np.dstack([-gx, np.ones_like(h), -gz]); n /= np.linalg.norm(n, axis=2, keepdims=True)
    az, el = math.radians(145), math.radians(55)       # sun direction: azimuth from north, clockwise
    sd = np.array([math.sin(az) * math.cos(el), math.sin(el), -math.cos(az) * math.cos(el)])
    shade = np.clip(n @ sd, 0.05, 1) / sd[1]           # 1 on flat ground
    shade = np.asarray(Image.fromarray(shade.astype(np.float32)).resize((col.shape[1], col.shape[0]), Image.BILINEAR))
    L = lum(col) + 1e-3
    ok = L < 0.5                                       # not snow (saturated) or cloud
    # how strongly the image follows the DEM shading, fitted on log luminance, then removed at that strength (<= 0.3: aspect also changes what grows)
    ls, ll = np.log(shade[ok]), np.log(L[ok])
    k = float(np.clip(np.cov(ls, ll)[0, 1] / max(np.var(ls), 1e-6), 0, 0.3)) if ok.sum() > 1000 else 0.0
    f = np.clip(shade ** -k, 0.6, 1.8)[..., None]
    return np.clip(col * f, 0, 1), k


def load_site(d):
    m = json.loads((d / "meta.json").read_text(encoding="utf-8"))
    g, f = m["grid"], m["far"]
    H = g["hmin"] + np.frombuffer((d / "height.bin").read_bytes(), "<u2").astype(np.float32).reshape(g["rows"], g["cols"]) / 10
    FH = f["hmin"] + np.frombuffer((d / "far.bin").read_bytes(), "<u2").astype(np.float32).reshape(f["rows"], f["cols"]) * f["scale"]
    C = np.frombuffer((d / "cover.bin").read_bytes(), np.uint8).reshape(g["rows"], g["cols"])
    return m, H, FH, C


def bake(site, packs):
    d = SITES / site
    m, H, FH, C = load_site(d)
    order = pick(packs, m)
    LAT, LON = site_points(m, "near")
    near, ok = sample(order, LAT, LON, 10)
    near, kn = deshade(near, H, NEAR_PX, m["grid"]["cell"])
    LAT, LON = site_points(m, "far")
    far, okf = sample(order, LAT, LON, FAR_PX)
    far, kf = deshade(far, FH, FAR_PX, m["far"]["cell"])
    Image.fromarray((lin2srgb(near) * 255 + 0.5).astype(np.uint8)).save(d / "albedo.webp", "WEBP", quality=85, method=6)
    Image.fromarray((lin2srgb(far) * 255 + 0.5).astype(np.uint8)).save(d / "albedo_far.webp", "WEBP", quality=80, method=6)
    kb = ((d / "albedo.webp").stat().st_size + (d / "albedo_far.webp").stat().st_size) / 1024
    print(f"{site:26s} pack {order[0].slug:10s} near {near.shape[1]}x{near.shape[0]} L0 {ok.mean():.0%}  far {far.shape[1]}x{far.shape[0]}"
          f" L0 {okf.mean():.0%}  deshade {kn:.2f}/{kf:.2f}  {kb:.0f} KB", flush=True)
    return kb


def check(site):
    """Offset (metres, local x/z) that best fits (a) the lake cells to dark water, (b) the OSM track to a pale line."""
    d = SITES / site
    m, H, FH, C = load_site(d)
    g = m["grid"]
    img = lum(srgb2lin(np.asarray(Image.open(d / "albedo.webp").convert("RGB"), np.float32) / 255))[..., None]
    at = lambda x, z: bilinear(img, (x + g["width"] / 2) / NEAR_PX, (z + g["height"] / 2) / NEAR_PX)[0][..., 0]
    shifts = np.arange(-30, 30.1, 2.5)
    res = {}
    if (C == 5).sum() > 30:
        from scipy.ndimage import binary_dilation
        lake = C == 5
        ring = binary_dilation(lake, iterations=5) & ~binary_dilation(lake, iterations=2)
        rr, cc = np.nonzero(lake); r2, c2 = np.nonzero(ring)
        lx, lz = cc * g["cell"] - g["width"] / 2, rr * g["cell"] - g["height"] / 2
        rx, rz = c2 * g["cell"] - g["width"] / 2, r2 * g["cell"] - g["height"] / 2
        best = max(((at(rx + dx, rz + dz).mean() - at(lx + dx, lz + dz).mean(), dx, dz) for dx in shifts for dz in shifts))
        res["lake"] = dict(contrast0=float(at(rx, rz).mean() - at(lx, lz).mean()), lake_lum=float(at(lx, lz).mean()),
                           ring_lum=float(at(rx, rz).mean()), dx=float(best[1]), dz=float(best[2]))
    pts = np.array(m.get("track") or [p[:2] for p in m["drive"]], np.float32)
    if len(pts) > 20:
        t = np.gradient(pts, axis=0); t /= np.linalg.norm(t, axis=1, keepdims=True) + 1e-6
        nrm = np.stack([-t[:, 1], t[:, 0]], 1)
        inside = (np.abs(pts[:, 0]) < g["width"] / 2 - 60) & (np.abs(pts[:, 1]) < g["height"] / 2 - 60)
        pts, nrm = pts[inside], nrm[inside]

        def score(dx, dz):
            x, z = pts[:, 0] + dx, pts[:, 1] + dz
            on = at(x, z)
            off = 0.5 * (at(x + nrm[:, 0] * 18, z + nrm[:, 1] * 18) + at(x - nrm[:, 0] * 18, z - nrm[:, 1] * 18))
            return float((on - off).mean())
        best = max((score(dx, dz), dx, dz) for dx in shifts for dz in shifts)
        res["road"] = dict(contrast0=score(0, 0), dx=float(best[1]), dz=float(best[2]), n=int(len(pts)))
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sites", nargs="*")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--check", action="store_true", help="measure alignment only")
    a = ap.parse_args()
    sites = sorted(p.name for p in SITES.iterdir() if (p / "meta.json").exists()) if a.all or not a.sites else a.sites
    if a.check:
        strong = []
        for s in sites:
            r = check(s)
            print(s, json.dumps(r), flush=True)
            strong += [(v["dx"], v["dz"]) for k, v in r.items() if k == "lake" or v["contrast0"] > 0.02]
        if strong:
            dx, dz = np.median(np.array(strong), axis=0)
            off = np.hypot(*np.array(strong).T)
            print(f"{len(strong)} clear signals: median offset dx {dx:+.1f} m, dz {dz:+.1f} m; |offset| median {np.median(off):.1f} m, "
                  f"<= 10 m (1 cell) in {np.mean(off <= 10):.0%}")
        return
    packs = {p.name: Pack(p.name) for p in PACKS.iterdir() if (p / "atlas" / "meta.json").exists()}
    tot = sum(bake(s, packs) for s in sites)
    print(f"{len(sites)} sites, {tot / 1024:.1f} MB")


if __name__ == "__main__":
    sys.exit(main())
