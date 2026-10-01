"""Synthetic Atlas pack in the exact docs/atlas-pack-v1.md format, for developing the renderer without real data.

    python backend/tools/atlas_mock.py [slug]      -> data/packs/<slug>/atlas/   (default slug: mock)
"""
import json, math, struct, sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
slug = sys.argv[1] if len(sys.argv) > 1 else "mock"
OUT = ROOT / "data" / "packs" / slug / "atlas"
rng = np.random.default_rng(7)

RES, N, CH = 30.0, 512, 128
W = (N - 1) * RES
HILLS = [(rng.uniform(-3000, W + 3000), rng.uniform(-3000, W + 3000), rng.uniform(900, 2600), rng.uniform(1200, 2600)) for _ in range(26)]
HILLS += [(W * 0.5, -1500, 2400, 3200), (W * 0.2, W * 0.15, 2200, 1800), (W * 0.85, W * 0.3, 2000, 1900)]
LAKE = (W * 0.62, W * 0.58, 520.0)
LAKE_LEVEL = 2310.0


def river_x(z):
    return W * 0.45 + 1700 * np.sin(z / 2600.0)


def raw(x, z):
    h = np.full(np.broadcast(x, z).shape, 1700.0)
    for hx, hz, a, s in HILLS:
        h += a * np.exp(-(((x - hx) ** 2 + (z - hz) ** 2) / (2 * s * s)))
    h += 60 * np.sin(x / 190.0) * np.cos(z / 230.0) + 35 * np.sin(x / 71.0 + z / 53.0)
    d = np.abs(x - river_x(z))
    h -= 520 * np.exp(-(d / 650.0) ** 2)            # river valley
    ld = np.hypot(x - LAKE[0], z - LAKE[1])
    h = np.where(ld < LAKE[2] * 1.7, LAKE_LEVEL + np.clip(ld - LAKE[2], 0, None) * 0.35 + (ld > LAKE[2]) * 8, h)
    return h


def slope(x, z):
    e = 15.0
    gx = (raw(x + e, z) - raw(x - e, z)) / (2 * e)
    gz = (raw(x, z + e) - raw(x, z - e)) / (2 * e)
    return np.hypot(gx, gz)


def colour(x, z, h):
    s = slope(x, z)
    n = (np.sin(x / 9.0) * np.cos(z / 7.0) + np.sin(x / 3.1 + z / 4.7)) * 0.04
    rock = np.stack([0.72 + n, 0.47 + n, 0.30 + n], -1)
    snow = np.stack([0.90 + n * 0.3, 0.93 + n * 0.3, 0.97 + n * 0.2], -1)
    forest = np.stack([0.07 + n * .3, 0.19 + n * .5, 0.11 + n * .3], -1)
    grass = np.stack([0.34 + n, 0.42 + n, 0.20 + n], -1)
    c = rock.copy()
    f = ((h < 3000) & (s < 0.75))[..., None]
    c = np.where(f, forest, c)
    c = np.where(((h < 2350) & (s < 0.25))[..., None], grass, c)
    sn = ((h > 3500 + n * 600) & (s < 1.1)) | (h > 4300)
    c = np.where(sn[..., None], snow, c)
    ld = np.hypot(x - LAKE[0], z - LAKE[1])
    c = np.where((ld < LAKE[2] * 1.05)[..., None], np.array([0.1, 0.4, 0.42]), c)
    c = c * (0.93 + 0.14 * np.sin(x / 40.0)[..., None] * 0.2)
    return (np.clip(c, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)


def save_bin(path, h, hmin, hmax):
    v = np.round((h - hmin) / (hmax - hmin) * 65535).astype("<u2")
    path.write_bytes(v.tobytes())


def tile(x0, z0, w, hh, px, path):
    xs = x0 + (np.arange(px) + 0.5) / px * w
    zs = z0 + (np.arange(px) + 0.5) / px * hh
    X, Z = np.meshgrid(xs, zs)
    Image.fromarray(colour(X, Z, raw(X, Z))).save(path, "WEBP", quality=82)


def glb_box(path, w, d, h):
    """A minimal valid GLB: a box with a pyramid roof, origin at ground centre, +y up."""
    hw, hd = w / 2, d / 2
    v = [(-hw, 0, -hd), (hw, 0, -hd), (hw, h, -hd), (-hw, h, -hd), (-hw, 0, hd), (hw, 0, hd), (hw, h, hd), (-hw, h, hd), (0, h * 1.6, 0)]
    f = [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 4, 7), (0, 7, 3), (1, 2, 6), (1, 6, 5), (3, 7, 8), (2, 8, 7 + 0), (3, 8, 2), (7, 6, 8), (2, 6, 8)]
    f = [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 4, 7), (0, 7, 3), (1, 2, 6), (1, 6, 5), (3, 8, 2), (7, 8, 3), (6, 8, 7), (2, 8, 6)]
    pos = np.array(v, "<f4").tobytes()
    idx = np.array(f, "<u2").flatten().tobytes()
    idx += b"\0" * (-len(idx) % 4)
    binb = pos + idx
    arr = np.array(v)
    gltf = {"asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}],
            "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1, "material": 0}]}],
            "materials": [{"pbrMetallicRoughness": {"baseColorFactor": [0.8, 0.72, 0.55, 1], "metallicFactor": 0, "roughnessFactor": 0.9}}],
            "buffers": [{"byteLength": len(binb)}],
            "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(pos), "target": 34962}, {"buffer": 0, "byteOffset": len(pos), "byteLength": len(f) * 6, "target": 34963}],
            "accessors": [{"bufferView": 0, "componentType": 5126, "count": len(v), "type": "VEC3", "min": arr.min(0).tolist(), "max": arr.max(0).tolist()},
                          {"bufferView": 1, "componentType": 5123, "count": len(f) * 3, "type": "SCALAR"}]}
    js = json.dumps(gltf).encode()
    js += b" " * (-len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(binb)
    path.write_bytes(struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<I4s", len(js), b"JSON") + js + struct.pack("<I4s", len(binb), b"BIN\0") + binb)


def main():
    (OUT / "albedo").mkdir(parents=True, exist_ok=True)
    (OUT / "trees").mkdir(exist_ok=True)
    (OUT / "models").mkdir(exist_ok=True)
    (OUT / "photos" / "kalam").mkdir(parents=True, exist_ok=True)
    xs = np.arange(N) * RES
    X, Z = np.meshgrid(xs, xs)
    H = raw(X, Z)
    hmin, hmax = float(H.min()), float(H.max())
    save_bin(OUT / "height.bin", H, hmin, hmax)

    FR, FN = 120.0, 320
    fo = -(FN * FR - W) / 2
    fx = fo + np.arange(FN) * FR
    FX, FZ = np.meshgrid(fx, fx)
    ring = np.hypot(FX - W / 2, FZ - W / 2)
    FH = raw(FX, FZ) + 900 * np.clip((ring - W * 0.55) / 6000, 0, 1) ** 1.3 * (1 + 0.4 * np.sin(FX / 900) * np.cos(FZ / 1100))
    fmin, fmax = float(FH.min()), float(FH.max())
    save_bin(OUT / "far.bin", FH, fmin, fmax)
    px = 1024
    xs_ = fo + (np.arange(px) + .5) / px * FN * FR
    FXi, FZi = np.meshgrid(xs_, xs_)
    Image.fromarray(colour(FXi, FZi, raw(FXi, FZi) + 900 * np.clip((np.hypot(FXi - W / 2, FZi - W / 2) - W * .55) / 6000, 0, 1) ** 1.3)).save(OUT / "albedo" / "far.webp", "WEBP", quality=80)
    tile(0, 0, W, W, 1024, OUT / "albedo" / "overview.webp")

    nc = N // CH
    cells_total = N - 1
    for cy in range(nc):
        for cx in range(nc):
            x0, z0 = cx * CH * RES, cy * CH * RES
            cw = min(CH, cells_total - cx * CH) * RES
            ch_ = min(CH, cells_total - cy * CH) * RES
            for l in range(4):
                d = OUT / "albedo" / f"L{l}"
                d.mkdir(exist_ok=True)
                tile(x0, z0, cw, ch_, (CH * 3) >> l, d / f"{cx}_{cy}.webp")
            n = 30000
            tx = x0 + rng.uniform(0, cw, n)
            tz = z0 + rng.uniform(0, ch_, n)
            th = raw(tx, tz)
            ok = (th < 3000) & (slope(tx, tz) < 0.7) & (np.hypot(tx - LAKE[0], tz - LAKE[1]) > LAKE[2] * 1.2)
            ok &= rng.random(n) < np.clip((3000 - th) / 900, 0.08, 1)
            ok &= np.abs(tx - river_x(tz)) > 22
            sc = rng.uniform(0.45, 1.1, n)
            arr = np.stack([tx, tz, sc], -1)[ok].astype("<f4")
            (OUT / "trees" / f"{cx}_{cy}.bin").write_bytes(arr.tobytes())

    # vectors
    t = np.linspace(0, W, 240)
    river = [[float(river_x(z)), float(z)] for z in t]
    lake_ring = [[LAKE[0] + LAKE[2] * (1 + 0.12 * math.sin(a * 5)) * math.cos(a), LAKE[1] + LAKE[2] * (1 + 0.12 * math.sin(a * 5)) * math.sin(a)]
                 for a in np.linspace(0, 2 * math.pi, 49)[:-1]]
    paved = [[float(river_x(z) + 140), float(z)] for z in t]
    jeep = [[float(river_x(z) + 140 + (z / W) * 1200 + 600 * math.sin(z / 700)), float(z)] for z in t[40:150]]
    track = [[float(W * .2 + k * 40), float(W * .3 + 700 * math.sin(k / 6.0) + k * 30)] for k in range(120)]
    path = [[float(W * .62 + k * 30 + 200), float(W * .42 + k * 50)] for k in range(60)]
    bld = []
    for i in range(80):
        zz = rng.uniform(W * 0.25, W * 0.45)
        bld.append({"x": float(river_x(zz) + rng.uniform(190, 420)), "z": float(zz), "w": float(rng.uniform(6, 14)), "d": float(rng.uniform(8, 16)),
                    "angle_deg": float(rng.uniform(-20, 20)), "roof": "gable" if i % 3 else "flat"})
    vec = {"lakes": [{"name": "Mock Lake", "slug": "mock-lake", "level_m": LAKE_LEVEL, "rings": [lake_ring]}],
           "rivers": [{"name": "Mock River", "kind": "river", "width_m": 18, "pts": river},
                      {"name": None, "kind": "stream", "width_m": 5, "pts": [[LAKE[0] + k * 25, LAKE[1] - 400 + k * 30] for k in range(-5, 60)]}],
           "roads": [{"name": "N-95", "class": "paved", "pts": paved}, {"name": None, "class": "jeep", "pts": jeep},
                     {"name": None, "class": "track", "pts": track}, {"name": None, "class": "path", "pts": path}],
           "buildings": bld,
           "routes": [{"slug": "r1", "name": "Mock trek", "kind": "trek", "confidence": "high", "length_km": 12, "ascent_m": 900, "pieces": [path, track[:60]]}]}
    (OUT / "vectors.json").write_text(json.dumps(vec))

    def at(x, z):
        return float(raw(np.array(x), np.array(z)))
    kx, kz = float(river_x(W * 0.35) + 300), W * 0.35
    px_, pz_ = W * 0.55, W * 0.3
    gx = [h for h in HILLS]
    pk = max(HILLS, key=lambda a: a[2])
    pkx, pkz = float(np.clip(pk[0], 600, W - 600)), float(np.clip(pk[1], 600, W - 600))
    places = [
        {"slug": "kalam", "name": "Kalam", "name_ur": "کالام", "kind": "town", "area": "Swat", "x": kx, "z": kz, "ground_m": at(kx, kz), "label_elevation_m": None, "tier": 1,
         "summary": "A mock mountain town at the head of the valley, used to test the panel and labels.",
         "timeline": [{"date": "1900", "event": "A mock event happened here.", "source": "https://example.org/a"}, {"date": "1950", "event": "Another one.", "source": "https://example.org/b"}],
         "facts": [{"text": "It sits beside the river.", "quote": "The town lies on the right bank of the river.", "source": "https://example.org/c"}],
         "access": "By road from the south, about four hours.", "hidden_gem": False,
         "photos": [{"file": "photos/kalam/01.jpg", "attribution": "Photo: Mock Author, CC BY-SA 4.0, via Wikimedia Commons", "url": "https://example.org/p"}],
         "model": None, "confidence": "high"},
        {"slug": "mock-lake", "name": "Mock Lake", "name_ur": None, "kind": "lake", "area": "Swat", "x": LAKE[0], "z": LAKE[1], "ground_m": LAKE_LEVEL, "label_elevation_m": 2310, "tier": 1,
         "summary": "A turquoise lake.", "timeline": [], "facts": [], "access": "", "hidden_gem": True, "photos": [], "model": None, "confidence": "medium"},
        {"slug": "mock-peak", "name": "Mock Peak", "name_ur": None, "kind": "peak", "area": "", "x": pkx, "z": pkz, "ground_m": at(pkx, pkz), "label_elevation_m": 4710, "tier": 2,
         "summary": "The highest point.", "timeline": [], "facts": [], "access": "", "hidden_gem": False, "photos": [], "model": None, "confidence": "high"},
        {"slug": "mock-stupa", "name": "Mock Stupa", "name_ur": None, "kind": "stupa", "area": "", "x": px_, "z": pz_, "ground_m": at(px_, pz_), "label_elevation_m": None, "tier": 2,
         "summary": "A heritage site with a model.", "timeline": [], "facts": [], "access": "", "hidden_gem": False, "photos": [], "model": "models/mock-stupa.glb", "confidence": "high"},
        {"slug": "mock-pass", "name": "Mock Pass", "name_ur": None, "kind": "pass", "area": "", "x": W * 0.8, "z": W * 0.8, "ground_m": at(W * 0.8, W * 0.8), "label_elevation_m": 3600, "tier": 4,
         "summary": "A pass.", "timeline": [], "facts": [], "access": "", "hidden_gem": False, "photos": [], "model": None, "confidence": "low"},
    ]
    (OUT / "places.json").write_text(json.dumps(places, ensure_ascii=False), encoding="utf-8")
    glb_box(OUT / "models" / "mock-stupa.glb", 10, 10, 8)
    Image.fromarray((np.random.default_rng(1).random((120, 160, 3)) * 255).astype(np.uint8)).save(OUT / "photos" / "kalam" / "01.jpg")

    # sky: warm gradient with soft cloud bands
    sh, sw = 512, 1024
    v = np.linspace(0, 1, sh)[:, None]
    top, hor, low = np.array([0.36, 0.5, 0.78]), np.array([0.97, 0.82, 0.70]), np.array([0.85, 0.7, 0.6])
    sky = np.where(v < 0.5, top + (hor - top) * (v / 0.5) ** 0.6, hor + (low - hor) * ((v - 0.5) / 0.5))[:, :, None] if False else None
    rows = np.zeros((sh, 3))
    for i, vv in enumerate(v[:, 0]):
        rows[i] = top + (hor - top) * (vv / 0.5) ** 0.6 if vv < 0.5 else hor + (low - hor) * ((vv - 0.5) / 0.5)
    img = np.repeat(rows[:, None, :], sw, 1)
    xx = np.arange(sw)[None, :]
    cloud = (np.sin(xx / 37.0 + v * 9) * np.sin(xx / 91.0 - v * 17) + 1) * 0.5
    img = img + (cloud[..., None] * 0.07 * np.clip(1 - np.abs(v - 0.38) * 5, 0, 1)[..., None])
    Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).resize((2048, 1024)).save(OUT / "sky.jpg", quality=88)

    cx_ = W * 0.5
    meta = {"version": 1, "slug": slug, "title": "Mock Valley", "subtitle": "Kalam · Mock Lake · Mock Peak", "crs": "EPSG:32643", "origin_utm": [400000.0, 3800000.0],
            "res_m": RES, "cols": N, "rows": N, "size_m": [W, W], "hmin": hmin, "hmax": hmax, "chunk_cells": CH, "chunks": [nc, nc], "albedo_levels": 4, "albedo_px_m": 10,
            "far": {"origin_m": [fo, fo], "size_m": [FN * FR, FN * FR], "cols": FN, "rows": FN, "res_m": FR, "hmin": fmin, "hmax": fmax},
            "exag_default": 1.6, "tree_scale_default": 2.5, "landmark_scale_default": 30,
            "sun_default": {"azimuth_deg": 215, "elevation_deg": 12, "color": [1.0, 0.78, 0.55]},
            "home_camera": {"target": [cx_, 2600, W * 0.45], "heading_deg": 5, "pitch_deg": -32, "distance_m": 22000},
            "attribution": ["Mock data, generated procedurally"]}
    (OUT / "meta.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    print("wrote", OUT, "hmin/hmax", hmin, hmax)


main()
