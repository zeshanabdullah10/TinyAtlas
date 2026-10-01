"""Blender scene for a geographically true oblique "illustrated poster" view.

  blender.exe -b -P backend/tools/blender/build_scene.py -- --bundle data/bundles/swat --far data/bundles/swat_far \
      --shot kalam [--preview] [--samples N] [--out path] [--exag 1.6] [--tree-scale 2.5] [--clouds] [--no-render]

Units: 1 BU = 10 m, X east, Y north (origin = near-bundle centre), Z = metres * exag / 10.
Run backend/tools/blender/prep.py on both bundles first.
"""
import sys, os, json, math, time, argparse
from pathlib import Path
import numpy as np
import bpy
import mathutils
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[3]
BU = 10.0

OV_AZ = float(os.environ.get("OV_AZ", "215")); OV_EL = float(os.environ.get("OV_EL", "15"))
SHOTS = {
    "kalam": dict(lat=35.52, lon=72.64, heading=15.0, pitch=-13.0, dist=22000.0, lens=35.0,
                  focus=(35.486, 72.585), fstop=0.9, exag=1.6),
    "mahodand": dict(lat=35.708, lon=72.654, heading=330.0, pitch=-30.0, dist=2700.0, lens=24.0, shift_y=0.133,
                     focus=(35.708, 72.654), fstop=0.9, clouds=False, exag=1.3,
                     sun_az=150.0, sun_el=18.0, sun_strength=9.0, sun_color=(1.0, 0.78, 0.55)),
    "overview": dict(lat=35.60, lon=72.60, heading=5.0, pitch=-31.0, dist=42000.0, lens=24.0, shift_y=0.037,
                     focus=(35.486, 72.585), fstop=0.9, clouds=False, exag=1.8, sun_az=OV_AZ, sun_el=OV_EL, horizon_y=0.89,
                     haze_col=(0.93, 0.74, 0.62), sky_fade_col=(1.0, 0.78, 0.60), sky_fade_band=0.06,
                     sun_strength=11.0, sun_color=(1.0, 0.74, 0.46), auto_horizon=True, haze_km=140.0, haze_max=0.85),
}

# ------------------------------------------------------------------ args
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--bundle", default="data/bundles/swat")
ap.add_argument("--far", default="data/bundles/swat_far")
ap.add_argument("--shot", default="kalam")
ap.add_argument("--preview", action="store_true")
ap.add_argument("--samples", type=int, default=0)
ap.add_argument("--out", default="")
ap.add_argument("--exag", type=float, default=None)
ap.add_argument("--tree-scale", type=float, default=3.5)
ap.add_argument("--tree-max", type=int, default=1_500_000)
ap.add_argument("--no-trees", action="store_true")
ap.add_argument("--no-clouds", action="store_true")
ap.add_argument("--no-shrubs", action="store_true")
ap.add_argument("--no-buildings", action="store_true")
ap.add_argument("--no-render", action="store_true")
ap.add_argument("--detail", type=float, default=1.0, help="crag noise amplitude multiplier")
ap.add_argument("--sun-el", type=float, default=None)
ap.add_argument("--sun-az", type=float, default=None, help="compass bearing the sun is AT")
ap.add_argument("--sun-strength", type=float, default=None)
ap.add_argument("--haze-km", type=float, default=75.0)
ap.add_argument("--haze-max", type=float, default=0.8)
ap.add_argument("--pitch", type=float, default=None)
ap.add_argument("--dist", type=float, default=None)
ap.add_argument("--heading", type=float, default=None)
ap.add_argument("--blur-px", type=float, default=10.0)
ap.add_argument("--sky-strength", type=float, default=1.2)
ap.add_argument("--blur-const", type=float, default=-1)
ap.add_argument("--sky-paint", type=float, default=0.9)
ap.add_argument("--hdri", default="data/assets/belfast_sunset_puresky_4k.hdr")
ap.add_argument("--hdri-strength", type=float, default=1.0)
ap.add_argument("--horizon-y", type=float, default=0.93)
ap.add_argument("--n-clouds", type=int, default=0)
ap.add_argument("--raw", action="store_true", help="skip compositor")
ap.add_argument("--no-blur", action="store_true")
ap.add_argument("--tlat", type=float, default=None)
ap.add_argument("--tlon", type=float, default=None)
ap.add_argument("--res-scale", type=float, default=1.0)
A = ap.parse_args(argv)
shot = dict(SHOTS[A.shot])
EXAG = A.exag if A.exag is not None else shot.get("exag", 1.6)
if A.pitch is not None: shot["pitch"] = A.pitch
if A.dist is not None: shot["dist"] = A.dist
if A.tlat is not None: shot["lat"] = A.tlat
if A.tlon is not None: shot["lon"] = A.tlon
if A.heading is not None: shot["heading"] = A.heading
SUN_EL = A.sun_el if A.sun_el is not None else shot.get("sun_el", 15.0)
SUN_AZ = A.sun_az if A.sun_az is not None else shot.get("sun_az", 195.0)
SUN_STR = A.sun_strength if A.sun_strength is not None else shot.get("sun_strength", 11.0)
SUN_COL = shot.get("sun_color", (1.0, 0.77, 0.54))
T0 = time.time()


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


# ------------------------------------------------------------------ geodesy
def utm(lat, lon, zone=43):
    a = 6378137.0; f = 1 / 298.257223563; k0 = 0.9996
    n = f / (2 - f)
    AA = a / (1 + n) * (1 + n * n / 4 + n ** 4 / 64)
    al = [n / 2 - 2 * n * n / 3 + 5 * n ** 3 / 16, 13 * n * n / 48 - 3 * n ** 3 / 5, 61 * n ** 3 / 240]
    phi, lam = np.radians(lat), np.radians(lon) - np.radians(zone * 6 - 183)
    q = 2 * math.sqrt(n) / (1 + n)
    t = np.sinh(np.arctanh(np.sin(phi)) - q * np.arctanh(q * np.sin(phi)))
    xi0 = np.arctan2(t, np.cos(lam)); eta0 = np.arctanh(np.sin(lam) / np.sqrt(1 + t * t))
    xi = xi0 + sum(al[j] * np.sin(2 * (j + 1) * xi0) * np.cosh(2 * (j + 1) * eta0) for j in range(3))
    eta = eta0 + sum(al[j] * np.cos(2 * (j + 1) * xi0) * np.sinh(2 * (j + 1) * eta0) for j in range(3))
    return 500000 + k0 * AA * eta, k0 * AA * xi


# ------------------------------------------------------------------ bundles
class Bundle:
    def __init__(self, path):
        self.path = ROOT / path
        self.meta = json.loads((self.path / "meta.json").read_text())
        m = self.meta
        self.res, self.W, self.H = m["res"], m["width"], m["height"]
        self.x0, self.y1 = m["transform"][2], m["transform"][5]       # west edge, north edge (UTM m)
        self.x1, self.y0 = self.x0 + self.W * self.res, self.y1 - self.H * self.res
        self.h = np.load(self.path / "height.npy")
        self.xs = self.x0 + (np.arange(self.W) + 0.5) * self.res      # pixel centres
        self.ys = self.y1 - (np.arange(self.H) + 0.5) * self.res

    def sample(self, x, y, arr=None):
        """bilinear sample (UTM m) of arr (default DEM)."""
        arr = self.h if arr is None else arr
        c = np.clip((np.asarray(x) - self.x0) / self.res - 0.5, 0, self.W - 1.001)
        r = np.clip((self.y1 - np.asarray(y)) / self.res - 0.5, 0, self.H - 1.001)
        c0, r0 = c.astype(int), r.astype(int)
        fc, fr = c - c0, r - r0
        return (arr[r0, c0] * (1 - fc) * (1 - fr) + arr[r0, c0 + 1] * fc * (1 - fr) +
                arr[r0 + 1, c0] * (1 - fc) * fr + arr[r0 + 1, c0 + 1] * fc * fr)


near = Bundle(A.bundle)
far = Bundle(A.far)
EO, NO = (near.x0 + near.x1) / 2, (near.y0 + near.y1) / 2


def to_world(x, y):  # UTM -> BU
    return (np.asarray(x) - EO) / BU, (np.asarray(y) - NO) / BU


def value_noise(shape, cell, rng):
    """smooth value noise, feature size `cell` pixels."""
    gh, gw = int(shape[0] / cell) + 3, int(shape[1] / cell) + 3
    g = rng.random((gh, gw)).astype(np.float32)
    ry = np.arange(shape[0]) / cell; rx = np.arange(shape[1]) / cell
    y0, x0 = ry.astype(int), rx.astype(int)
    fy, fx = (ry - y0), (rx - x0)
    fy = fy * fy * (3 - 2 * fy); fx = fx * fx * (3 - 2 * fx)
    top = g[y0][:, x0] * (1 - fx) + g[y0][:, x0 + 1] * fx
    bot = g[y0 + 1][:, x0] * (1 - fx) + g[y0 + 1][:, x0 + 1] * fx
    return top * (1 - fy)[:, None] + bot * fy[:, None]


def slope_deg(h, res):
    gy, gx = np.gradient(h, res)
    return np.degrees(np.arctan(np.hypot(gx, gy))).astype(np.float32)


# ------------------------------------------------------------------ terrain heights (near gets crag detail + edge blend into far)
log("heights")
near_slope = slope_deg(near.h, near.res)
far_slope = slope_deg(far.h, far.res)
hn = near.h.copy()
if A.detail > 0:
    rng = np.random.default_rng(7)
    nz = sum(value_noise(hn.shape, c, rng) * a_ for c, a_ in ((24, 1.0), (9, 0.55), (4, 0.3))) / 1.85 - 0.5
    sw = np.clip((near_slope - 22) / 25, 0, 1)
    hn += (nz * 2 * (4 + 16 * sw) * A.detail).astype(np.float32)

# hole rectangle in the far mesh, aligned to far vertex lines, shrunk inside the near extent
RAMP = 1200.0
fx0 = far.x0 + (np.ceil((near.x0 + 150 - far.x0) / far.res)) * far.res
fx1 = far.x0 + (np.floor((near.x1 - 150 - far.x0) / far.res)) * far.res
fy0 = far.y1 - (np.floor((far.y1 - (near.y0 + 150)) / far.res)) * far.res
fy1 = far.y1 - (np.ceil((far.y1 - (near.y1 - 150)) / far.res)) * far.res
gxn, gyn = np.meshgrid(near.xs, near.ys)
din = np.minimum.reduce([gxn - fx0, fx1 - gxn, gyn - fy0, fy1 - gyn])  # >0 inside the hole
hfar_at_near = far.sample(gxn, gyn)
w = np.clip(1 - din / RAMP, 0, 1)
w = w * w * (3 - 2 * w)
hn = hn * (1 - w) + hfar_at_near * w
hn = np.where(din <= 0, hfar_at_near - 20.0, hn).astype(np.float32)   # tucked under the far skirt
del gxn, gyn, din, hfar_at_near, w
near_h_final = hn


def ground(x, y):
    """metres, final (un-exaggerated) ground height at UTM x,y."""
    x, y = np.asarray(x, float), np.asarray(y, float)
    inside = (x > near.x0) & (x < near.x1) & (y > near.y0) & (y < near.y1)
    out = far.sample(x, y)
    if inside.any():
        out = np.where(inside, near.sample(x, y, near_h_final), out)
    return out


# ------------------------------------------------------------------ mesh from grid
def grid_mesh(name, b, z_m, quad_keep=None, attrs=None, sink=0.0):
    H, W = z_m.shape
    n = H * W
    X, Y = to_world(b.xs, b.ys)
    co = np.empty((n, 3), np.float32)
    co[:, 0] = np.tile(X, H); co[:, 1] = np.repeat(Y, W)
    co[:, 2] = ((z_m - sink) * EXAG / BU).ravel()
    r, c = np.mgrid[0:H - 1, 0:W - 1]
    idx = (r * W + c)
    if quad_keep is not None:
        idx = idx[quad_keep]
    idx = idx.ravel()
    quads = np.stack([idx, idx + W, idx + W + 1, idx + 1], 1).astype(np.int32)
    mesh = bpy.data.meshes.new(name)
    mesh.vertices.add(n)
    mesh.vertices.foreach_set("co", co.ravel())
    nq = len(quads)
    mesh.loops.add(nq * 4)
    mesh.polygons.add(nq)
    mesh.loops.foreach_set("vertex_index", quads.ravel())
    mesh.polygons.foreach_set("loop_start", np.arange(nq, dtype=np.int32) * 4)
    mesh.update(calc_edges=True)
    uv = np.empty((n, 2), np.float32)
    uv[:, 0] = np.tile((np.arange(W) + 0.5) / W, H)
    uv[:, 1] = np.repeat(1 - (np.arange(H) + 0.5) / H, W)
    uvl = mesh.uv_layers.new(name="UVMap")
    uvl.data.foreach_set("uv", uv[quads.ravel()].ravel())
    for k, v in (attrs or {}).items():
        at = mesh.attributes.new(k, "FLOAT", "POINT")
        at.data.foreach_set("value", v.astype(np.float32).ravel())
    mesh.shade_smooth()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


# ------------------------------------------------------------------ materials
def N(nt, t, loc=(0, 0), **kw):
    n = nt.nodes.new(t)
    n.location = loc
    for k, v in kw.items():
        setattr(n, k, v)
    return n


def L(nt, a, b):
    nt.links.new(a, b)


def sock(node, name, i=0):
    s = [x for x in node.inputs if x.name == name and x.enabled]
    return s[i] if len(s) > i else node.inputs[name]


def mth(nt, op, a, b=None, c=None, clamp=False):
    n = N(nt, "ShaderNodeMath", operation=op, use_clamp=clamp)
    for i, v in enumerate((a, b, c)):
        if v is None: continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            L(nt, v, n.inputs[i])
    return n.outputs[0]


def maprange(nt, v, a0, a1, b0=0.0, b1=1.0):
    n = N(nt, "ShaderNodeMapRange", clamp=True)
    if isinstance(v, (int, float)): n.inputs[0].default_value = v
    else: L(nt, v, n.inputs[0])
    n.inputs[1].default_value, n.inputs[2].default_value = a0, a1
    n.inputs[3].default_value, n.inputs[4].default_value = b0, b1
    return n.outputs[0]


def mixc(nt, fac, a, b):
    n = N(nt, "ShaderNodeMix", data_type="RGBA")
    if isinstance(fac, (int, float)): n.inputs[0].default_value = fac
    else: L(nt, fac, n.inputs[0])
    for i, v in ((6, a), (7, b)):
        if isinstance(v, tuple): n.inputs[i].default_value = v
        else: L(nt, v, n.inputs[i])
    return n.outputs[2]


def make_terrain_material(name, albedo_path, lc_path):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = N(nt, "ShaderNodeOutputMaterial")
    bsdf = N(nt, "ShaderNodeBsdfPrincipled")
    L(nt, bsdf.outputs[0], out.inputs[0])
    tc = N(nt, "ShaderNodeTexCoord")
    img = bpy.data.images.load(str(albedo_path)); img.colorspace_settings.name = "sRGB"
    alb = N(nt, "ShaderNodeTexImage", image=img, interpolation="Linear", extension="EXTEND")
    L(nt, tc.outputs["UV"], alb.inputs[0])
    # noises (object space, BU)
    n_big = N(nt, "ShaderNodeTexNoise", noise_dimensions="3D"); n_big.inputs["Scale"].default_value = 0.03
    n_big.inputs["Detail"].default_value = 6
    L(nt, tc.outputs["Object"], n_big.inputs["Vector"])
    n_mid = N(nt, "ShaderNodeTexNoise", noise_dimensions="3D"); n_mid.inputs["Scale"].default_value = 0.35
    n_mid.inputs["Detail"].default_value = 5
    L(nt, tc.outputs["Object"], n_mid.inputs["Vector"])
    n_fine = N(nt, "ShaderNodeTexNoise", noise_dimensions="3D"); n_fine.inputs["Scale"].default_value = 2.5
    n_fine.inputs["Detail"].default_value = 4
    L(nt, tc.outputs["Object"], n_fine.inputs["Vector"])
    # landcover lookup with softened (noise-warped) uv
    wv = N(nt, "ShaderNodeVectorMath", operation="SCALE"); wv.inputs["Scale"].default_value = 0.0006
    sub = N(nt, "ShaderNodeVectorMath", operation="SUBTRACT"); sub.inputs[1].default_value = (0.5, 0.5, 0.5)
    L(nt, n_mid.outputs["Color"], sub.inputs[0]); L(nt, sub.outputs[0], wv.inputs[0])
    add = N(nt, "ShaderNodeVectorMath", operation="ADD")
    L(nt, tc.outputs["UV"], add.inputs[0]); L(nt, wv.outputs[0], add.inputs[1])
    limg = bpy.data.images.load(str(lc_path)); limg.colorspace_settings.name = "Non-Color"
    lc = N(nt, "ShaderNodeTexImage", image=limg, interpolation="Closest", extension="EXTEND")
    L(nt, add.outputs[0], lc.inputs[0])
    sep = N(nt, "ShaderNodeSeparateColor"); L(nt, lc.outputs["Color"], sep.inputs[0])
    code = mth(nt, "MULTIPLY", sep.outputs[0], 255.0)

    def cls(c):
        return mth(nt, "COMPARE", code, float(c), 0.5)

    hgt = N(nt, "ShaderNodeAttribute", attribute_name="h", attribute_type="GEOMETRY").outputs["Fac"]
    slp = N(nt, "ShaderNodeAttribute", attribute_name="slope", attribute_type="GEOMETRY").outputs["Fac"]
    nb = n_big.outputs["Fac"]
    nm = n_mid.outputs["Fac"]
    nf = n_fine.outputs["Fac"]
    nbc = mth(nt, "SUBTRACT", nb, 0.5)
    # ---- snow
    s_cls = cls(70)
    alt_f = maprange(nt, mth(nt, "ADD", hgt, mth(nt, "MULTIPLY", nbc, 700.0)), 4250, 4650)
    sl_f = maprange(nt, mth(nt, "ADD", slp, mth(nt, "MULTIPLY", nbc, 22.0)), 40, 30)
    snow = mth(nt, "MAXIMUM", s_cls, mth(nt, "MULTIPLY", alt_f, sl_f))
    snow = mth(nt, "MULTIPLY", snow, maprange(nt, mth(nt, "ADD", slp, mth(nt, "MULTIPLY", nbc, 6.0)), 39, 46, 1.0, 0.0))
    snow = mth(nt, "MULTIPLY", snow, maprange(nt, mth(nt, "ADD", nm, 0.15), 0.25, 0.45, 0.6, 1.0))
    # ---- rock
    rock = maprange(nt, mth(nt, "ADD", slp, mth(nt, "MULTIPLY", mth(nt, "SUBTRACT", nm, 0.5), 14.0)), 36, 46)
    rock = mth(nt, "MAXIMUM", rock, mth(nt, "MULTIPLY", mth(nt, "MAXIMUM", cls(60), cls(100)), 0.8))
    rock = mth(nt, "MULTIPLY", rock, mth(nt, "SUBTRACT", 1.0, snow))
    # ---- masks
    meadow = mth(nt, "MAXIMUM", cls(30), mth(nt, "MULTIPLY", cls(40), 0.6))
    meadow = mth(nt, "MULTIPLY", meadow, mth(nt, "SUBTRACT", 1.0, rock))
    forest = mth(nt, "MULTIPLY", cls(10), mth(nt, "SUBTRACT", 1.0, rock))
    # ---- colours
    hs = N(nt, "ShaderNodeHueSaturation"); hs.inputs["Saturation"].default_value = 1.12; hs.inputs["Value"].default_value = 1.0
    L(nt, alb.outputs["Color"], hs.inputs["Color"])
    base = hs.outputs["Color"]
    forest_col = mixc(nt, 0.35, base, (0.028, 0.065, 0.022, 1))
    meadow_tint = mixc(nt, maprange(nt, nb, 0.35, 0.65), (0.26, 0.19, 0.035, 1), (0.07, 0.15, 0.025, 1))
    meadow_tint = mixc(nt, maprange(nt, nm, 0.4, 0.62, 0.0, 0.7), meadow_tint, (0.15, 0.15, 0.04, 1))
    meadow_col = mixc(nt, 0.62, base, meadow_tint)
    meadow_col = mixc(nt, 0.25, meadow_col, (0.0, 0.0, 0.0, 1))
    wave = N(nt, "ShaderNodeTexWave", wave_type="BANDS", bands_direction="Z", wave_profile="SAW")
    wave.inputs["Scale"].default_value = 0.55; wave.inputs["Distortion"].default_value = 6.0
    wave.inputs["Detail"].default_value = 3
    L(nt, tc.outputs["Object"], wave.inputs["Vector"])
    strata = wave.outputs["Fac"]
    rock_base = mixc(nt, 0.8, base, (0.34, 0.21, 0.08, 1))
    rock_base = mixc(nt, 0.12, rock_base, (0.40, 0.34, 0.27, 1))
    rock_base = mixc(nt, 0.08, rock_base, (0.0, 0.0, 0.0, 1))
    _nr = N(nt, "ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY"); _nr.inputs[0].default_value = 1.0; L(nt, rock_base, _nr.inputs[6]); _nr.inputs[7].default_value = (1.09, 0.95, 0.72, 1)
    rock_base = _nr.outputs[2]
    rock_col = mixc(nt, mth(nt, "MULTIPLY", strata, 0.65), rock_base, (0.06, 0.04, 0.03, 1))
    ao = N(nt, "ShaderNodeAmbientOcclusion"); ao.samples = 6; ao.inputs["Distance"].default_value = 6.0  # 60 m
    ptn = N(nt, "ShaderNodeNewGeometry").outputs["Pointiness"]
    shade = mixc(nt, ao.outputs["AO"], (0.55, 0.55, 0.55, 1), (1.0, 1.0, 1.0, 1))
    mulr = N(nt, "ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY"); mulr.inputs[0].default_value = 1.0
    L(nt, rock_col, mulr.inputs[6]); L(nt, shade, mulr.inputs[7])
    _lift = mixc(nt, maprange(nt, ptn, 0.5, 0.62), (1.0, 1.0, 1.0, 1), (1.1, 1.1, 1.1, 1))
    mulr2 = N(nt, "ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY"); mulr2.inputs[0].default_value = 1.0
    L(nt, mulr.outputs[2], mulr2.inputs[6]); L(nt, _lift, mulr2.inputs[7])
    rock_col = mulr2.outputs[2]
    snow_col = (0.92, 0.94, 0.98, 1)
    col = mixc(nt, forest, base, forest_col)
    col = mixc(nt, meadow, col, meadow_col)
    col = mixc(nt, rock, col, rock_col)
    # fine colour speckle
    col = mixc(nt, mth(nt, "MULTIPLY", mth(nt, "SUBTRACT", nf, 0.5), 0.35), col, (0.02, 0.02, 0.02, 1))
    col = mixc(nt, snow, col, snow_col)
    L(nt, col, bsdf.inputs["Base Color"])
    L(nt, mth(nt, "ADD", mth(nt, "MULTIPLY", snow, -0.5), 0.88), bsdf.inputs["Roughness"])
    bsdf.inputs["Subsurface Weight"].default_value = 0.0
    L(nt, mth(nt, "MULTIPLY", snow, 0.3), bsdf.inputs["Subsurface Weight"])
    bsdf.inputs["Subsurface Radius"].default_value = (1.0, 0.45, 0.25)
    bsdf.inputs["Subsurface Scale"].default_value = 0.1
    # bump
    bh = mth(nt, "ADD", mth(nt, "MULTIPLY", nf, 0.5), mth(nt, "MULTIPLY", mth(nt, "MULTIPLY", strata, rock), 1.6))
    bh = mth(nt, "ADD", bh, mth(nt, "MULTIPLY", nm, 0.8))
    bump = N(nt, "ShaderNodeBump"); bump.inputs["Strength"].default_value = 1.0; bump.inputs["Distance"].default_value = 0.6
    L(nt, bh, bump.inputs["Height"]); L(nt, bump.outputs[0], bsdf.inputs["Normal"])
    return m


# ------------------------------------------------------------------ build terrain
osm = json.loads((near.path / "osm.json").read_text())
carve = np.zeros_like(hn)
for w_ in osm["waterways"]:
    p = np.array([[q[2], q[3]] for q in w_["pts"]], float)
    if len(p) < 2: continue
    k = np.maximum((np.hypot(*np.diff(p, axis=0).T) / 0.5).astype(int), 1)
    pts = np.concatenate([p[i] + (p[i + 1] - p[i]) * np.linspace(0, 1, kk, endpoint=False)[:, None] for i, kk in enumerate(k)])
    cc_ = np.floor(pts[:, 0]).astype(int); rr2 = np.floor(pts[:, 1]).astype(int)
    for dr in range(-2, 3):
        for dc in range(-2, 3):
            wgt = np.clip(1 - np.hypot(dr, dc) * near.res / 75.0, 0, 1)
            wgt = wgt * wgt * (3 - 2 * wgt)
            r2, c2 = rr2 + dr, cc_ + dc
            okk = (r2 >= 0) & (r2 < near.H) & (c2 >= 0) & (c2 < near.W)
            np.maximum.at(carve, (r2[okk], c2[okk]), wgt)
hn -= (carve * 3.0).astype(np.float32)
log("meshes")
mat_near = make_terrain_material("terrain_near", near.path / "albedo.png", near.path / "landcover_hi.png")
mat_far = make_terrain_material("terrain_far", far.path / "albedo.png", far.path / "landcover_hi.png")
obj_near = grid_mesh("terrain_near", near, hn, attrs={"h": near.h, "slope": near_slope})
obj_near.data.materials.append(mat_near)
log("near mesh", len(obj_near.data.vertices), "verts")

# far mesh: drop quads inside the hole
fxc = (far.xs[:-1] + far.xs[1:]) / 2; fyc = (far.ys[:-1] + far.ys[1:]) / 2
gx, gy = np.meshgrid(fxc, fyc)
inhole = (gx > fx0) & (gx < fx1) & (gy > fy0) & (gy < fy1)
obj_far = grid_mesh("terrain_far", far, far.h, quad_keep=~inhole, attrs={"h": far.h, "slope": far_slope}, sink=0.0)
obj_far.data.materials.append(mat_far)
log("far mesh", len(obj_far.data.polygons), "quads")


# ------------------------------------------------------------------ water & roads
def subdivide(p, step):
    out = [p[0]]
    for a, b in zip(p[:-1], p[1:]):
        d = np.hypot(*(b - a))
        k = max(1, int(d / step))
        for i in range(1, k + 1):
            out.append(a + (b - a) * i / k)
    return np.array(out)


def smooth_line(p, win=5):
    if len(p) < 4: return p
    k = np.ones(win) / win
    pad = win // 2
    q = np.pad(p, ((pad, pad), (0, 0)), mode="edge")
    s = np.stack([np.convolve(q[:, i], k, mode="valid") for i in range(2)], 1)
    s[0], s[-1] = p[0], p[-1]
    return s


def px_to_utm(pts):
    a = np.array([[q[2], q[3]] for q in pts], float)
    return np.stack([near.x0 + a[:, 0] * near.res, near.y1 - a[:, 1] * near.res], 1)


def ribbon_mesh(name, lines, widths, lift, mat, taper=0.0):
    V, F, UVs = [], [], []
    off = 0
    for pts, wd in zip(lines, widths):
        if len(pts) < 2: continue
        p = smooth_line(subdivide(smooth_line(pts, 5), 35.0), 5)
        if len(p) < 2: continue
        t = np.gradient(p, axis=0)
        t /= np.maximum(np.hypot(t[:, 0], t[:, 1]), 1e-6)[:, None]
        wv = wd * (1 - taper + taper * np.linspace(0, 1, len(p)))
        perp = np.stack([-t[:, 1], t[:, 0]], 1) * (wv / 2)[:, None]
        lft, rgt = p + perp, p - perp
        zc = np.maximum.reduce([ground(*p.T), ground(*lft.T), ground(*rgt.T)])
        k = np.ones(5) / 5
        zs = np.convolve(np.pad(zc, 2, mode="edge"), k, mode="valid")
        z = (np.maximum(zs, zc - 3) + lift) * EXAG
        n = len(p)
        for pp in (lft, rgt):
            pass
        Lw = np.column_stack([*to_world(lft[:, 0], lft[:, 1]), z / BU])
        Rw = np.column_stack([*to_world(rgt[:, 0], rgt[:, 1]), z / BU])
        V.append(Lw); V.append(Rw)
        vv = np.cumsum(np.r_[0, np.hypot(*np.diff(p, axis=0).T)]) / 60.0
        UVs.append(np.column_stack([np.zeros(n), vv])); UVs.append(np.column_stack([np.ones(n), vv]))
        i = np.arange(n - 1)
        l0, r0 = off + i, off + n + i
        F.append(np.stack([r0, r0 + 1, l0 + 1, l0], 1))
        off += 2 * n
    if not V: return None
    V = np.concatenate(V).astype(np.float32); F = np.concatenate(F).astype(np.int32)
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(V)); me.vertices.foreach_set("co", V.ravel())
    me.loops.add(len(F) * 4); me.polygons.add(len(F))
    me.loops.foreach_set("vertex_index", F.ravel())
    me.polygons.foreach_set("loop_start", np.arange(len(F), dtype=np.int32) * 4)
    me.update(calc_edges=True)
    UV = np.concatenate(UVs).astype(np.float32)
    uvl = me.uv_layers.new(name="UVMap")
    uvl.data.foreach_set("uv", UV[F.ravel()].ravel())
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def simple_mat(name, color, rough, emit=None, emit_strength=0.0, spec=0.5):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Specular IOR Level"].default_value = spec
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = emit_strength
    return m


mat_lake_simple = simple_mat("lake", (0.003, 0.05, 0.06), 0.14, emit=(0.0, 0.44, 0.50), emit_strength=float(os.environ.get("WE", "1.0")), spec=float(os.environ.get("WS", "0.3")))
mat_lake = bpy.data.materials.new("lake"); mat_lake.use_nodes = True
_lt = mat_lake.node_tree; _lt.nodes.clear()
_lo = N(_lt, "ShaderNodeOutputMaterial"); _lb = N(_lt, "ShaderNodeBsdfPrincipled"); L(_lt, _lb.outputs[0], _lo.inputs[0])
_sh = N(_lt, "ShaderNodeAttribute", attribute_name="shore", attribute_type="GEOMETRY").outputs["Fac"]
_depth = maprange(_lt, _sh, 0.0, 0.9)
_lb.inputs["Base Color"].default_value = (0.003, 0.05, 0.06, 1)
L(_lt, mixc(_lt, maprange(_lt, _sh, 0.0, 0.5), (0.10, 0.55, 0.55, 1), (0.01, 0.28, 0.32, 1)), _lb.inputs["Emission Color"])
_lb.inputs["Emission Strength"].default_value = 0.8
_lb.inputs["Roughness"].default_value = 0.08; _lb.inputs["Specular IOR Level"].default_value = 0.25
mat_water = bpy.data.materials.new("river"); mat_water.use_nodes = True
_nt = mat_water.node_tree; _nt.nodes.clear()
_o = N(_nt, "ShaderNodeOutputMaterial"); _b = N(_nt, "ShaderNodeBsdfPrincipled"); L(_nt, _b.outputs[0], _o.inputs[0])
_tc = N(_nt, "ShaderNodeTexCoord"); _sp = N(_nt, "ShaderNodeSeparateXYZ"); L(_nt, _tc.outputs["UV"], _sp.inputs[0])
_edge = mth(_nt, "MULTIPLY", mth(_nt, "ABSOLUTE", mth(_nt, "SUBTRACT", _sp.outputs[0], 0.5)), 2.0)
_nz = N(_nt, "ShaderNodeTexNoise", noise_dimensions="3D"); _nz.inputs["Scale"].default_value = 0.8; _nz.inputs["Detail"].default_value = 4
L(_nt, _tc.outputs["Object"], _nz.inputs["Vector"])
_nz2 = N(_nt, "ShaderNodeTexNoise", noise_dimensions="3D"); _nz2.inputs["Scale"].default_value = 0.35; _nz2.inputs["Detail"].default_value = 3
L(_nt, _tc.outputs["Object"], _nz2.inputs["Vector"])
_foam = mth(_nt, "MULTIPLY", maprange(_nt, mth(_nt, "ADD", _edge, mth(_nt, "MULTIPLY", mth(_nt, "SUBTRACT", _nz.outputs["Fac"], 0.5), 0.3)), 0.86, 1.0),
            maprange(_nt, _nz2.outputs["Fac"], 0.5, 0.62))
_col = mixc(_nt, (0.0 if os.environ.get("NOFOAM") else _foam), (0.02, 0.32, 0.36, 1), (0.85, 0.93, 0.95, 1))
L(_nt, mixc(_nt, _foam, (0.003, 0.05, 0.06, 1), (0.6, 0.65, 0.65, 1)), _b.inputs["Base Color"]); L(_nt, mixc(_nt, _foam, (0.0, 0.46, 0.30, 1), (0.1, 0.1, 0.1, 1)), _b.inputs["Emission Color"])
_b.inputs["Emission Strength"].default_value = float(os.environ.get("WE", "1.0"))
L(_nt, mth(_nt, "ADD", mth(_nt, "MULTIPLY", _foam, 0.5), 0.12), _b.inputs["Roughness"])
_b.inputs["Specular IOR Level"].default_value = 0.2
mat_road = simple_mat("road", (0.49, 0.40, 0.28), 0.95, spec=0.1)
mat_track = simple_mat("track", (0.45, 0.38, 0.28), 0.9, spec=0.05)
LAKES = []
_lj = near.path / "lakes.json"
if _lj.exists():
    for l_ in json.loads(_lj.read_text()):
        q_ = np.array(l_["pts"], float)
        LAKES.append(np.column_stack([near.x0 + q_[:, 0] * near.res, near.y1 - q_[:, 1] * near.res]))
else:
    LAKES = [px_to_utm(lk["pts"]) for lk in osm["water"] if len(lk["pts"]) >= 4]


def inside_any(p, polys):
    m = np.zeros(len(p), bool)
    for poly in polys:
        if (p[:, 0].max() < poly[:, 0].min()) or (p[:, 0].min() > poly[:, 0].max()) or (p[:, 1].max() < poly[:, 1].min()) or (p[:, 1].min() > poly[:, 1].max()): continue
        x, y = p[:, 0], p[:, 1]; x1, y1 = poly[:, 0], poly[:, 1]; x2, y2 = np.roll(x1, -1), np.roll(y1, -1)
        c = np.zeros(len(p), bool)
        for a_, b_, c_, d_ in zip(x1, y1, x2, y2):
            cond = ((b_ > y) != (d_ > y)) & (x < (c_ - a_) * (y - b_) / (d_ - b_ + 1e-12) + a_)
            c ^= cond
        m |= c
    return m


_hd0, _pt0 = math.radians(shot["heading"]), math.radians(shot["pitch"])
_tx0, _ty0 = utm(shot["lat"], shot["lon"])
_cam0 = Vector((*to_world(_tx0, _ty0), float(ground(_tx0, _ty0)) * EXAG / BU)) - Vector((math.sin(_hd0) * math.cos(_pt0), math.cos(_hd0) * math.cos(_pt0), math.sin(_pt0))) * (shot["dist"] / BU)
_RX0 = int((768 if A.preview else 1536) * A.res_scale)
_fpx0 = _RX0 * shot["lens"] / 36.0
riv, riv_w = [], []
for w_ in osm["waterways"]:
    if len(w_["pts"]) < 2: continue
    real = 40.0 if (w_["waterway"] == "river" and w_.get("name")) else (22.0 if w_["waterway"] == "river" else 10.0)
    p0 = px_to_utm(w_["pts"])
    p0 = smooth_line(subdivide(smooth_line(p0, 5), 35.0), 5)
    msk = inside_any(p0, LAKES)
    msk = msk | np.r_[msk[1:], False] | np.r_[False, msk[:-1]]      # a point of margin
    i0 = 0
    while i0 < len(p0):
        if msk[i0]: i0 += 1; continue
        i1 = i0
        while i1 < len(p0) and not msk[i1]: i1 += 1
        if i1 - i0 >= 3:
            run = p0[i0:i1]
            mid = run[len(run) // 2]
            d_ = np.linalg.norm(np.array([*to_world(mid[0], mid[1]), float(ground(mid[0], mid[1])) * EXAG / BU]) - np.array(_cam0)) * BU
            wt = 4.5 * (_RX0 / 2304.0) * d_ / _fpx0 * (2304.0 / _RX0) * (_RX0 / 2304.0)
            riv.append(run); riv_w.append(float(np.clip(wt, real, 2 * real)))
        i0 = i1
ribbon_mesh("rivers", riv, riv_w, 1.5, mat_water, taper=0.3)
road_ok = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "track",
           "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"}
_trk = ("track", "unclassified")
rd = [px_to_utm(r["pts"]) for r in osm["roads"] if r["highway"] in road_ok and r["highway"] not in _trk and len(r["pts"]) > 1]
rt = [px_to_utm(r["pts"]) for r in osm["roads"] if r["highway"] in _trk and len(r["pts"]) > 1]
ribbon_mesh("roads", rd, [22.0] * len(rd), 2.0, mat_road)
ribbon_mesh("tracks", rt, [8.0] * len(rt), 1.5, mat_track)
log("rivers", len(riv), "roads", len(rd))

# lakes
lakeV, lakeF, lakeS, nl = [], [], [], 0
for p in LAKES:
    if len(p) < 4: continue
    hb = ground(p[:, 0], p[:, 1])
    if np.percentile(hb, 90) - np.percentile(hb, 10) > 40: continue
    z = (float(np.percentile(hb, 10)) + 0.8) * EXAG / BU
    wx, wy = to_world(p[:, 0], p[:, 1])
    pts2 = np.column_stack([wx, wy])
    if np.allclose(pts2[0], pts2[-1]): pts2 = pts2[:-1]
    n = len(pts2)
    cen = pts2.mean(0)
    scl = (1.0, 0.82, 0.62, 0.42)
    rings = [cen + k_ * (pts2 - cen) for k_ in scl]
    poly = [Vector((float(a_), float(b_), 0.0)) for a_, b_ in rings[-1]]
    tris = mathutils.geometry.tessellate_polygon([poly])
    base = sum(len(v) for v in lakeV)
    lakeV.append(np.column_stack([np.vstack(rings), np.full(len(scl) * n, z)]))
    lakeS.append(np.repeat(np.array([0.0, 0.3, 0.65, 1.0]), n))
    for k_ in range(len(scl) - 1):
        o0, o1 = base + k_ * n, base + (k_ + 1) * n
        for i in range(n):
            j = (i + 1) % n
            lakeF.append([o0 + i, o0 + j, o1 + j]); lakeF.append([o0 + i, o1 + j, o1 + i])
    o3 = base + (len(scl) - 1) * n
    lakeF.extend([[o3 + t[0], o3 + t[1], o3 + t[2]] for t in tris])
    nl += 1
if lakeV:
    V = np.concatenate(lakeV).astype(np.float32); F = np.array(lakeF, np.int32)
    me = bpy.data.meshes.new("lakes")
    me.vertices.add(len(V)); me.vertices.foreach_set("co", V.ravel())
    me.loops.add(len(F) * 3); me.polygons.add(len(F))
    me.loops.foreach_set("vertex_index", F.ravel())
    me.polygons.foreach_set("loop_start", np.arange(len(F), dtype=np.int32) * 3)
    me.update(calc_edges=True)
    _at = me.attributes.new("shore", "FLOAT", "POINT"); _at.data.foreach_set("value", np.concatenate(lakeS).astype(np.float32))
    me.materials.append(mat_lake)
    ob = bpy.data.objects.new("lakes", me)
    bpy.context.scene.collection.objects.link(ob)
    # make sure the lake normals face up
    import bmesh
    bm = bmesh.new(); bm.from_mesh(me)
    for f in bm.faces:
        if f.normal.z < 0: f.normal_flip()
    bm.to_mesh(me); bm.free()
log("lakes", nl)

# ------------------------------------------------------------------ buildings + trucks
gaz = json.loads((ROOT / "data" / "research" / "swat_gazetteer.json").read_text(encoding="utf-8"))
gaz = [g_ for g_ in gaz if g_.get("coord_confidence") != "low"]


class Acc:
    def __init__(s): s.V, s.F, s.C, s.n = [], [], [], 0
    def add(s, verts, faces, col):
        verts = np.asarray(verts, float); s.V.append(verts); s.F += [[s.n + i for i in f] for f in faces]
        s.C += [col] * len(verts); s.n += len(verts)


def corners(c, u, Lh, Wh):
    w = np.array([-u[1], u[0]])
    return np.array([c - u * Lh - w * Wh, c + u * Lh - w * Wh, c + u * Lh + w * Wh, c - u * Lh + w * Wh])


def wxyz(xy, z):
    return np.column_stack([*to_world(xy[:, 0], xy[:, 1]), np.full(len(xy), z / BU)])


def add_box(acc, c, u, Lh, Wh, z0, h, col):
    cr = corners(c, u, Lh, Wh)
    acc.add(np.vstack([wxyz(cr, z0), wxyz(cr, z0 + h)]), [[i, (i + 1) % 4, 4 + (i + 1) % 4, 4 + i] for i in range(4)] + [[4, 5, 6, 7]], col)


def make_poly(name, acc, rough):
    V = np.concatenate(acc.V).astype(np.float32)
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(V)); me.vertices.foreach_set("co", V.ravel())
    lens = np.array([len(f) for f in acc.F]); me.loops.add(int(lens.sum())); me.polygons.add(len(acc.F))
    me.loops.foreach_set("vertex_index", np.concatenate(acc.F).astype(np.int32))
    me.polygons.foreach_set("loop_start", np.r_[0, np.cumsum(lens)[:-1]].astype(np.int32))
    me.update(calc_edges=True)
    at = me.attributes.new("col", "FLOAT_COLOR", "POINT")
    at.data.foreach_set("color", np.column_stack([np.array(acc.C), np.ones(len(acc.C))]).astype(np.float32).ravel())
    m_ = bpy.data.materials.new(name); m_.use_nodes = True
    bs = m_.node_tree.nodes["Principled BSDF"]
    an = m_.node_tree.nodes.new("ShaderNodeAttribute"); an.attribute_name = "col"; an.attribute_type = "GEOMETRY"
    m_.node_tree.links.new(an.outputs["Color"], bs.inputs["Base Color"]); bs.inputs["Roughness"].default_value = rough
    me.materials.append(m_)
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)


n_bld = 0
if not A.no_buildings:
    rng = np.random.default_rng(3)
    wallc = [(0.40, 0.31, 0.22), (0.36, 0.32, 0.27), (0.46, 0.38, 0.28), (0.30, 0.26, 0.22), (0.52, 0.48, 0.40)]
    roofc = [(0.50, 0.12, 0.06), (0.06, 0.36, 0.30), (0.42, 0.43, 0.45), (0.30, 0.17, 0.08), (0.60, 0.20, 0.08)]
    wacc, racc = Acc(), Acc()
    specs = []
    bp = near.path / "buildings.json"
    if bp.exists():
        for b_ in json.loads(bp.read_text()):
            p = np.array(b_["pts"], float)
            if np.allclose(p[0], p[-1]): p = p[:-1]
            if len(p) < 3: continue
            c = p.mean(0); q = p - c
            ev, evec = np.linalg.eigh(q.T @ q + np.eye(2) * 1e-6)
            u, v = q @ evec[:, 1], q @ evec[:, 0]
            specs.append((c, evec[:, 1], min(max(np.ptp(u), 6.0) * 5, 110.0) / 2, min(max(np.ptp(v), 5.0) * 5, 70.0) / 2))
    n_osm = len(specs)
    # procedural houses in built-up / crop pixels near towns and villages
    lc_hi = np.load(near.path / "landcover_hi.npy")
    towns = np.array([utm(g_["lat"], g_["lon"]) for g_ in gaz if g_.get("kind") in ("town", "village")])
    rr0, cc0 = np.nonzero((lc_hi == 50) | (lc_hi == 40))
    px_ = near.x0 + (cc0 + 0.5) * near.res / 2; py_ = near.y1 - (rr0 + 0.5) * near.res / 2
    dmin = np.min(np.hypot(px_[:, None] - towns[:, 0][None], py_[:, None] - towns[:, 1][None]), 1) if len(towns) else np.full(len(px_), 1e9)
    sel = (dmin < 3000) & (rng.random(len(px_)) < 0.25)
    gyh, gxh = np.gradient(hn, near.res)
    for x, y in zip(px_[sel] + rng.uniform(-6, 6, sel.sum()), py_[sel] + rng.uniform(-6, 6, sel.sum())):
        cc_, rr_ = int((x - near.x0) / near.res), int((near.y1 - y) / near.res)
        gx_, gy_ = gxh[rr_, cc_], -gyh[rr_, cc_]
        n_ = math.hypot(gx_, gy_)
        u = np.array([-gy_, gx_]) / n_ if n_ > 0.05 else np.array([math.cos(rng.uniform(0, 3.14)), math.sin(rng.uniform(0, 3.14))])
        if rng.random() < 0.3: u = np.array([math.cos(rng.uniform(0, 3.14)), math.sin(rng.uniform(0, 3.14))])
        specs.append((np.array([x, y]), u, rng.uniform(8, 14) * 3 / 2, rng.uniform(6, 9) * 3 / 2))
    for c, u, Lh, Wh in specs[:12000]:
        cr = corners(c, u, Lh, Wh)
        z0 = float(ground(cr[:, 0], cr[:, 1]).min()) * EXAG - 2.0
        wh = 12.0 + 6.0 * rng.random(); gable = rng.random() < 0.65
        wc = wallc[rng.integers(len(wallc))]; rc = roofc[rng.integers(len(roofc))]
        wxy = wxyz(cr, z0)
        acc_w = wacc
        wacc.add(np.vstack([wxyz(cr, z0), wxyz(cr, z0 + wh)]), [[i, (i + 1) % 4, 4 + (i + 1) % 4, 4 + i] for i in range(4)], wc)
        if gable:
            m0, m1 = c - Lh * u, c + Lh * u
            rz = (z0 + wh + 0.55 * Wh) / BU
            r0 = np.array([*to_world(m0[0], m0[1]), rz]); r1 = np.array([*to_world(m1[0], m1[1]), rz])
            racc.add(np.vstack([wxyz(cr, z0 + wh), r0, r1]), [[0, 1, 5, 4], [4, 5, 2, 3], [1, 2, 5], [3, 0, 4]], rc)
        else:
            racc.add(wxyz(cr, z0 + wh + 1.0), [[0, 1, 2, 3]], rc)
        n_bld += 1
    make_poly("bld_walls", wacc, 0.9); make_poly("bld_roofs", racc, 0.7)
    log("buildings", n_bld, "(osm", n_osm, ")")
    # hero-scale painted trucks on the roads around Kalam
    kx, ky = utm(35.486, 72.585)
    tacc = Acc()
    cand = []
    for r_ in osm["roads"]:
        if r_["highway"] in ("primary", "secondary", "tertiary", "unclassified", "trunk") and len(r_["pts"]) > 1:
            p = px_to_utm(r_["pts"])
            for i in range(len(p) - 1):
                if math.hypot(p[i][0] - kx, p[i][1] - ky) < 3500: cand.append((p[i], p[i + 1] - p[i]))
    tcols = [(0.9, 0.15, 0.1), (0.1, 0.45, 0.85), (0.95, 0.75, 0.1), (0.1, 0.6, 0.35), (0.9, 0.4, 0.1), (0.8, 0.1, 0.5)]
    nt_ = 0
    if cand:
        for i in rng.choice(len(cand), min(6, len(cand)), replace=False):
            p0, d = cand[i]
            u = d / max(np.hypot(*d), 1e-6)
            c = p0 + d * rng.random()
            z0 = float(ground(c[0], c[1])) * EXAG + 3.0
            col = tcols[nt_ % len(tcols)]
            add_box(tacc, c - u * 6.0, u, 17.0, 8.0, z0 + 3.0, 16.0, col)
            add_box(tacc, c + u * 19.0, u, 7.0, 8.0, z0 + 3.0, 12.0, tuple(0.6 * x_ + 0.15 for x_ in col))
            nt_ += 1
    if nt_: make_poly("trucks", tacc, 0.5)
    log("trucks", nt_)

# ------------------------------------------------------------------ camera
scene = bpy.context.scene
tx, ty = utm(shot["lat"], shot["lon"])
tz = float(ground(tx, ty)) * EXAG
hd, pt = math.radians(shot["heading"]), math.radians(shot["pitch"])
dirv = Vector((math.sin(hd) * math.cos(pt), math.cos(hd) * math.cos(pt), math.sin(pt)))
tgt = Vector((*to_world(tx, ty), tz / BU))
cam_loc = tgt - dirv * (shot["dist"] / BU)
cam_data = bpy.data.cameras.new("cam")
cam_data.lens = shot["lens"]; cam_data.shift_y = shot.get("shift_y", 0.0); cam_data.sensor_width = 36; cam_data.sensor_fit = "HORIZONTAL"
cam_data.clip_start = 5.0; cam_data.clip_end = 30000.0
cam = bpy.data.objects.new("cam", cam_data)
cam.location = cam_loc
cam.rotation_euler = dirv.to_track_quat("-Z", "Y").to_euler()
scene.collection.objects.link(cam)
scene.camera = cam
fx, fyy = utm(*shot["focus"])
fpt = Vector((*to_world(fx, fyy), float(ground(fx, fyy)) * EXAG / BU))
cam_data.dof.use_dof = True
cam_data.dof.focus_distance = (fpt - cam_loc).length
cam_data.dof.aperture_fstop = shot["fstop"]
RX, RY = (768, 512) if A.preview else (1536, 1024)
RX, RY = int(RX * A.res_scale), int(RY * A.res_scale)
scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = RX, RY, 100
bpy.context.view_layer.update()
from bpy_extras.object_utils import world_to_camera_view


def project(lat, lon, zextra=0.0):
    x, y = utm(lat, lon)
    p = Vector((*to_world(x, y), (float(ground(x, y)) * EXAG + zextra * EXAG) / BU))
    v = world_to_camera_view(scene, cam, p)
    return p, v


for nm, (la, lo) in {"Kalam": (35.486, 72.585), "Mahodand": (35.708, 72.654), "Falak Sar": (35.679, 72.780)}.items():
    _, v = project(la, lo)
    log(f"frame check {nm}: x={v.x:.2f} y={v.y:.2f} depth={v.z * BU / 1000:.1f}km")

def make_instancer(name, P_, sc_, coll, nvar):
    pm = bpy.data.meshes.new(name + "pts")
    pm.vertices.add(len(P_))
    pm.vertices.foreach_set("co", np.asarray(P_, np.float32).ravel())
    at = pm.attributes.new("tscale", "FLOAT", "POINT")
    at.data.foreach_set("value", np.asarray(sc_, np.float32))
    pobj = bpy.data.objects.new(name, pm)
    scene.collection.objects.link(pobj)
    ng = bpy.data.node_groups.new(name + "Inst", "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    gi = ng.nodes.new("NodeGroupInput"); go = ng.nodes.new("NodeGroupOutput")
    iop = ng.nodes.new("GeometryNodeInstanceOnPoints")
    ci = ng.nodes.new("GeometryNodeCollectionInfo")
    ci.inputs["Collection"].default_value = coll
    ci.inputs["Separate Children"].default_value = True
    ci.inputs["Reset Children"].default_value = True
    ri = ng.nodes.new("FunctionNodeRandomValue"); ri.data_type = "INT"
    rr_ = ng.nodes.new("FunctionNodeRandomValue"); rr_.data_type = "FLOAT_VECTOR"
    na = ng.nodes.new("GeometryNodeInputNamedAttribute"); na.data_type = "FLOAT"
    na.inputs["Name"].default_value = "tscale"
    cx = ng.nodes.new("ShaderNodeCombineXYZ")
    ri.inputs["Min"].default_value = 0; ri.inputs["Max"].default_value = nvar - 1
    rr_.inputs["Min"].default_value = (0, 0, 0); rr_.inputs["Max"].default_value = (0, 0, 6.2832)
    L(ng, na.outputs[0], cx.inputs[0]); L(ng, na.outputs[0], cx.inputs[1]); L(ng, na.outputs[0], cx.inputs[2])
    iop.inputs["Pick Instance"].default_value = True
    L(ng, gi.outputs[0], iop.inputs["Points"])
    L(ng, ci.outputs["Instances"], iop.inputs["Instance"])
    L(ng, [o for o in ri.outputs if o.enabled][0], iop.inputs["Instance Index"])
    L(ng, [o for o in rr_.outputs if o.enabled][0], iop.inputs["Rotation"])
    L(ng, cx.outputs[0], iop.inputs["Scale"])
    L(ng, iop.outputs["Instances"], go.inputs[0])
    md = pobj.modifiers.new(name, "NODES"); md.node_group = ng
    bpy.context.view_layer.layer_collection.children[coll.name].exclude = True
    return pobj


def frustum(P_, margin=1.12):
    m = np.array(cam.matrix_world.inverted())
    pc = P_ @ m[:3, :3].T + m[:3, 3]
    depth = -pc[:, 2]
    ok = depth > 5
    sx = np.where(ok, pc[:, 0] / np.maximum(depth, 1e-3) / (36 / 2 / shot["lens"]), 9)
    sy = np.where(ok, pc[:, 1] / np.maximum(depth, 1e-3) / (36 / 2 / shot["lens"] * RY / RX) - 3 * shot.get("shift_y", 0.0), 9)
    return ok & (np.abs(sx) < margin) & (np.abs(sy) < margin + 0.03)


# lake screen extent near the target (px at this render size; scale by 2304/RX for the final)
for _lp in LAKES:
    if np.hypot(*(_lp.mean(0) - np.array([tx, ty]))) < 1500:
        _pp = np.array([[world_to_camera_view(scene, cam, Vector((*to_world(q[0], q[1]), float(ground(q[0], q[1])) * EXAG / BU + 0.1))).xy[k] * (RX, RY)[k] for k in (0, 1)] for q in _lp[::4]])
        _a = np.array(_pp); _d = np.hypot(*(_a[:, None] - _a[None]).transpose(2, 0, 1)).max()
        _ar = 0.5 * abs(np.sum(_lp[:, 0] * np.roll(_lp[:, 1], -1) - np.roll(_lp[:, 0], -1) * _lp[:, 1])) / 1e6
        log(f"lake near target: area {_ar:.3f} km2, screen length {_d:.0f}px at {RX}px wide")

# ------------------------------------------------------------------ trees
n_trees = 0
if not A.no_trees and (near.path / "trees.npy").exists():
    log("trees")
    t = np.load(near.path / "trees.npy")
    ex, ey = near.x0 + t[:, 0].astype(np.float64), near.y0 + t[:, 1].astype(np.float64)
    wx, wy = to_world(ex, ey)
    z = ground(ex, ey) * EXAG / BU
    P = np.column_stack([wx, wy, z])
    m = np.array(cam.matrix_world.inverted())
    pc = P @ m[:3, :3].T + m[:3, 3]
    depth = -pc[:, 2]
    ok = depth > 5
    sx = np.where(ok, pc[:, 0] / np.maximum(depth, 1e-3) / (36 / 2 / shot["lens"]), 9)
    sy = np.where(ok, pc[:, 1] / np.maximum(depth, 1e-3) / (36 / 2 / shot["lens"] * RY / RX) - 3 * shot.get("shift_y", 0.0), 9)
    inside = ok & (np.abs(sx) < 1.12) & (np.abs(sy) < 1.15)
    d_km = np.sqrt(((P - np.array(cam_loc)) ** 2).sum(1)) * BU / 1000
    dens = np.where(d_km < 20, 1.0, np.clip((42 - d_km) / 22, 0, 1) ** 1.3)
    rng = np.random.default_rng(99)
    budget = A.tree_max
    keep = inside & (rng.random(len(t)) < dens)
    if keep.sum() > budget:
        keep &= rng.random(len(t)) < budget / keep.sum() * 1.02
    idx = np.nonzero(keep)[0]
    sc_ = t[idx, 2] * np.minimum(1 / np.sqrt(np.maximum(dens[idx], 0.05)), 1.8) * 3.0 * A.tree_scale * (1 + 0.6 * np.clip((d_km[idx] - 8) / 27, 0, 1))
    n_trees = len(idx)
    log("trees kept", n_trees, "of", len(t))

    # ---- tree templates
    def conifer(seed, nc, rad, droop):
        r_ = np.random.default_rng(seed)
        V, F = [], []
        def add(vs, fs):
            o = sum(len(v) for v in V)
            V.append(np.array(vs)); F.extend([[o + i for i in f] for f in fs])
        seg = 7
        # trunk
        ang = np.linspace(0, 2 * np.pi, seg, endpoint=False)
        tv = [(0.012 * np.cos(a), 0.012 * np.sin(a), 0.0) for a in ang] + [(0.01 * np.cos(a), 0.01 * np.sin(a), 0.2) for a in ang]
        add(tv, [[i, (i + 1) % seg, seg + (i + 1) % seg, seg + i] for i in range(seg)])
        for k in range(nc):
            u = k / (nc - 1)
            z0 = 0.10 + 0.78 * u
            rr = rad * (1 - u) ** 0.85 + 0.02
            hh = 0.26 * (1.0 - 0.45 * u)
            jit = 1 + 0.12 * r_.standard_normal()
            vs = [(0, 0, z0 + hh)]
            for a in ang + 0.4 * k:
                vs.append((rr * jit * np.cos(a), rr * jit * np.sin(a), z0 - droop * rr))
            vs.append((0, 0, z0 - 0.02))
            fs = [[0, 1 + i, 1 + (i + 1) % seg] for i in range(seg)]
            fs += [[1 + seg, 1 + (i + 1) % seg, 1 + i] for i in range(seg)]
            add(vs, fs)
        V = np.concatenate(V)
        me = bpy.data.meshes.new(f"conifer{seed}")
        me.from_pydata([tuple(v) for v in V], [], [tuple(f) for f in F])
        me.shade_smooth()
        return me

    mat_tree = bpy.data.materials.new("tree"); mat_tree.use_nodes = True
    ntr = mat_tree.node_tree; ntr.nodes.clear()
    oo = N(ntr, "ShaderNodeOutputMaterial"); bb = N(ntr, "ShaderNodeBsdfPrincipled"); L(ntr, bb.outputs[0], oo.inputs[0])
    oi = N(ntr, "ShaderNodeObjectInfo")
    ramp = N(ntr, "ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0; ramp.color_ramp.elements[0].color = (0.008, 0.030, 0.028, 1)
    ramp.color_ramp.elements[1].position = 1.0; ramp.color_ramp.elements[1].color = (0.045, 0.085, 0.040, 1)
    e = ramp.color_ramp.elements.new(0.5); e.color = (0.016, 0.050, 0.040, 1)
    L(ntr, oi.outputs["Random"], ramp.inputs[0])
    _tco = N(ntr, "ShaderNodeTexCoord"); _sz = N(ntr, "ShaderNodeSeparateXYZ"); L(ntr, _tco.outputs["Object"], _sz.inputs[0])
    _top = maprange(ntr, _sz.outputs[2], 0.45, 1.0)
    L(ntr, mixc(ntr, mth(ntr, "MULTIPLY", _top, 0.55), ramp.outputs[0], (0.14, 0.20, 0.035, 1)), bb.inputs["Base Color"])
    bb.inputs["Roughness"].default_value = 0.75
    bb.inputs["Specular IOR Level"].default_value = 0.2
    tcoll = bpy.data.collections.new("TreeTemplates")
    scene.collection.children.link(tcoll)
    for i, (nc, rad, dr) in enumerate(((6, 0.15, 0.55), (7, 0.12, 0.8), (5, 0.17, 0.4))):
        me = conifer(i, nc, rad, dr)
        me.materials.append(mat_tree)
        ob = bpy.data.objects.new(f"conifer{i}", me)
        tcoll.objects.link(ob)
    tree_obj = make_instancer("trees", P[idx], sc_, tcoll, 3)

# ------------------------------------------------------------------ shrubs / rocks near the camera
shrub_obj = None
if not A.no_shrubs:
    lc_hi = np.load(near.path / "landcover_hi.npy")
    _hh = np.asarray(__import__("PIL.Image", fromlist=["x"]).fromarray(near.h).resize((lc_hi.shape[1], lc_hi.shape[0]))) if False else np.kron(near.h, np.ones((2, 2), np.float32))
    rr0, cc0 = np.nonzero(((lc_hi == 30) | (lc_hi == 20) | (lc_hi == 60)) & (_hh < 3900))
    rng = np.random.default_rng(21)
    sel = rng.random(len(rr0)) < 0.35
    rr0, cc0 = rr0[sel], cc0[sel]
    ex = near.x0 + (cc0 + rng.random(len(cc0))) * near.res / 2
    ey = near.y1 - (rr0 + rng.random(len(cc0))) * near.res / 2
    P = np.column_stack([*to_world(ex, ey), ground(ex, ey) * EXAG / BU])
    d_km = np.sqrt(((P - np.array(cam_loc)) ** 2).sum(1)) * BU / 1000
    keep = frustum(P) & (d_km < 18) & (rng.random(len(P)) < np.clip((18 - d_km) / 10, 0, 1))
    _ex, _ey = ex[keep], ey[keep]
    _sd = np.array([math.sin(math.radians(SUN_AZ)), math.cos(math.radians(SUN_AZ))]); _tn = math.tan(math.radians(SUN_EL))
    _z0 = ground(_ex, _ey) * EXAG + 5.0
    _sh = np.zeros(len(_ex), bool)
    for _t in np.linspace(60, 5000, 40):
        _sh |= ground(_ex + _sd[0] * _t, _ey + _sd[1] * _t) * EXAG > _z0 + _t * _tn
    _gx, _gy = np.gradient(near.h, near.res)
    keep2 = (~_sh) | (rng.random(len(_ex)) < 0.08)
    P = P[keep][keep2]
    if len(P) > 250000: P = P[rng.choice(len(P), 250000, replace=False)]
    if len(P):
        scs = 0.6 * rng.uniform(0.25, 0.7, len(P)) * (1 + 0.5 * np.clip(np.sqrt(((P - np.array(cam_loc)) ** 2).sum(1)) * BU / 12000, 0, 1))
        scoll = bpy.data.collections.new("ShrubTemplates"); scene.collection.children.link(scoll)
        ms = simple_mat("shrub", (0.035, 0.065, 0.025), 0.9)
        mr_ = simple_mat("rockbit", (0.12, 0.10, 0.08), 0.85)
        import bmesh
        for i, (mt, sq) in enumerate(((ms, 0.7), (ms, 0.55), (mr_, 0.6))):
            bm_ = bpy.data.meshes.new(f"shrub{i}")
            bmx = bmesh.new(); bmesh.ops.create_icosphere(bmx, subdivisions=1, radius=1.0)
            for vtx in bmx.verts: vtx.co.z = max(vtx.co.z * sq, -0.1)
            bmx.to_mesh(bm_); bmx.free()
            bm_.materials.append(mt)
            scoll.objects.link(bpy.data.objects.new(f"shrub{i}", bm_))
        shrub_obj = make_instancer("shrubs", P, scs, scoll, 3)
    log("shrubs", len(P))

# ------------------------------------------------------------------ clouds (cumulus billows)
n_clouds = 0
if not A.no_clouds and shot.get("clouds", True):
    def cloud_mat(base_bu):
        mc = bpy.data.materials.new("cloud"); mc.use_nodes = True
        ntc = mc.node_tree; ntc.nodes.clear()
        o_ = N(ntc, "ShaderNodeOutputMaterial"); pv = N(ntc, "ShaderNodeVolumePrincipled")
        L(ntc, pv.outputs[0], o_.inputs["Volume"])
        tcn = N(ntc, "ShaderNodeTexCoord"); geo = N(ntc, "ShaderNodeNewGeometry")
        nz_ = N(ntc, "ShaderNodeTexNoise", noise_dimensions="3D"); nz_.inputs["Scale"].default_value = 0.025; nz_.inputs["Detail"].default_value = 6
        nz_.inputs["Roughness"].default_value = 0.6
        L(ntc, geo.outputs["Position"], nz_.inputs["Vector"])
        ln = N(ntc, "ShaderNodeVectorMath", operation="LENGTH"); L(ntc, tcn.outputs["Object"], ln.inputs[0])
        edge = mth(ntc, "SUBTRACT", 1.0, maprange(ntc, ln.outputs["Value"], 0.3, 1.0))
        zz = N(ntc, "ShaderNodeSeparateXYZ"); L(ntc, geo.outputs["Position"], zz.inputs[0])
        flat = maprange(ntc, zz.outputs[2], base_bu, base_bu + 10.0)
        d_ = mth(ntc, "MULTIPLY", maprange(ntc, mth(ntc, "ADD", nz_.outputs["Fac"], mth(ntc, "MULTIPLY", edge, 0.5)), 0.5, 0.85), mth(ntc, "MULTIPLY", edge, flat))
        L(ntc, mth(ntc, "MULTIPLY", d_, float(os.environ.get("CD", "0.16"))), pv.inputs["Density"])
        pv.inputs["Color"].default_value = (1.0, 0.97, 0.93, 1)
        pv.inputs["Anisotropy"].default_value = 0.5
        return mc

    rng = np.random.default_rng(11)
    fpx = RX * shot["lens"] / 36.0
    anchors = []
    for g_ in gaz:
        _, v_ = project(g_["lat"], g_["lon"])
        if 0 <= v_.x <= 1 and 0 <= v_.y <= 1 and v_.z > 0: anchors.append((v_.x * RX, (1 - v_.y) * RY))
    for p_ in osm["peaks"]:
        if p_.get("name") and p_.get("ele"):
            _, v_ = project(p_["pt"][1], p_["pt"][0])
            if 0 <= v_.x <= 1 and 0 <= v_.y <= 1 and v_.z > 0: anchors.append((v_.x * RX, (1 - v_.y) * RY))
    anchors = np.array(anchors) if anchors else np.zeros((0, 2))
    cx_ = rng.uniform(near.x0 + 3000, near.x1 - 3000, 20000); cy_ = rng.uniform(near.y0 + 3000, near.y1 - 3000, 20000)
    gz = ground(cx_, cy_)
    placed = []
    from mathutils.bvhtree import BVHTree
    _bv = BVHTree.FromObject(obj_near, bpy.context.evaluated_depsgraph_get())
    for x, y, g_ in zip(cx_, cy_, gz):
        if n_clouds >= A.n_clouds: break
        if not (2600 < g_ < 4400): continue
        cz = float(np.clip(g_ + 250, 3800, 4500))
        Pc = np.array([[*to_world(x, y), cz * EXAG / BU]])
        if not frustum(Pc, 0.95)[0]: continue
        dm = np.linalg.norm(Pc[0] - np.array(cam_loc)) * BU
        if dm < 8000 or dm > 38000: continue
        v_ = world_to_camera_view(scene, cam, Vector(Pc[0]))
        sp_ = np.array([v_.x * RX, (1 - v_.y) * RY])
        need = 4000.0 * fpx / dm
        if len(anchors) and np.min(np.hypot(*(anchors - sp_).T)) < need: continue
        if any(np.hypot(*(q_ - sp_)) < need * 0.8 for q_ in placed): continue
        _dv = Vector(Pc[0]) - cam_loc
        _h = _bv.ray_cast(cam_loc, _dv.normalized(), _dv.length * 1.0)
        if _h[0] is not None and _h[3] < _dv.length * 0.985: continue
        placed.append(sp_)
        mc = cloud_mat(cz * EXAG / BU - 1.0)
        for k in range(rng.integers(6, 12)):
            hz = rng.random() ** 1.3 * 600.0
            r = rng.uniform(200, 460) * (1 - 0.35 * hz / 600.0) * float(np.clip(dm / 14000.0, 1.0, 2.6))
            off = rng.normal(0, 380, 2)
            wx_, wy_ = to_world(x + off[0] * float(np.clip(dm / 14000.0, 1.0, 2.6)), y + off[1] * float(np.clip(dm / 14000.0, 1.0, 2.6)))
            bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, segments=16, ring_count=10, location=(wx_, wy_, (cz + hz) * EXAG / BU))
            o = bpy.context.active_object; o.scale = (r / BU, r / BU, r / BU * 0.9)
            o.data.materials.append(mc)
        n_clouds += 1
    log("clouds", n_clouds, [tuple(int(v) for v in q_) for q_ in placed])

# ------------------------------------------------------------------ world + sun
world = bpy.data.worlds.new("sky"); scene.world = world; world.use_nodes = True
wn = world.node_tree; wn.nodes.clear()
wo = N(wn, "ShaderNodeOutputWorld"); bg = N(wn, "ShaderNodeBackground")
sky = N(wn, "ShaderNodeTexSky", sky_type="MULTIPLE_SCATTERING")
sky.sun_elevation = math.radians(SUN_EL)
sky.sun_rotation = math.radians(SUN_AZ)
sky.sun_disc = False
sky.altitude = 3500.0
sky.air_density = 1.0; sky.aerosol_density = 1.4; sky.ozone_density = 1.0
L(wn, sky.outputs[0], bg.inputs["Color"])
_lpg = N(wn, "ShaderNodeLightPath")
L(wn, mth(wn, "SUBTRACT", A.sky_strength, mth(wn, "MULTIPLY", _lpg.outputs["Is Glossy Ray"], A.sky_strength * 0.7)), bg.inputs["Strength"])
env = N(wn, "ShaderNodeTexEnvironment")
himg = bpy.data.images.load(str(ROOT / A.hdri)); env.image = himg
# find the HDRI sun azimuth so its glow sits on the lamp side
_px = np.empty(himg.size[0] * himg.size[1] * 4, np.float32); himg.pixels.foreach_get(_px)
_lum = _px.reshape(himg.size[1], himg.size[0], 4)[..., :3].mean(2)
_lum = _lum[:_lum.shape[0] // 8 * 8, :_lum.shape[1] // 8 * 8].reshape(_lum.shape[0] // 8, 8, _lum.shape[1] // 8, 8).mean((1, 3))
_r, _c = np.unravel_index(np.argmax(_lum), _lum.shape)
_u = (_c + 0.5) / _lum.shape[1]
_phi = (_u - 0.5) * 2 * math.pi
_d0 = math.atan2(math.sin(_phi), -math.cos(_phi))                       # HDRI sun direction angle (x east, y north)
_d1 = math.atan2(math.cos(math.radians(SUN_AZ)), math.sin(math.radians(SUN_AZ)))
mp = N(wn, "ShaderNodeMapping"); mp.inputs["Rotation"].default_value = (0, 0, _d0 - _d1)
tcw = N(wn, "ShaderNodeTexCoord"); L(wn, tcw.outputs["Generated"], mp.inputs["Vector"]); L(wn, mp.outputs[0], env.inputs["Vector"])
bg2 = N(wn, "ShaderNodeBackground"); bg2.inputs["Strength"].default_value = A.hdri_strength
L(wn, env.outputs["Color"], bg2.inputs["Color"])
lp = N(wn, "ShaderNodeLightPath"); mx = N(wn, "ShaderNodeMixShader")
L(wn, lp.outputs["Is Camera Ray"], mx.inputs[0]); L(wn, bg.outputs[0], mx.inputs[1]); L(wn, bg2.outputs[0], mx.inputs[2])
L(wn, mx.outputs[0], wo.inputs[0])
log("hdri sun az offset", math.degrees(_d0 - _d1))
sun_dir = Vector((math.sin(math.radians(SUN_AZ)) * math.cos(math.radians(SUN_EL)),
                  math.cos(math.radians(SUN_AZ)) * math.cos(math.radians(SUN_EL)), math.sin(math.radians(SUN_EL))))
sd = bpy.data.lights.new("sun", "SUN")
sd.energy = SUN_STR; sd.color = SUN_COL; sd.angle = math.radians(0.9)
so = bpy.data.objects.new("sun", sd)
so.rotation_euler = (-sun_dir).to_track_quat("-Z", "Y").to_euler()
so.location = tgt + sun_dir * 1000
scene.collection.objects.link(so)
log("sky sun_direction readback", tuple(sky.sun_direction), "expected", tuple(sun_dir))

# ------------------------------------------------------------------ render settings
sc = scene
sc.render.engine = "CYCLES"
cy = sc.cycles
prefs = bpy.context.preferences.addons["cycles"].preferences
try:
    prefs.compute_device_type = "CUDA"
    prefs.refresh_devices() if hasattr(prefs, "refresh_devices") else None
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == "CUDA"
    log("devices", [(d.name, d.type, d.use) for d in prefs.devices])
    cy.device = "GPU"
except Exception as ex:
    log("GPU setup failed", ex)
cy.samples = A.samples or (24 if A.preview else 128)
cy.use_adaptive_sampling = True; cy.adaptive_threshold = 0.02
cy.use_denoising = True; cy.denoiser = "OPENIMAGEDENOISE"
try: cy.denoising_use_gpu = True
except Exception: pass
cy.max_bounces = 4; cy.diffuse_bounces = 3; cy.glossy_bounces = 3; cy.transmission_bounces = 2
cy.volume_bounces = 1; cy.volume_step_rate = 0.4; cy.volume_max_steps = 1024; cy.transparent_max_bounces = 4
cy.sample_clamp_indirect = 8
sc.render.film_transparent = False
sc.view_settings.view_transform = "AgX"
looks = [i.identifier for i in sc.view_settings.bl_rna.properties["look"].enum_items]
for lk_ in ("AgX - Punchy", "Punchy"):
    if lk_ in looks:
        sc.view_settings.look = lk_; break
sc.view_settings.exposure = 0.0
print("LOOKS", looks, sc.view_settings.look)
sc.view_settings.use_curve_mapping = True
_cv = sc.view_settings.curve_mapping.curves[3]
for _x, _y in ((0.06, 0.04), (0.28, 0.22), (0.75, 0.80)):
    _cv.points.new(_x, _y)
sc.view_settings.curve_mapping.update()
vl = bpy.context.view_layer
vl.use_pass_z = True

# ------------------------------------------------------------------ compositor: haze + tilt-shift + grade
g = bpy.data.node_groups.new("Comp", "CompositorNodeTree")
if not A.raw:
    sc.compositing_node_group = g
g.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
rl = N(g, "CompositorNodeRLayers")
out = N(g, "NodeGroupOutput")
depth = [o for o in rl.outputs if o.name in ("Depth", "Z")][0]
Lk = A.haze_km * 1000 / BU
HAZE_KM = shot.get("haze_km", A.haze_km); HAZE_MAX = shot.get("haze_max", A.haze_max)
if shot.get("horizon_y") is not None:
    HORIZON_Y = shot["horizon_y"]
elif shot.get("auto_horizon"):
    _hp = Vector((cam_loc.x + math.sin(hd) * 50000, cam_loc.y + math.cos(hd) * 50000, cam_loc.z))
    HORIZON_Y = float(world_to_camera_view(scene, cam, _hp).y); log("auto horizon y", HORIZON_Y)
else:
    HORIZON_Y = A.horizon_y
fac = mth(g, "POWER", maprange(g, depth, 1000.0, HAZE_KM * 100.0), 1.7)
fac = mth(g, "MULTIPLY", fac, HAZE_MAX)
fac = mth(g, "MULTIPLY", fac, mth(g, "LESS_THAN", depth, 40000.0))
hz = N(g, "ShaderNodeMix", data_type="RGBA")
L(g, fac, hz.inputs[0]); L(g, rl.outputs["Image"], hz.inputs[6]); hz.inputs[7].default_value = (*shot.get("haze_col", (0.62, 0.66, 0.78)), 1)
cur = hz.outputs[2]
# painted sky: warm horizon glow on the sun side, deeper blue above
ic0 = N(g, "CompositorNodeImageCoordinates"); L(g, rl.outputs["Image"], ic0.inputs["Image"])
sp = N(g, "ShaderNodeSeparateXYZ"); L(g, ic0.outputs["Normalized"], sp.inputs[0])
up = mth(g, "SUBTRACT", sp.outputs[1], 0.0)            # 0 bottom .. 1 top
hor = maprange(g, up, 0.55, 1.0)                       # 0 at horizon band .. 1 at top edge
glow = maprange(g, mth(g, "SUBTRACT", 1.0, sp.outputs[0]), 0.2, 1.0)  # stronger toward the left (sun side)
sky_a = mixc(g, hor, (1.0, 0.80, 0.62, 1), (0.36, 0.52, 0.80, 1))
sky_b = mixc(g, mth(g, "MULTIPLY", glow, mth(g, "SUBTRACT", 1.0, hor)), sky_a, (1.0, 0.62, 0.30, 1))
is_sky = mth(g, "GREATER_THAN", depth, 40000.0)
fade = maprange(g, up, HORIZON_Y + shot.get("sky_fade_band", 0.09), HORIZON_Y - 0.02, 0.0, 0.97)
sk = N(g, "ShaderNodeMix", data_type="RGBA")
L(g, mth(g, "MULTIPLY", is_sky, fade), sk.inputs[0]); L(g, cur, sk.inputs[6]); sk.inputs[7].default_value = (*shot.get("sky_fade_col", (0.78, 0.72, 0.74)), 1)
cur = sk.outputs[2]
# tilt-shift: blur grows away from a horizontal band
ic = N(g, "CompositorNodeImageCoordinates"); L(g, rl.outputs["Image"], ic.inputs["Image"])
sepx = N(g, "ShaderNodeSeparateXYZ"); L(g, ic.outputs["Normalized"], sepx.inputs[0])
ty_ = mth(g, "ABSOLUTE", mth(g, "SUBTRACT", sepx.outputs[1], 0.50))
bl = maprange(g, ty_, 0.22, 0.5, 0.0, 1.0)
bl = mth(g, "POWER", bl, 1.6)
sz = mth(g, "MULTIPLY", bl, A.blur_px * RX / 1536.0)
blur = N(g, "CompositorNodeBlur"); blur.inputs["Type"].default_value = "Gaussian" if False else blur.inputs["Type"].default_value
L(g, cur, blur.inputs["Image"])
cxy = N(g, "ShaderNodeCombineXYZ")
if A.blur_const >= 0:
    cxy.inputs[0].default_value = cxy.inputs[1].default_value = A.blur_const
else:
    L(g, sz, cxy.inputs[0]); L(g, sz, cxy.inputs[1])
if not A.no_blur: L(g, cxy.outputs[0], blur.inputs["Size"])
else: blur.inputs["Size"].default_value = (0.0, 0.0)
cur = blur.outputs[0]
gl = N(g, "CompositorNodeGlare")
try: gl.inputs["Type"].default_value = "Bloom"
except Exception: pass
gl.inputs["Threshold"].default_value = 2.5; gl.inputs["Strength"].default_value = 0.0 if os.environ.get("NOGL") else 0.35
L(g, cur, gl.inputs["Image"]); cur = gl.outputs["Image"]
cb = N(g, "CompositorNodeColorBalance")
try:
    cb.correction_method = "LIFT_GAMMA_GAIN"
except Exception: pass
for nm_, v_ in (("Lift", (1.0, 1.02, 1.08, 1)), ("Gain", (1.08, 1.0, 0.92, 1))):
    for so_ in cb.inputs:
        if so_.name == nm_ and so_.enabled and so_.type == "RGBA": so_.default_value = v_
L(g, cur, cb.inputs["Image"]); cur = cb.outputs["Image"]
cc = N(g, "CompositorNodeColorCorrection")
cc.inputs["Saturation"].default_value = 1.25; cc.inputs["Contrast"].default_value = 1.2
L(g, cur, cc.inputs["Image"]); cur = cc.outputs["Image"]
L(g, cur, out.inputs[0])

# ------------------------------------------------------------------ save + render
outdir = ROOT / "data" / "renders" / "swat"
outdir.mkdir(parents=True, exist_ok=True)
if not A.no_render or True:
    bpy.ops.wm.save_as_mainfile(filepath=str(outdir / "scene.blend"))
    log("saved blend")
img_path = A.out or str(outdir / (A.shot + ("_preview" if A.preview else "") + ".png"))

# ---- labels
log("labels")
from mathutils.bvhtree import BVHTree
dg = bpy.context.evaluated_depsgraph_get()
bvhs = [BVHTree.FromObject(o_, dg) for o_ in (obj_near, obj_far)]
gaz = json.loads((ROOT / "data" / "research" / "swat_gazetteer.json").read_text(encoding="utf-8"))
DROP = {"swat-river-source-kalam", "ushu-forest"}
PRIO = {"peak": 0, "mountain": 0, "volcano": 0, "saddle": 0, "lake": 1, "town": 2, "village": 3}
items = []
for g_ in gaz:
    if g_.get("slug") in DROP or g_.get("coord_confidence") == "low": continue
    items.append(dict(name=g_["name"], lat=g_["lat"], lon=g_["lon"], src="gazetteer", kind=g_.get("kind"), ele_src=g_.get("elevation_m"),
                      text=" ".join([str(g_.get("elevation_note") or ""), str(g_.get("notes") or "")] + [str(f_.get("quote", "")) + " " + str(f_.get("text", "")) for f_ in (g_.get("facts") or [])])))
for p_ in osm["peaks"]:
    if p_.get("name") and p_.get("ele"):
        items.append(dict(name=p_["name"], lat=p_["pt"][1], lon=p_["pt"][0], src="osm_peak", kind="peak", ele_src=p_["ele"]))
for it in items:
    it["xy"] = utm(it["lat"], it["lon"])
    it["prio"] = PRIO.get(str(it["kind"]).lower(), 9)
items.sort(key=lambda i: (i["prio"], i["src"] != "gazetteer"))
kept = []
for it in items:
    if any(math.hypot(it["xy"][0] - k["xy"][0], it["xy"][1] - k["xy"][1]) < 300 for k in kept): continue
    kept.append(it)
labels = []
camv = np.array(cam_loc)
for it in kept:
    x_, y_ = it["xy"]
    gr = float(ground(x_, y_))
    if it["prio"] == 0:  # summit = DEM max within 500 m
        o_ = np.arange(-500, 501, 100.0)
        gx_, gy_ = np.meshgrid(x_ + o_, y_ + o_)
        gr = float(ground(gx_.ravel(), gy_.ravel()).max())
    p0 = np.array([*to_world(x_, y_), gr * EXAG / BU])
    dist_m = np.linalg.norm(p0 - camv) * BU
    lift = max(40.0, 0.004 * dist_m) * EXAG
    p = Vector((p0[0], p0[1], p0[2] + lift / BU))
    v = world_to_camera_view(scene, cam, p)
    if not (0 <= v.x <= 1 and 0 <= v.y <= 1 and v.z > 0): continue
    d = p - cam_loc
    dist = d.length
    hits = [h_[3] for h_ in (b_.ray_cast(cam_loc, d.normalized(), dist * 1.2) for b_ in bvhs) if h_[0] is not None]
    vis = (not hits) or min(hits) >= 0.97 * dist
    _listed = it["ele_src"]
    try: _listed = float(str(_listed).replace("m", "").strip()) if _listed not in (None, "") else None
    except ValueError: _listed = None
    _dem = round(gr, 1)
    if it["prio"] == 0:
        import re as _re
        _cands = []
        for o2 in items:
            if math.hypot(o2["xy"][0] - x_, o2["xy"][1] - y_) < 300:
                try: _cands.append(float(str(o2["ele_src"]).replace("m", "").strip()))
                except ValueError: pass
                for mm in _re.findall(r"(\d{1,2},\d{3}|\d{4})\s*m", o2.get("text", "")):
                    _cands.append(float(mm.replace(",", "")))
        _cands = [c_ for c_ in _cands if abs(c_ - _dem) <= 250]
        if _cands: _lab, _flag = min(_cands, key=lambda c_: abs(c_ - _dem)), False
        else: _lab, _flag = _dem, True
    else:
        _lab, _flag = (_listed if _listed is not None else round(float(ground(x_, y_)), 1)), False
    labels.append(dict(label_elevation_m=_lab, elevation_is_dem_flag=_flag, summit_dem_max_m=_dem if it["prio"] == 0 else None,
                       name=it["name"], kind=it["kind"], source=it["src"], px=[round(v.x * RX, 1), round((1 - v.y) * RY, 1)],
                       distance_m=round(dist * BU, 0), visible=bool(vis), dem_elevation_m=round(float(ground(x_, y_)), 1),
                       listed_elevation_m=it["ele_src"], lat=it["lat"], lon=it["lon"]))
(outdir / f"{A.shot}_labels.json").write_text(json.dumps({"image": [RX, RY], "heading_deg": shot["heading"], "exag": EXAG,
                                                          "labels": labels}, indent=1, ensure_ascii=False), encoding="utf-8")
try:
    _best = None
    for ring in LAKES:
        cc_ = ring.mean(0)
        dd_ = math.hypot(cc_[0] - fx, cc_[1] - fyy)
        if _best is None or dd_ < _best[0]: _best = (dd_, ring)
    pr = np.array([[world_to_camera_view(scene, cam, Vector((*to_world(x_, y_), float(ground(x_, y_)) * EXAG / BU + 0.1))).to_tuple()[i] for i in (0, 1)] for x_, y_ in _best[1]]) * np.array([RX, RY])
    log("LAKE px extent", float(np.ptp(pr[:, 0])), float(np.ptp(pr[:, 1])), "max pair", float(max(np.hypot(*(pr - q_).T).max() for q_ in pr)))
except Exception as ex:
    log("lake px failed", ex)
log("labels", len(labels), "visible", sum(l["visible"] for l in labels))
del bvhs

if not A.no_render:
    sc.render.filepath = img_path
    sc.render.image_settings.file_format = "PNG"
    t1 = time.time()
    bpy.ops.render.render(write_still=True)
    log(f"RENDER TIME {time.time() - t1:.1f}s -> {img_path}  trees={n_trees}")
