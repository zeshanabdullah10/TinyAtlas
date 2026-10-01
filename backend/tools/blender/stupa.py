"""Procedural stupa maquettes.  blender -b -P stupa.py -- data/models3d/specs/<slug>.json [--no-render] [--no-export]

Builds a lathe (profile spun round Z) + stepped blocks/stairs from a JSON spec, generates masonry textures with numpy
(coursed stone/brick, grass, breach patches, normal map from the relief), assigns them as image textures, exports a
GLB (JPEG textures) and renders a 2x2 turntable preview (+ optional photo comparison).  Blender Z-up; stairs face -Y.
"""
import bpy, sys, json, math, os
import numpy as np
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[3]
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SPEC_PATH = Path(ARGS[0])
SPEC = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
OUT = ROOT / "data" / "models3d"
SLUG = SPEC["slug"]
RNG = np.random.default_rng(SPEC.get("seed", 7))

# ----------------------------------------------------------------------------------------------- noise / textures
def gnoise(rng, H, W, ppm_u, ppm_v, lam_u, lam_v=None):
    """Periodic gaussian-filtered noise (std 1); features ~lam metres, anisotropic."""
    lam_v = lam_v or lam_u
    ky = np.fft.fftfreq(H)[:, None] * ppm_v
    kx = np.fft.rfftfreq(W)[None, :] * ppm_u
    f = np.exp(-((kx * lam_u) ** 2 + (ky * lam_v) ** 2) * 2.5).astype(np.float32)
    n = np.fft.irfft2(np.fft.rfft2(rng.standard_normal((H, W)).astype(np.float32)) * f, s=(H, W))
    return (n / (n.std() + 1e-9)).astype(np.float32)


def fbm2(rng, H, W, ppm_u, ppm_v, lam, octaves=4):
    a, s, tot = 1.0, 0, 0
    for o in range(octaves):
        s = s + a * gnoise(rng, H, W, ppm_u, ppm_v, lam / 2 ** o)
        tot += a * a
        a *= 0.55
    return s / math.sqrt(tot)


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


ZONES = {  # coursed-masonry looks, matched to the photos (metres)
    "rubble": dict(course=0.11, length=0.26, jit_h=0.35, jit_l=0.55, warp=0.05, relief=0.03,
                   pal=[(.64, .50, .35), (.72, .58, .42), (.52, .42, .32), (.67, .57, .45), (.58, .47, .37)],
                   mortar=(.36, .28, .20)),
    "brick": dict(course=0.13, length=0.34, jit_h=0.08, jit_l=0.12, warp=0.015, relief=0.012,
                  pal=[(.66, .55, .38), (.58, .47, .33), (.62, .56, .46), (.70, .60, .43)], mortar=(.26, .21, .15)),
    "dome_brick": dict(course=0.14, length=0.36, jit_h=0.10, jit_l=0.15, warp=0.02, relief=0.014,
                       pal=[(.62, .54, .39), (.54, .48, .37), (.68, .58, .43), (.52, .48, .42)], mortar=(.30, .25, .18)),
    "ashlar": dict(course=0.27, length=0.62, jit_h=0.05, jit_l=0.25, warp=0.01, relief=0.01,
                   pal=[(.68, .60, .45), (.64, .56, .42), (.60, .54, .43)], mortar=(.34, .28, .20)),
    "slab": dict(course=0.11, length=0.55, jit_h=0.25, jit_l=0.45, warp=0.015, relief=0.02,
                 pal=[(.56, .50, .41), (.46, .43, .39), (.62, .54, .42), (.50, .47, .43), (.58, .52, .44)],
                 mortar=(.42, .35, .26)),
    "slab_dark": dict(course=0.10, length=0.5, jit_h=0.25, jit_l=0.45, warp=0.015, relief=0.02,
                      pal=[(.38, .37, .36), (.45, .42, .38), (.34, .34, .34), (.50, .45, .38)], mortar=(.40, .34, .26)),
    "core": dict(course=0.2, length=0.4, jit_h=0.5, jit_l=0.6, warp=0.08, relief=0.06,
                 pal=[(.42, .31, .22), (.36, .27, .20), (.48, .37, .27)], mortar=(.22, .16, .12)),
}
ZONES.update(SPEC.get("zone_overrides", {}))


def coursed(rng, H, W, ppm_u, ppm_v, zone):
    z = ZONES[zone]
    Wm, Hm = W / ppm_u, H / ppm_v
    nc = max(1, int(round(Hm / z["course"])))
    ch = rng.lognormal(0, z["jit_h"], nc)
    ch = ch / ch.sum() * Hm
    cb = np.concatenate([[0], np.cumsum(ch)])
    shift = rng.uniform(0, Wm, nc)
    K, Lk, = [], []
    for c in range(nc):
        n = max(1, int(round(Wm / z["length"])))
        l = rng.lognormal(0, z["jit_l"], n)
        edges = np.cumsum(l / l.sum() * Wm)
        edges[-1] = Wm
        K.append(c * (Wm + 1) + edges)
        Lk.append(c * (Wm + 1) + np.concatenate([[0], edges[:-1]]))
    K, Lk = np.concatenate(K), np.concatenate(Lk)
    ns = len(K)
    yy = (np.arange(H, dtype=np.float32)[:, None] + 0.5) / ppm_v
    xx = (np.arange(W, dtype=np.float32)[None, :] + 0.5) / ppm_u
    wa = z["warp"]
    Y = (yy + wa * gnoise(rng, H, W, ppm_u, ppm_v, 0.5)) % Hm
    X = (xx + wa * gnoise(rng, H, W, ppm_u, ppm_v, 0.5)) % Wm
    c = np.clip(np.searchsorted(cb, Y, "right") - 1, 0, nc - 1)
    Xs = (X - shift[c]) % Wm
    key = c * (Wm + 1) + Xs
    idx = np.clip(np.searchsorted(K, key, "right"), 0, ns - 1)
    dx = np.minimum(key - Lk[idx], K[idx] - key) * ppm_u
    dy = np.minimum(Y - cb[c], cb[c + 1] - Y) * ppm_v
    e = np.minimum(dx, dy)
    pal = np.array(z["pal"], np.float32)
    ia, ib = rng.integers(0, len(pal), ns), rng.integers(0, len(pal), ns)
    t = rng.random(ns).astype(np.float32)
    br = (1 + rng.normal(0, 0.07, ns)).astype(np.float32)
    off = rng.normal(0, 1, ns).astype(np.float32)
    sc = (pal[ia[idx]] * (1 - t[idx, None]) + pal[ib[idx]] * t[idx, None]) * br[idx, None]
    m = np.clip((e - 0.5) / 1.1, 0, 1)[..., None]
    grain = gnoise(rng, H, W, ppm_u, ppm_v, 0.04)[..., None]
    col = np.array(z["mortar"], np.float32) * (1 - m) + sc * (1 + 0.07 * grain) * m
    hgt = z["relief"] * (np.clip(e / 2.5, 0, 1) ** 0.7 + 0.35 * off[idx] + 0.15 * grain[..., 0])
    return col.astype(np.float32), hgt.astype(np.float32)


def normal_map(hgt, ppm_u, ppm_v, strength=1.0):
    gx = np.gradient(hgt, axis=1) * ppm_u
    gy = -np.gradient(hgt, axis=0) * ppm_v          # image row 0 is up, so v-up gradient is negated
    n = np.stack([-gx * strength, -gy * strength, np.ones_like(hgt)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def box_down(a, f):
    h, w = a.shape[:2]
    return a[:h // f * f, :w // f * f].reshape(h // f, f, w // f, f, -1).mean((1, 3))


def make_image(name, arr, srgb):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = np.clip(arr, 0, 1)
    img.pixels.foreach_set(rgba[::-1].ravel())      # Blender rows are bottom-up
    img.update()
    return img


def make_material(name, color_img, normal_img, rough=0.93):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = 0.0
    tc = nt.nodes.new("ShaderNodeTexImage")
    tc.image = color_img
    tc.interpolation = "Smart"
    nt.links.new(tc.outputs["Color"], bsdf.inputs["Base Color"])
    tn = nt.nodes.new("ShaderNodeTexImage")
    tn.image = normal_img
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.inputs["Strength"].default_value = 1.0
    nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
    if not os.environ.get("NO_NORMAL"):
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


# ----------------------------------------------------------------------------------------------- lathe geometry
def catmull(P, spacing):
    P = np.asarray(P, float)
    pts = [P[0]]
    ext = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    for i in range(len(P) - 1):
        p0, p1, p2, p3 = ext[i], ext[i + 1], ext[i + 2], ext[i + 3]
        n = max(1, int(round(np.linalg.norm(p2 - p1) / spacing)))
        for k in range(1, n + 1):
            t = k / n
            pts.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    return np.array(pts)


def resample(profile, corner=38, spacing=0.8):
    P = np.asarray(profile, float)
    d = np.diff(P, axis=0)
    ang = np.degrees(np.arctan2(d[:, 1], d[:, 0]))
    runs, cur = [], [0]
    for i in range(1, len(P)):
        cur.append(i)
        if i < len(P) - 1:
            turn = abs((ang[i] - ang[i - 1] + 180) % 360 - 180)
            if turn > corner:
                runs.append(cur)
                cur = [i]
    runs.append(cur)
    rows = []
    for r in runs:
        Q = P[r]
        if len(Q) == 2:
            L = np.linalg.norm(Q[1] - Q[0])
            n = max(1, int(round(L / (spacing * 1.6))))
            R = np.array([Q[0] + (Q[1] - Q[0]) * k / n for k in range(n + 1)])
        else:
            R = catmull(Q, spacing)
        rows.extend(R.tolist())
    return np.array(rows)


def noise3(p, seed, scale, octaves=4):
    """Smooth 3D noise at points p (N,3) via random-direction sine sums; std ~ 1."""
    rg = np.random.default_rng(seed)
    out = np.zeros(len(p))
    amp, tot = 1.0, 0
    for o in range(octaves):
        for _ in range(4):
            k = rg.normal(size=3)
            k = k / np.linalg.norm(k) * (2 * math.pi / (scale / 2 ** o)) * rg.uniform(0.7, 1.3)
            out += amp * np.sin(p @ k + rg.uniform(0, 6.28))
            tot += amp * amp
        amp *= 0.55
    return out / math.sqrt(tot * 0.5)


def piece(points, h):
    pts = np.array(points, float)
    return np.interp(h, pts[:, 0], pts[:, 1])


def breach_w(theta, h):
    b = SPEC.get("breach")
    if not b:
        return np.zeros(np.broadcast(theta, h).shape)
    t0 = math.radians(b["theta_deg"])
    dth = (theta - t0 + math.pi) % (2 * math.pi) - math.pi
    wt = np.clip(1 - np.abs(dth) / math.radians(b["width_deg"] / 2), 0, 1)
    hc, hw = (b["h0"] + b["h1"]) / 2, (b["h1"] - b["h0"]) / 2
    wh = np.clip(1 - np.abs(h - hc) / hw, 0, 1)
    return smooth(0, 0.6, wt) * smooth(0, 0.5, wh)


def build_lathe():
    prof = SPEC["profile"]
    rows = resample(prof, spacing=SPEC.get("row_spacing", 0.8))
    N = SPEC.get("segments", 56)
    zoff = SPEC.get("z_offset", 0.0)
    arc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(rows, axis=0), axis=1))])
    S = arc[-1]
    verts, uvs, faces, rowvid = [], [], [], []
    dsp = SPEC.get("disp", [[0, 0], [100, 0]])
    for ri, (r, h) in enumerate(rows):
        base = len(verts)
        apex = r < 1e-4
        cols = 1 if apex else N + 1
        for j in range(cols):
            th = 2 * math.pi * (j % N) / N
            rr = r
            x, y, z = rr * math.cos(th), rr * math.sin(th), h
            amp = piece(dsp, h)
            if amp > 0:
                p = np.array([[x, y, z]])
                dr = amp * noise3(p, 11, 4.0)[0]
                dz = amp * 0.8 * noise3(p, 23, 4.0)[0]
                if apex:
                    dr = 0
                x, y = (rr + dr) * math.cos(th), (rr + dr) * math.sin(th)
                z = h + dz
            bw = float(breach_w(th, h))
            if bw > 0:
                depth = SPEC["breach"]["depth"] * bw * (0.7 + 0.3 * math.sin(7 * th + 3 * h))
                rn = max(rr - depth, 0)
                x, y = (x / max(rr, 1e-6)) * rn, (y / max(rr, 1e-6)) * rn
            verts.append((x, y, z + zoff))
            uvs.append((j / N if not apex else 0.5, arc[ri] / S))
        rowvid.append((base, cols))
    for ri in range(len(rows) - 1):
        # duplicated corner rows have zero arc between them -> skip (hard edge)
        if arc[ri + 1] - arc[ri] < 1e-9:
            continue
        b0, c0 = rowvid[ri]
        b1, c1 = rowvid[ri + 1]
        for j in range(N):
            if c0 == 1:
                faces.append((b0, b1 + j + 1, b1 + j))
            elif c1 == 1:
                faces.append((b0 + j, b0 + j + 1, b1))
            else:
                faces.append((b0 + j, b0 + j + 1, b1 + j + 1, b1 + j))
    return verts, faces, uvs, rows, arc, S


def build_blocks():
    T = SPEC.get("block_tile", 4.0)
    verts, faces, uvs = [], [], []

    def quad(p, uv):
        b = len(verts)
        verts.extend(p)
        uvs.extend(uv)
        faces.append((b, b + 1, b + 2, b + 3))

    def box(x0, x1, y0, y1, z0, z1):
        quad([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], [(x0 / T, z0 / T), (x1 / T, z0 / T), (x1 / T, z1 / T), (x0 / T, z1 / T)])   # -y
        quad([(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)], [(x1 / T, z0 / T), (x0 / T, z0 / T), (x0 / T, z1 / T), (x1 / T, z1 / T)])   # +y
        quad([(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)], [(y1 / T, z0 / T), (y0 / T, z0 / T), (y0 / T, z1 / T), (y1 / T, z1 / T)])   # -x
        quad([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], [(y0 / T, z0 / T), (y1 / T, z0 / T), (y1 / T, z1 / T), (y0 / T, z1 / T)])   # +x
        quad([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], [(x0 / T, y0 / T), (x1 / T, y0 / T), (x1 / T, y1 / T), (x0 / T, y1 / T)])   # top

    for b in SPEC.get("blocks", []):
        box(b["x"][0], b["x"][1], b["y"][0], b["y"][1], b["z"][0], b["z"][1])
    for s in SPEC.get("stairs", []):
        n = s["steps"]
        cx, w = s.get("cx", 0.0), s["width"]
        ya, yb = s["y_from"], s["y_to"]
        tread = (yb - ya) / n
        rise = (s["z1"] - s["z0"]) / n
        zb = 0.0 if s.get("solid", True) else s["z0"]
        xa, xb = cx - w / 2, cx + w / 2
        for k in range(n):
            y0, y1 = ya + k * tread, ya + (k + 1) * tread
            zt, zp = s["z0"] + (k + 1) * rise, s["z0"] + k * rise
            zl = zp if k > 0 else zb
            quad([(xa, y0, zt), (xb, y0, zt), (xb, y1, zt), (xa, y1, zt)], [(xa / T, y0 / T), (xb / T, y0 / T), (xb / T, y1 / T), (xa / T, y1 / T)])   # tread
            quad([(xa, y0, zl), (xb, y0, zl), (xb, y0, zt), (xa, y0, zt)], [(xa / T, zl / T), (xb / T, zl / T), (xb / T, zt / T), (xa / T, zt / T)])   # riser (-y)
            quad([(xa, y1, zb), (xa, y0, zb), (xa, y0, zt), (xa, y1, zt)], [(y1 / T, zb / T), (y0 / T, zb / T), (y0 / T, zt / T), (y1 / T, zt / T)])   # -x wall
            quad([(xb, y0, zb), (xb, y1, zb), (xb, y1, zt), (xb, y0, zt)], [(y0 / T, zb / T), (y1 / T, zb / T), (y1 / T, zt / T), (y0 / T, zt / T)])   # +x wall
    L = SPEC.get("lumps")
    if L:
        rg = np.random.default_rng(SPEC.get("seed", 7) + 5)
        for _ in range(L["n"]):
            a = rg.uniform(0, 2 * math.pi)
            rad = rg.uniform(*L["r_range"])
            cx, cy = rad * math.cos(a), rad * math.sin(a)
            sz = rg.uniform(*L["size"])
            ring = [[(cx + sz * rg.uniform(.75, 1.25) * f * math.cos(2 * math.pi * j / 6), cy + sz * rg.uniform(.75, 1.25) * f * math.sin(2 * math.pi * j / 6),
                      L.get("z", 0.0) + sz * 0.6 * h) for j in range(6)] for f, h in ((0.55, 0.85), (0.9, 0.45), (1.0, 0.0))]
            apex = (cx, cy, L.get("z", 0.0) + sz * 0.6 * rg.uniform(1.0, 1.15))
            b = len(verts)
            vs = [apex] + ring[0] + ring[1] + ring[2]
            verts.extend(vs)
            uvs.extend([((v[0] + v[1]) / T, v[2] / T + 0.25) for v in vs])
            for j in range(6):
                faces.append((b, b + 1 + j, b + 1 + (j + 1) % 6))
            for k in range(2):
                for j in range(6):
                    a0, a1 = b + 1 + 6 * k + j, b + 1 + 6 * k + (j + 1) % 6
                    faces.append((a0, a0 + 6, a1 + 6, a1))
    return verts, faces, uvs


def grass_texture():
    rng = np.random.default_rng(SPEC.get("seed", 7) + 9)
    n = 512
    ppm = n / 5.0
    g = SPEC["grass_cap"]
    pal = np.array(g.get("pal", [(.50, .46, .27), (.42, .40, .24), (.33, .33, .18), (.58, .52, .32)]), np.float32)
    f = fbm2(rng, n, n, ppm, ppm, 0.6)
    st = gnoise(rng, n, n, ppm, ppm, 0.03, 0.5)
    t = smooth(-1.2, 1.2, f + 0.6 * st)[..., None]
    col = pal[1] * (1 - t) + pal[0] * t
    col = col * (1 + 0.25 * st[..., None]) * (1 - 0.35 * smooth(0.8, 2.0, -f)[..., None]) + (pal[3] - pal[1]) * 0.35 * smooth(0.7, 2.0, st)[..., None]
    return np.clip(col, 0, 1), normal_map(0.05 * st + 0.02 * gnoise(rng, n, n, ppm, ppm, 0.015), ppm, ppm, 1.0)


def build_cap(rows, N, zoff):
    g = SPEC["grass_cap"]
    rg = np.random.default_rng(SPEC.get("seed", 7) + 6)
    sel = [i for i, (r, h) in enumerate(rows) if h >= g["h0"]]
    i0 = sel[0]
    tu, tv = g.get("tile", (10, 3))
    verts, faces, uvs, rowv = [], [], [], []
    S = 0.0
    prev = None
    seq = [i0] + list(range(i0, len(rows)))
    first = True
    for i in seq:
        r, h = rows[i]
        a, b = rows[max(i - 1, 0)], rows[min(i + 1, len(rows) - 1)]
        tr, th = b[0] - a[0], b[1] - a[1]
        L = math.hypot(tr, th) or 1
        nr, nh = th / L, -tr / L
        if r < 1e-4:
            nr, nh = 0, 1
        k = min(1.0, (h - g["h0"]) / 1.5)
        thick = g["thick"] * (1.0 - 0.3 * k)
        if i == i0 and first:
            thick = 0.02
            first = False
        elif i == i0:
            thick = g["thick"]
        if prev is not None:
            S += math.hypot(r - prev[0], h - prev[1])
        prev = (r, h)
        base = len(verts)
        cols = 1 if r < 1e-4 else N + 1
        for j in range(cols):
            th_ = 2 * math.pi * (j % N) / N
            p = np.array([[r * math.cos(th_), r * math.sin(th_), h]])
            lump = g["lump"] * noise3(p, 31, 5.0, 2)[0]
            rr = max(r + nr * thick + lump * 0.8, 0)
            if r < 1e-4:
                rr = 0
            verts.append((rr * math.cos(th_), rr * math.sin(th_), h + nh * thick + lump * 0.9 + zoff))
            uvs.append((tu * (j / N), tv * S / 10))
        rowv.append((base, cols))
    for ri in range(len(rowv) - 1):
        b0, c0 = rowv[ri]
        b1, c1 = rowv[ri + 1]
        for j in range(N):
            if c1 == 1:
                faces.append((b0 + j, b0 + j + 1, b1))
            else:
                faces.append((b0 + j, b0 + j + 1, b1 + j + 1, b1 + j))
    # tuft blades: tapered triangles at a few rim tiers, drooping/pointing outward
    for (hc, n, ln, droop) in g.get("tufts", []):
        for _ in range(n):
            th_ = rg.uniform(0, 2 * math.pi)
            rr = float(np.interp(hc, [rw[1] for rw in rows[i0:]], [rw[0] for rw in rows[i0:]]))
            rr += g["thick"] * 0.9
            c, s_ = math.cos(th_), math.sin(th_)
            pos = np.array([rr * c, rr * s_, hc + zoff + g["thick"] * 0.6])
            tang = np.array([-s_, c, 0.0])
            out = np.array([c, s_, 0.0])
            for _b in range(3):
                phi = rg.uniform(-0.6, 0.6)
                d = out * math.cos(phi) + tang * math.sin(phi)
                dirv = d * rg.uniform(0.6, 1.0) + np.array([0, 0, -droop * rg.uniform(0.5, 1.2)])
                l = ln * rg.uniform(0.7, 1.3)
                w = 0.5 * rg.uniform(0.7, 1.2)
                b0 = pos + rg.normal(0, 0.12, 3) * np.array([1, 1, 0.5])
                tip = b0 + dirv / np.linalg.norm(dirv) * l
                bi = len(verts)
                verts.extend([tuple(b0 - tang * w / 2), tuple(b0 + tang * w / 2), tuple(tip)])
                u0, v0 = rg.uniform(0, 0.9), rg.uniform(0, 0.9)
                uvs.extend([(u0, v0), (u0 + 0.08, v0), (u0 + 0.04, v0 + 0.08)])
                faces.append((bi, bi + 1, bi + 2) if np.dot(np.cross(tang, dirv), np.array([0, 0, 1.0])) >= 0 else (bi + 1, bi, bi + 2))
    return verts, faces, uvs


def to_object(name, verts, faces, uvs, mat, smooth_shade):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    uvl = me.uv_layers.new(name="UVMap")
    vi = np.zeros(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", vi)
    uv = np.array(uvs, np.float32)[vi]
    uvl.data.foreach_set("uv", uv.ravel())
    for p in me.polygons:
        p.use_smooth = smooth_shade
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


# ----------------------------------------------------------------------------------------------- build
def lathe_textures(rows, arc, S, N):
    size = SPEC.get("tex_size", 1024)
    W = H = size
    rmax = max(r for r, _ in rows)
    ppm_u = W / (2 * math.pi * rmax * 0.92)
    ppm_v = H / S
    rng = np.random.default_rng(SPEC.get("seed", 7) + 1)
    ys = (np.arange(H) + 0.5) / H
    s_row = (1 - ys) * S                           # row 0 = top = v 1
    h_row = np.interp(s_row, arc, rows[:, 1])
    zones = SPEC["zones"]
    col = np.zeros((H, W, 3), np.float32)
    hgt = np.zeros((H, W), np.float32)
    done = np.zeros(H, bool)
    for z in zones:
        sel = (h_row >= z["h0"]) & (h_row < z["h1"]) & ~done
        if not sel.any():
            continue
        c, h = coursed(rng, H, W, ppm_u, ppm_v, z["type"])
        col[sel], hgt[sel] = c[sel], h[sel]
        done |= sel
    if not done.all():                              # tail rows (top of dome) take the last zone
        c, h = coursed(rng, H, W, ppm_u, ppm_v, zones[-1]["type"])
        col[~done], hgt[~done] = c[~done], h[~done]
    # weathering
    wea = fbm2(rng, H, W, ppm_u, ppm_v, 3.0)
    streak = gnoise(rng, H, W, ppm_u, ppm_v, 0.25, 3.5)
    col *= (1 + 0.10 * wea[..., None] - 0.05 * np.clip(streak, 0, 3)[..., None]).astype(np.float32)
    th_col = (np.arange(W) + 0.5) / W * 2 * math.pi
    # breach: exposed core
    bw = breach_w(th_col[None, :], h_row[:, None])
    if bw.max() > 0:
        c, h = coursed(rng, H, W, ppm_u, ppm_v, "core")
        bn = np.clip(bw * 1.6 + 0.35 * gnoise(rng, H, W, ppm_u, ppm_v, 0.4) * (bw > 0.02), 0, 1)
        m = smooth(0.35, 0.6, bn)[..., None]
        col = col * (1 - m) + c * m
        hgt = hgt * (1 - m[..., 0]) + (h - 0.05 * bn) * m[..., 0]
    # grass cap
    g = SPEC.get("grass")
    if g:
        n1 = fbm2(rng, H, W, ppm_u, ppm_v, 1.2)
        gh = g["h0"] + g.get("dh", 1.0) * n1
        gw = smooth(-0.3, 0.3, (h_row[:, None] - gh) / g.get("dh", 1.0)) * g.get("cover", 1.0)
        gw = np.clip(gw + (gw > 0.2) * 0.25 * n1, 0, 1)
        t1 = fbm2(rng, H, W, ppm_u, ppm_v * 0.6, 0.35)
        streak = gnoise(rng, H, W, ppm_u, ppm_v, 0.03, 0.45)
        gc = np.array(g.get("pal", [(.40, .39, .17), (.52, .48, .26), (.26, .30, .12)]), np.float32)
        a = smooth(-1, 1, t1)[..., None]
        grass = gc[0] * (1 - a) + gc[1] * a
        grass = grass * (1 + 0.16 * streak[..., None]) * (1 - 0.35 * smooth(0.6, 1.8, fbm2(rng, H, W, ppm_u, ppm_v, 0.6))[..., None] * 0.5)
        m = smooth(0.35, 0.65, gw)[..., None]
        col = col * (1 - m) + grass * m
        hgt = hgt * (1 - m[..., 0]) + (0.03 * streak + 0.02) * m[..., 0]
    print("COLSTAT", float(col.mean()), float(np.isnan(col).sum()), float(hgt.min()), float(hgt.max()))
    nrm = normal_map(hgt, ppm_u, ppm_v, 1.0)
    nsz = SPEC.get("normal_size", 1024)
    if nsz < size:
        nrm = box_down(nrm, size // nsz)
        n = nrm * 2 - 1
        nrm = (n / np.linalg.norm(n, axis=-1, keepdims=True)) * 0.5 + 0.5
    return col, nrm


def block_textures():
    size = SPEC.get("block_tex_size", 1024)
    T = SPEC.get("block_tile", 4.0)
    rng = np.random.default_rng(SPEC.get("seed", 7) + 2)
    ppm = size / T
    c, h = coursed(rng, size, size, ppm, ppm, SPEC.get("block_zone", "slab"))
    wea = fbm2(rng, size, size, ppm, ppm, 1.5)
    c *= (1 + 0.10 * wea[..., None]).astype(np.float32)
    return c, normal_map(h, ppm, ppm, 1.0)


def main():
    ob_list = []
    mats = {}
    if SPEC.get("profile"):
        verts, faces, uvs, rows, arc, S = build_lathe()
        col, nrm = lathe_textures(rows, arc, S, SPEC.get("segments", 56))
        mat = make_material(SLUG + "_lathe", make_image(SLUG + "_color", col, True), make_image(SLUG + "_normal", nrm, False))
        ob_list.append(to_object(SLUG + "_lathe", verts, faces, uvs, mat, True))
    if SPEC.get("grass_cap"):
        verts, faces, uvs = build_cap(rows, SPEC.get("segments", 56), SPEC.get("z_offset", 0.0))
        col, nrm = grass_texture()
        mat = make_material(SLUG + "_grass", make_image(SLUG + "_gcolor", col, True), make_image(SLUG + "_gnormal", nrm, False), 1.0)
        mat.use_backface_culling = False
        ob_list.append(to_object(SLUG + "_grass", verts, faces, uvs, mat, True))
    if SPEC.get("blocks") or SPEC.get("stairs") or SPEC.get("lumps"):
        verts, faces, uvs = build_blocks()
        col, nrm = block_textures()
        mat = make_material(SLUG + "_blocks", make_image(SLUG + "_bcolor", col, True), make_image(SLUG + "_bnormal", nrm, False))
        ob_list.append(to_object(SLUG + "_blocks", verts, faces, uvs, mat, False))
    tris = sum(sum(1 if len(p.vertices) == 3 else 2 for p in o.data.polygons) for o in ob_list)
    print("TRIS", tris)
    OUT.mkdir(parents=True, exist_ok=True)
    if "--no-export" not in ARGS:
        bpy.ops.object.select_all(action="DESELECT")
        for o in ob_list:
            o.select_set(True)
        glb = OUT / f"{SLUG}.glb"
        bpy.ops.export_scene.gltf(filepath=str(glb), export_format="GLB", use_selection=True, export_image_format="JPEG",
                                  export_jpeg_quality=SPEC.get("jpeg_quality", 82), export_apply=False, export_yup=True)
        print("GLB", glb.stat().st_size)
    if "--no-render" not in ARGS:
        render(ob_list)


# ----------------------------------------------------------------------------------------------- preview
def setup_scene(res):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 40
    sc.cycles.use_denoising = True
    sc.cycles.device = "CPU"
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "Standard"
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.55, 0.57, 0.60, 1)
    bg.inputs[1].default_value = 1.0
    sc.world = w
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 3.5
    sun.angle = math.radians(6)
    so = bpy.data.objects.new("sun", sun)
    so.rotation_euler = (math.radians(48), 0, math.radians(35))
    sc.collection.objects.link(so)
    gm = bpy.data.materials.new("ground")
    gm.diffuse_color = (0.42, 0.42, 0.42, 1)
    gm.use_nodes = True
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.42, 0.42, 0.42, 1)
    gm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1
    bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, SPEC.get("ground_z", 0.0)))
    bpy.context.active_object.data.materials.append(gm)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    return sc, cam


def aim(cam, pos, target):
    cam.location = pos
    d = Vector(target) - Vector(pos)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def render_to(sc, path):
    sc.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def load_np(path, size=None):
    img = bpy.data.images.load(str(path))
    if size:
        img.scale(*size)
    a = np.array(img.pixels[:], np.float32).reshape(img.size[1], img.size[0], 4)[::-1, :, :3]
    return a


def save_np(a, path):
    h, w = a.shape[:2]
    img = bpy.data.images.new("o", w, h, alpha=False)
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = a
    img.pixels.foreach_set(rgba[::-1].ravel())
    img.filepath_raw = str(path)
    img.file_format = "PNG"
    img.save()


def render(objs):
    allv = np.array([v.co[:] for o in objs for v in o.data.vertices])
    lo, hi = allv.min(0), allv.max(0)
    ctr = (lo + hi) / 2
    rad = np.linalg.norm(hi - lo) / 2
    sc, cam = setup_scene((800, 600))
    cam.data.lens = 50
    tmp = OUT / "_tmp"
    tmp.mkdir(exist_ok=True)
    tiles = []
    for i, az in enumerate((0, 90, 180, 270)):
        a = math.radians(az - 90 + 35)              # az 0 -> from -Y (the stair side), turned slightly for 3/4
        el = math.radians(14)
        D = rad * 2.7
        pos = (ctr[0] + D * math.cos(el) * math.cos(a), ctr[1] + D * math.cos(el) * math.sin(a), ctr[2] + D * math.sin(el))
        aim(cam, pos, (ctr[0], ctr[1], ctr[2] - rad * 0.05))
        render_to(sc, tmp / f"v{i}.png")
        tiles.append(load_np(tmp / f"v{i}.png"))
    grid = np.vstack([np.hstack(tiles[:2]), np.hstack(tiles[2:])])
    save_np(grid, OUT / f"{SLUG}_preview.png")
    cc = SPEC.get("compare")
    if cc:
        W, H = 960, 720
        sc.render.resolution_x, sc.render.resolution_y = W, H
        cam.data.sensor_width = 36
        cam.data.lens = cc["lens_mm"]
        a = math.radians(cc["azimuth"])
        pos = (cc["dist"] * math.cos(a), cc["dist"] * math.sin(a), cc["cam_h"])
        aim(cam, pos, (0, 0, cc["target_h"]))
        render_to(sc, tmp / "cmp.png")
        left = load_np(ROOT / cc["photo"], (W, H))
        right = load_np(tmp / "cmp.png")
        save_np(np.hstack([left, right]), OUT / f"{SLUG}_compare.png")
    for f in tmp.glob("*"):
        f.unlink()
    tmp.rmdir()


bpy.ops.wm.read_factory_settings(use_empty=True)
main()
