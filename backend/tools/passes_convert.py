"""Turn build_scene.py --passes EXRs into ControlNet-ready PNGs.

    python backend/tools/passes_convert.py mahodand

Reads data/renders/swat/passes_<shot>/p_*.exr, writes next to them: depth16.png (near = white, 16-bit),
normal.png (camera space, RGB), edges.png (white lines on black from depth + normal discontinuities),
seg.png (flat class colours) and seg_idx.png (class ids, see CLASSES).
"""
import json
import os
import sys
from pathlib import Path

os.environ["OPENCV_IO_ENABLE_OPENEXR"] = "1"
import cv2  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CLASSES = ["sky", "water", "forest", "rock", "snow", "meadow", "road", "buildings"]
COLORS = [(135, 180, 230), (0, 160, 190), (20, 90, 30), (150, 110, 80), (245, 245, 250), (140, 170, 60), (200, 170, 110), (200, 40, 40)]


def _exr(p: Path) -> np.ndarray:
    return cv2.imread(str(p), cv2.IMREAD_UNCHANGED).astype(np.float32)[..., 2::-1]  # BGR(A) -> RGB


EDGE_DEPTH, EDGE_NORMAL = float(os.environ.get('EDGE_DEPTH', 0.012)), float(os.environ.get('EDGE_NORMAL', 0.35))


def convert(shot: str) -> Path:
    d = ROOT / "data" / "renders" / "swat" / f"passes_{shot}"
    z = _exr(d / "p_depth.exr")[..., 0]
    sky = z > 1e5                                           # background Z is ~1e10
    zz = np.where(sky, np.nan, z)
    disp = 1.0 / zz                                         # inverse depth: near = large
    lo, hi = np.nanpercentile(disp, [0.5, 99.5])
    dn = np.clip((disp - lo) / (hi - lo), 0, 1)
    dn = np.where(sky, 0.0, 0.04 + 0.96 * dn)
    Image.fromarray((dn * 65535).astype(np.uint16)).save(d / "depth16.png")
    # normals: world -> camera
    R = np.array(json.loads((d / "camera.json").read_text())["R"], np.float32)   # camera-to-world
    n = _exr(d / "p_normal.exr")[..., :3] @ R               # row-vector @ R == R^T n
    n[..., 1:] *= -1                                        # Blender camera looks down -Z; use image convention
    n = np.where(sky[..., None], 0, n)
    Image.fromarray(((n * 0.5 + 0.5).clip(0, 1) * 255).astype(np.uint8)).save(d / "normal.png")
    # edges: depth discontinuities (relative) + normal discontinuities
    lz = np.where(sky, 0, np.log(np.where(sky, 1, z))).astype(np.float32)
    lz = cv2.GaussianBlur(lz, (0, 0), 2.0)                  # kill DEM/depth step quantisation before edge extraction
    ed = np.hypot(cv2.Sobel(lz, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(lz, cv2.CV_32F, 0, 1, ksize=3)) / 8
    nb = cv2.GaussianBlur(n, (0, 0), 3.0)
    gn = np.hypot(cv2.Sobel(nb, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(nb, cv2.CV_32F, 0, 1, ksize=3)).sum(-1) / 8
    edge = (ed > EDGE_DEPTH) | (gn > EDGE_NORMAL) | (np.abs(cv2.Sobel(sky.astype(np.float32), cv2.CV_32F, 1, 0)) + np.abs(cv2.Sobel(sky.astype(np.float32), cv2.CV_32F, 0, 1)) > 0)
    edge = cv2.dilate(edge.astype(np.uint8) * 255, np.ones((2, 2), np.uint8))
    Image.fromarray(edge).save(d / "edges.png")
    # segmentation
    sA, sB, sC = (_exr(d / f"p_{k}.exr")[..., :3] for k in ("sA", "sB", "sC"))
    score = np.stack([np.zeros_like(z) + 0.05,                       # sky placeholder (never wins over ground)
                      sB[..., 1] * 1.5, sB[..., 0], sA[..., 1], sA[..., 0] * 1.2, np.maximum(sA[..., 2], 0.35),
                      sB[..., 2] * 1.5, sC[..., 0] * 1.5], -1)
    idx = score.argmax(-1)
    nz = _exr(d / "p_normal.exr")[..., 2]                  # world-up component
    idx[(idx == 5) & (nz < 0.8)] = 3                         # steep untagged ground reads as rock
    idx[sky] = 0
    Image.fromarray(idx.astype(np.uint8)).save(d / "seg_idx.png")
    Image.fromarray(np.array(COLORS, np.uint8)[idx]).save(d / "seg.png")
    print(d, {c: round(float((idx == i).mean()), 3) for i, c in enumerate(CLASSES)})
    return d


if __name__ == "__main__":
    convert(sys.argv[1])
