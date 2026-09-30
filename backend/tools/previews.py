"""Paint "see the view before you go" previews for a region's viewpoints.

    python backend/tools/previews.py hunza --dry                   # depth images and labels only (no GPU)
    COMFY_URL=https://<pod>-8188.proxy.runpod.net python backend/tools/previews.py hunza [--only karimabad]

Writes data/views/<region>/: <viewpoint>_depth.png, <viewpoint>_<season>_<time>.jpg and views.json. Each viewpoint
uses one seed for all its pictures, so seasons and times of day show the same scene. Existing pictures are kept.
"""
import argparse
import json
import sys
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402

from tinyatlas import osm, stylize, views, viewshed  # noqa: E402
from tinyatlas.regions import REGIONS  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
ap = argparse.ArgumentParser()
ap.add_argument("region")
ap.add_argument("--only", help="just this viewpoint slug")
ap.add_argument("--seasons", default="spring,summer,autumn,winter")
ap.add_argument("--times", default="sunrise,midday,evening")
ap.add_argument("--dry", action="store_true", help="depth images and labels only")
ap.add_argument("--redo-water", action="store_true", help="repaint viewpoints that look at mapped water")
a = ap.parse_args()

cfg = REGIONS[a.region]
out = ROOT / "data" / "views" / a.region
out.mkdir(parents=True, exist_ok=True)
hm, bbox, size = viewshed.region_wide(cfg)
near = viewshed.near_grid(cfg)
raster = views.water_raster(cfg["bbox"], osm.features(cfg["bbox"]))
peaks = [{**p, "row": rc[0], "col": rc[1]} for p in viewshed.named_peaks(bbox)
         for rc in [viewshed.to_rc(p["lat"], p["lon"], bbox, hm.shape)]]
index_path = out / "views.json"
index = {v["slug"]: v for v in json.loads(index_path.read_text(encoding="utf-8"))} if index_path.exists() else {}

with httpx.Client() as client:
    for vp in cfg.get("viewpoints", []):
        if a.only and vp["slug"] != a.only:
            continue
        rc = viewshed.to_rc(vp["lat"], vp["lon"], bbox, hm.shape)
        pano = viewshed.panorama(hm, size, rc, peaks=peaks, bbox=bbox, near=near)
        heading = vp.get("heading", views.best_heading(pano))
        depth, dist, dpp, ground = views.depth_image(hm, size, rc, heading, bbox=bbox, near=near)
        depth.save(out / f"{vp['slug']}_depth.png")
        water = views.water_in_view(ground, raster)
        wet = float(water.mean()) > 0.003                       # mapped water fills a real part of the picture
        init_pic = views.init_image(dist, water, max(size) * 0.75) if wet else None
        if init_pic:
            init_pic.save(out / f"{vp['slug']}_init.png")
        if wet and a.redo_water and not a.dry:
            for old in out.glob(f"{vp['slug']}_*_*.jpg"):
                old.unlink()
        entry = {"slug": vp["slug"], "name": vp["name"], "lat": vp["lat"], "lon": vp["lon"], "heading": heading,
                 "fov": views.FOV, "elev": pano["elev"], "labels": views.place_labels(pano, heading, dpp), "images": {}}
        print(f"{vp['slug']}: facing {heading:.0f} deg, {len(entry['labels'])} summits in frame", flush=True)
        seed = zlib.crc32(f"{a.region}/{vp['slug']}".encode()) % 10_000
        uploaded = init_up = None
        for season in a.seasons.split(","):
            for time in a.times.split(","):
                name = f"{vp['slug']}_{season}_{time}.jpg"
                if not (out / name).exists() and not a.dry:
                    uploaded = uploaded or stylize.upload(depth.convert("RGB"), f"view_{a.region}_{vp['slug']}.png", client)
                    init_up = init_up or (init_pic and stylize.upload(init_pic, f"init_{a.region}_{vp['slug']}.png", client))
                    wf = stylize.depth_painting_workflow(uploaded, views.prompt(vp["name"], time, season, wet), views.NEGATIVE,
                                                         seed=seed, prefix=f"view_{a.region}_{vp['slug']}",
                                                         init=init_up or None, denoise=0.88)
                    stylize.run(wf, client).save(out / name, quality=88)
                    print(f"  {name}", flush=True)
                if (out / name).exists():
                    entry["images"].setdefault(season, {})[time] = name
        index[vp["slug"]] = entry

order = [v["slug"] for v in cfg.get("viewpoints", [])]
index_path.write_text(json.dumps([index[s] for s in order if s in index], ensure_ascii=False, indent=1), encoding="utf-8")
print("wrote", index_path)
