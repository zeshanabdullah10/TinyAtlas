"""AI detail pass over a Blender beauty render: SDXL img2img in feathered tiles, pinned by the render's own
depth + edge passes so no geometry moves. Real data sets the facts, the model only paints texture.

    blender ... build_scene.py -- --shot mahodand --res-scale 1.5 --passes --samples 24 --out <abs scratch.png>
    python backend/tools/passes_convert.py mahodand
    COMFY_URL=https://<pod>-8188.proxy.runpod.net python backend/tools/paintover.py mahodand [--denoise 0.38]

Writes data/renders/swat/<shot>_painted.png (+ <shot>_paint_compare.png) and prints geometry-guard metrics.
Models: RealVisXL V5.0 + diffusers controlnet-depth-sdxl-1.0 + controlnet-canny-sdxl-1.0 (all OpenRAIL++).
"""
import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cv2  # noqa: E402
import httpx  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from tinyatlas import stylize  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "renders" / "swat"
CKPT = "RealVisXL_V5.0_fp16.safetensors"
CN_DEPTH, CN_CANNY = "controlnet-depth-sdxl-1.0.safetensors", "controlnet-canny-sdxl-1.0.safetensors"
CLASSES = ["sky", "water", "forest", "rock", "snow", "meadow", "road", "buildings"]
BASE = ("aerial photograph at golden hour of a Himalayan alpine valley, Swat Kohistan Pakistan, steep granite and "
        "schist slopes with rugged weathered crags and gullies, scree fans, dense dark deodar and spruce conifer forest "
        "with individual needle-leaf trees, alpine meadow grass, glacial turquoise lake, thin dirt jeep track, "
        "natural colours, sharp focus, fine natural detail, realistic texture, 8k photo")
HINT = {"forest": "dense realistic conifer forest, individual spruce and fir trees with branches",
        "rock": "weathered granite crags, scree fans, gullies and loose boulders, sparse alpine grass",
        "snow": "snow fields and snow patches on rock", "meadow": "alpine meadow grass and wildflowers, scattered shrubs",
        "water": "clear turquoise glacial lake water", "road": "dirt jeep track"}
NEG = ("text, letters, labels, watermark, logo, buildings, houses, people, cars, blurry, soft, out of focus, cartoon, "
       "illustration, painting, 3d render, cgi, plastic, lowres, oversaturated, smooth melted terrain, terraces, contour lines, stripes, horizontal bands")


def workflow(base, depth, canny, text, seed, denoise, cd, cc, steps, cfg):
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": text, "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["1", 1]}},
        "4": {"class_type": "LoadImage", "inputs": {"image": base}},
        "5": {"class_type": "LoadImage", "inputs": {"image": depth}},
        "6": {"class_type": "LoadImage", "inputs": {"image": canny}},
        "7": {"class_type": "ControlNetLoader", "inputs": {"control_net_name": CN_DEPTH}},
        "8": {"class_type": "ControlNetLoader", "inputs": {"control_net_name": CN_CANNY}},
        "9": {"class_type": "ControlNetApplyAdvanced", "inputs": {
            "positive": ["2", 0], "negative": ["3", 0], "control_net": ["7", 0], "image": ["5", 0],
            "strength": cd, "start_percent": 0.0, "end_percent": 0.85, "vae": ["1", 2]}},
        "10": {"class_type": "ControlNetApplyAdvanced", "inputs": {
            "positive": ["9", 0], "negative": ["9", 1], "control_net": ["8", 0], "image": ["6", 0],
            "strength": cc, "start_percent": 0.0, "end_percent": 0.8, "vae": ["1", 2]}},
        "11": {"class_type": "VAEEncode", "inputs": {"pixels": ["4", 0], "vae": ["1", 2]}},
        "12": {"class_type": "KSampler", "inputs": {
            "model": ["1", 0], "positive": ["10", 0], "negative": ["10", 1], "latent_image": ["11", 0],
            "seed": seed, "steps": steps, "cfg": cfg, "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": denoise}},
        "13": {"class_type": "VAEDecode", "inputs": {"samples": ["12", 0], "vae": ["1", 2]}},
        "14": {"class_type": "SaveImage", "inputs": {"images": ["13", 0], "filename_prefix": "paintover"}},
    }


def starts(n, tile, step):
    if n <= tile:
        return [0]
    k = int(np.ceil((n - tile) / step)) + 1
    return [min(i * step, n - tile) for i in range(k)]


def paint(shot, a):
    d = OUT / f"passes_{shot}"
    beauty = Image.open(OUT / f"{shot}.png").convert("RGB")
    W, H = beauty.size
    big = (W * a.scale, H * a.scale)
    img = beauty.resize(big, Image.LANCZOS)
    dp = np.array(Image.open(d / "depth16.png")).astype(np.float32) / 256
    depth = Image.fromarray(dp.astype(np.uint8)).convert("RGB").resize(big, Image.BICUBIC)
    edges = Image.open(d / "edges.png").convert("RGB").resize(big, Image.BILINEAR)
    edges = Image.fromarray(((np.array(edges) > 100) * 255).astype(np.uint8))
    seg = np.array(Image.open(d / "seg_idx.png").resize(big, Image.NEAREST))
    T, ov = a.tile, a.overlap
    acc = np.zeros((big[1], big[0], 3), np.float32)
    wsum = np.zeros((big[1], big[0], 1), np.float32)
    ramp = np.minimum(np.arange(T) + 1, T - np.arange(T)).astype(np.float32)
    wt = (np.minimum(np.minimum.outer(ramp, ramp), ov) / ov)[..., None]          # feathered tile weight
    xs, ys = starts(big[0], T, T - ov), starts(big[1], T, T - ov)
    t0 = time.time()
    with httpx.Client() as c:
        for yi, y in enumerate(ys):
            for xi, x in enumerate(xs):
                box = (x, y, x + T, y + T)
                cnt = np.bincount(seg[y:y + T, x:x + T].ravel(), minlength=8) / (T * T)
                hints = [HINT[CLASSES[i]] for i in np.argsort(-cnt) if CLASSES[i] in HINT and cnt[i] > 0.12 and CLASSES[i] not in ("water", "road")][:3]
                if cnt[1] > 0.02:
                    hints.append(HINT["water"])
                if cnt[6] > 0.004:
                    hints.append(HINT["road"])
                text = BASE + (", mostly " + ", ".join(hints) if hints else "")
                up = [stylize.upload(im.crop(box), f"po_{n}.png", c) for n, im in (("b", img), ("d", depth), ("e", edges))]
                cn = min(a.canny, 0.3) if cnt[3] > 0.5 else a.canny
                wf = workflow(*up, text, a.seed, a.denoise, a.depth, cn, a.steps, a.cfg)
                for _ in range(6):
                    try:
                        out = stylize.run(wf, c, timeout_s=900)
                        break
                    except RuntimeError as ex:
                        print("  retry", str(ex)[:120], flush=True)
                        time.sleep(40)
                else:
                    raise SystemExit("tile failed")
                acc[y:y + T, x:x + T] += np.array(out.convert("RGB").resize((T, T)), np.float32) * wt
                wsum[y:y + T, x:x + T] += wt
                print(f"tile {yi},{xi} {time.time() - t0:.0f}s  [{', '.join(hints)}]", flush=True)
        try:
            c.post(f"{stylize.comfy_url()}/free", json={"unload_models": True, "free_memory": True}, timeout=30)
        except Exception:
            pass
    painted = Image.fromarray((acc / np.maximum(wsum, 1e-6)).clip(0, 255).astype(np.uint8)).resize((W, H), Image.LANCZOS)
    print(f"paint time {time.time() - t0:.0f}s")
    return beauty, painted


def composite(beauty, painted, shot, a):
    """Keep water, road and sky from the original, feathered, so they stay crisp and exactly placed."""
    idx = np.array(Image.open(OUT / f"passes_{shot}" / "seg_idx.png"))
    water = cv2.erode((idx == 1).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25))).astype(np.float32)
    other = np.isin(idx, [0, 6]).astype(np.float32)           # sky and road stay crisp; the 10-15 px shoreline is painted
    keep = np.maximum(water, other)
    keep = cv2.GaussianBlur(keep, (0, 0), 3.0)[..., None] * a.keep
    out = np.array(painted, np.float32) * (1 - keep) + np.array(beauty, np.float32) * keep
    return Image.fromarray(out.clip(0, 255).astype(np.uint8))


def edge_map(im):
    g = cv2.GaussianBlur(cv2.cvtColor(np.array(im), cv2.COLOR_RGB2GRAY), (0, 0), 1.5)
    return cv2.Canny(g, 20, 60) > 0


def guard(shot, beauty, painted):
    d = OUT / f"passes_{shot}"
    ref = np.array(Image.open(d / "edges.png")) > 0
    ref = cv2.erode(ref.astype(np.uint8), np.ones((2, 2), np.uint8)) > 0
    res = {}
    idx = np.array(Image.open(d / "seg_idx.png"))
    water = idx == 1
    sky = idx == 0
    cols = np.where(sky.any(0))[0]
    true = np.array([np.where(sky[:, c])[0].max() for c in cols])
    for name, im in (("beauty", beauty), ("painted", painted)):
        dist = cv2.distanceTransform((~edge_map(im)).astype(np.uint8), cv2.DIST_L2, 3)
        v = dist[ref]
        r = {"chamfer_px": round(float(v.mean()), 2), "edges_within_3px": round(float((v <= 3).mean()), 3)}
        hsv = cv2.cvtColor(np.array(im), cv2.COLOR_RGB2HSV)
        h, s = hsv[..., 0].astype(float) * 2, hsv[..., 1]
        r["water_teal_frac"] = round(float(((h[water] > 150) & (h[water] < 215) & (s[water] > 40)).mean()), 3)
        g = cv2.GaussianBlur(cv2.cvtColor(np.array(im), cv2.COLOR_RGB2GRAY), (0, 0), 1.5).astype(np.float32)
        gy = np.abs(np.diff(g, axis=0))
        off = []
        for c, t in zip(cols, true):
            lo, hi = max(t - 25, 0), min(t + 25, gy.shape[0])
            off.append(abs(lo + int(gy[lo:hi, c].argmax()) - t))
        r["skyline_median_shift_px"] = float(np.median(off)) if off else None
        res[name] = r
    return res


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("shot")
    ap.add_argument("--denoise", type=float, default=0.38)
    ap.add_argument("--depth", type=float, default=0.8)
    ap.add_argument("--canny", type=float, default=0.6)
    ap.add_argument("--steps", type=int, default=30)
    ap.add_argument("--cfg", type=float, default=5.5)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--scale", type=int, default=2)
    ap.add_argument("--tile", type=int, default=1024)
    ap.add_argument("--overlap", type=int, default=128)
    ap.add_argument("--keep", type=float, default=0.85, help="how much of the original to keep on water/road/sky")
    ap.add_argument("--reuse", action="store_true", help="skip painting, reuse <shot>_painted_raw.png")
    a = ap.parse_args()
    raw = OUT / f"{a.shot}_painted_raw.png"
    if a.reuse:
        beauty, painted = Image.open(OUT / f"{a.shot}.png").convert("RGB"), Image.open(raw).convert("RGB")
    else:
        beauty, painted = paint(a.shot, a)
        painted.save(raw)
    final = composite(beauty, painted, a.shot, a)
    final.save(OUT / f"{a.shot}_painted.png")
    cmp_ = Image.new("RGB", (beauty.width * 2, beauty.height))
    cmp_.paste(beauty, (0, 0))
    cmp_.paste(final, (beauty.width, 0))
    cmp_.save(OUT / f"{a.shot}_paint_compare.png")
    print(json.dumps({"raw": guard(a.shot, beauty, painted), "final": guard(a.shot, beauty, final)}, indent=1))
