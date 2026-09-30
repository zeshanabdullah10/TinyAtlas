"""Which named peaks can you see from a point?

    python backend/tools/panorama.py 36.329 74.666            # Karimabad
    python backend/tools/panorama.py 36.329 74.666 --eye 10 --top 20
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tinyatlas import viewshed  # noqa: E402
from tinyatlas.regions import REGIONS  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("lat", type=float)
ap.add_argument("lon", type=float)
ap.add_argument("--eye", type=float, default=viewshed.EYE_M)
ap.add_argument("--top", type=int, default=15)
ap.add_argument("--region", help="use this region's panorama grid (what the app uses) instead of one centred here")
a = ap.parse_args()

grid = viewshed.region_wide(REGIONS[a.region]) if a.region else None
near = viewshed.near_grid(REGIONS[a.region]) if a.region else None
pano = viewshed.panorama_at(a.lat, a.lon, eye=a.eye, grid=grid, near=near)
print(f"standing at {pano['elev']} m; {len(pano['peaks'])} named peaks in view")
for p in sorted(pano["peaks"], key=lambda p: -p["alt"])[: a.top]:
    print(f"{p['name']:30s} {p['ele']:5d} m  bearing {p['az']:5.1f}  {p['dist'] / 1000:5.1f} km  {p['alt']:5.2f} deg up")
