"""Build one or more regions from the command line (same pipeline as the web app's "Add a place").

    python backend/tools/build_region.py "Zermatt" "Mount Fuji" "Machu Picchu"
    python backend/tools/build_region.py --lat 46.02 --lon 7.75 "Zermatt"     # skip the place search

The first search result is used unless you pass coordinates, so check the names it prints.
"""
import argparse
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tinyatlas import builder, jobs  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("places", nargs="+")
ap.add_argument("--lat", type=float)
ap.add_argument("--lon", type=float)
a = ap.parse_args()

for q in a.places:
    place = {"name": q, "subtitle": "", "lat": a.lat, "lon": a.lon} if a.lat is not None and a.lon is not None else None
    job, result, t0, last = jobs.Job(builder.STEPS), {}, time.time(), None
    print(f"== {q}", flush=True)

    def work():
        try:
            result["slug"] = builder.build(q, job, place)
        except Exception as exc:
            result["error"] = f"{type(exc).__name__}: {exc}"

    worker = threading.Thread(target=work)
    worker.start()
    while worker.is_alive():
        active = next((s["label"] for s in job.steps if s["state"] == "active"), None)
        if active and active != last:
            last = active
            print(f"   {active} ({time.time() - t0:.0f}s)", flush=True)
        time.sleep(1)
    print(f"   -> {result.get('slug') or 'FAILED: ' + result['error']} ({time.time() - t0:.0f}s)", flush=True)
