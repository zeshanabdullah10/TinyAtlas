"""Landmark maquettes: the Wikipedia photo -> Hunyuan3D-2 (on the pod) cuts out the building and turns it into a
mesh -> web/models/<slug>.glb, which the viewer loads in place of the procedural model and paints plaster white.
With --maquette the photo is first redrawn by SDXL as a clean scale model (tidier, but less like the real building).

    COMFY_URL=https://<pod>-8188.proxy.runpod.net python backend/tools/models3d.py hunza skardu [--only baltit-fort]
    python backend/tools/models3d.py hunza --pictures-only     # stop after the maquette pictures, to review them

Pictures go to data/models/<slug>.png. Existing pictures and models are kept (delete one to redo it).
"""
import argparse
import io
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import httpx  # noqa: E402
from PIL import Image  # noqa: E402

import pod_files  # noqa: E402
from tinyatlas import api, sources, stylize  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
PICS, OUT, JOB, HERE = ROOT / "data" / "models", ROOT / "web" / "models", "/workspace/models_job", Path(__file__).resolve().parent
BUILT = {"fort", "temple", "bridge", "monument", "tower", "museum", "ruins"}
NEG = ("photo background, landscape, blue sky, sky, trees, people, text, watermark, blurry, cropped, cut off, "
       "out of frame, close-up, multiple objects, rubble, debris")

ap = argparse.ArgumentParser()
ap.add_argument("regions", nargs="+")
ap.add_argument("--only")
ap.add_argument("--pictures-only", action="store_true")
ap.add_argument("--maquette", action="store_true",
                help="first redraw the photo as a clean scale model with SDXL (cleaner, but drifts from the real building)")
a = ap.parse_args()


def pod(cmd: str) -> str:
    return subprocess.run([sys.executable, str(HERE / "pod_run.py"), cmd], capture_output=True, text=True).stdout


PICS.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)
todo = []
with httpx.Client(headers=sources.HEADERS, follow_redirects=True, timeout=60) as client:
    for region in a.regions:
        for lm in api.region_landmarks(region):
            if lm["kind"] not in BUILT or not lm.get("image") or (a.only and lm["slug"] != a.only):
                continue
            pic = PICS / f"{lm['slug']}.png"
            if not pic.exists() and not a.maquette:        # the photo itself: Hunyuan3D cuts out the building
                Image.open(io.BytesIO(client.get(lm["image"]).content)).convert("RGB").save(pic)
                print("photo", lm["slug"], flush=True)
            if not pic.exists():
                photo = Image.open(io.BytesIO(client.get(lm["image"]).content)).convert("RGB")
                name = stylize.upload(photo, f"lm_{lm['slug']}.png", client)
                text = (f"a small white plaster architectural scale model of {lm['name']}, a {lm['kind']}, standing alone "
                        "in the centre of the frame with plenty of empty space all around it, the entire model visible, "
                        "plain white seamless studio background, soft even light, museum maquette, three-quarter view "
                        "from slightly above, clean detailed geometry")
                stylize.run(stylize.img2img_workflow(name, text, NEG, denoise=0.82, prefix=f"lm_{lm['slug']}"), client).save(pic)
                print("pictured", lm["slug"], flush=True)
            if not (OUT / f"{lm['slug']}.glb").exists():
                todo.append(lm["slug"])
if a.pictures_only or not todo:
    sys.exit(0)

with httpx.Client() as client:
    pod_files.mkdir(JOB, client)
    pod_files.put(HERE / "h3d_worker.py", f"{JOB}/h3d_worker.py", client)
    for slug in todo:
        pod_files.put(PICS / f"{slug}.png", f"{JOB}/{slug}.png", client)
pod(f"cd {JOB} && rm -f worker.log && setsid nohup /workspace/h3d/bin/python h3d_worker.py {JOB} > worker.log 2>&1 < /dev/null & disown")
while "DONE" not in (log := pod(f"tail -3 {JOB}/worker.log")):
    if "Traceback" in log or "Error" in log:
        print(pod(f"tail -40 {JOB}/worker.log")); sys.exit(1)
    time.sleep(20)
with httpx.Client() as client:
    for slug in todo:
        pod_files.get(f"{JOB}/{slug}.glb", OUT / f"{slug}.glb", client)
        print("model", OUT / f"{slug}.glb", flush=True)
