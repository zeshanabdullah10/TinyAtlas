"""Stylise a region's painted tiles with ComfyUI and blend them into data/tiles/<region>/texture_ai.png.

    COMFY_URL=https://<pod>-8188.proxy.runpod.net python backend/tools/stylize.py hunza [--only 1_1] [--denoise 0.55]

Styled tiles are cached in data/tiles/<region>/styled/, so a re-run only pays for missing tiles.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402
from PIL import Image, ImageFilter  # noqa: E402

from tinyatlas import osm, paint, stylize, tiles  # noqa: E402
from tinyatlas.regions import REGIONS  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("region", nargs="?", default="hunza")
ap.add_argument("--nx", type=int, default=3)
ap.add_argument("--ny", type=int, default=3)
ap.add_argument("--size", type=int, default=768, help="tile size sent to SD1.5 (it is happiest near 512-768)")
ap.add_argument("--core", type=int, default=800, help="output px per tile core in the final mosaic")
ap.add_argument("--denoise", type=float, default=0.55)
ap.add_argument("--seed", type=int, default=7)
ap.add_argument("--only", help="stylise just this tile, e.g. 1_1 (no mosaic)")
a = ap.parse_args()

bbox = REGIONS[a.region]["bbox"]
out = tiles.OUT / a.region
(out / "styled").mkdir(parents=True, exist_ok=True)
lo, hi = tiles.region_range(bbox)
feats = osm.features(bbox)
clim = paint.climate(bbox, REGIONS[a.region].get("snowline"))
grid = tiles.tile_grid(bbox, a.nx, a.ny)

with httpx.Client() as client:
    for t in grid:
        if a.only and t.name != a.only:
            continue
        dst = out / "styled" / f"{t.name}.png"
        if dst.exists():
            print(f"tile {t.name}: cached")
            continue
        base = paint.paint_tile(t, feats, bbox, a.size, clim=clim)
        depth = tiles.depth_image(t, lo, hi, a.size).convert("RGB")
        line = tiles.line_image(t, feats, bbox, a.size).convert("RGB")
        names = [stylize.upload(im, f"{a.region}_{t.name}_{k}.png", client) for k, im in
                 (("base", base), ("depth", depth), ("line", line))]
        wf = stylize.build_workflow(*names, seed=a.seed, denoise=a.denoise, prefix=f"tinyatlas_{a.region}_{t.name}")
        stylize.run(wf, client).save(dst)
        print(f"tile {t.name}: stylised -> {dst}", flush=True)

if a.only:
    sys.exit(0)

# Mosaic: place every styled tile on the region canvas and feather across the overlaps.
W, S_, E, N = bbox
cw, ch = a.nx * a.core, a.ny * a.core
ramp_x = round(2 * 0.125 * a.core)
ramp_y = round(2 * 0.125 * a.core)
place = []
for t in grid:
    tw, ts, te, tn = t.bbox
    rect = (round((tw - W) / (E - W) * cw), round((N - tn) / (N - S_) * ch),
            round((te - W) / (E - W) * cw), round((N - ts) / (N - S_) * ch))
    ramps = (ramp_x if t.ix > 0 else 0, ramp_y if t.iy > 0 else 0,
             ramp_x if t.ix < a.nx - 1 else 0, ramp_y if t.iy < a.ny - 1 else 0)
    styled = Image.open(out / "styled" / f"{t.name}.png").convert("RGB")
    wmask = tiles.water_mask(t, feats, bbox, a.size).filter(ImageFilter.GaussianBlur(1.0))
    place.append((stylize.restore_water(styled, wmask), rect, ramps))
final = stylize.blend_mosaic(place, (cw, ch))
final.save(out / "texture_ai.png")
print("wrote", out / "texture_ai.png", final.size)
