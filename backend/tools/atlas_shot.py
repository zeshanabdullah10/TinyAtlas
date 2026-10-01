"""Headless screenshots of /atlas.html, with console capture and the renderer's draw statistics.

    python backend/tools/atlas_shot.py out.png [--pack swat] [--size 1600x1000] [--tier high]
        [--view '{"e":..,"n":..,"heading":..,"pitch":..,"dist":..}'] [--eval JS] [--wait MS] [--host http://localhost:8000]
"""
import argparse, json
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument("out")
ap.add_argument("--pack", default="swat")
ap.add_argument("--base")
ap.add_argument("--size", default="1600x1000")
ap.add_argument("--tier", default="high")
ap.add_argument("--view")
ap.add_argument("--eval")
ap.add_argument("--wait", type=int, default=1500)
ap.add_argument("--timeout", type=int, default=120)
ap.add_argument("--fps", action="store_true")
ap.add_argument("--host", default="http://localhost:8000")
a = ap.parse_args()
w, h = (int(v) for v in a.size.split("x"))
url = f"{a.host}/atlas.html?pack={a.pack}&tier={a.tier}" + (f"&base={a.base}" if a.base else "") + ("&fps=1" if a.fps else "")

with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge", args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    page = b.new_page(viewport={"width": w, "height": h})
    logs = []
    page.on("console", lambda m: logs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: logs.append(f"pageerror: {e}"))
    page.goto(url)
    try:
        page.wait_for_function("window.__ready === true", timeout=a.timeout * 1000)
    except Exception:
        print("NOT READY"); [print(l[:600]) for l in logs[:30]]; page.screenshot(path=a.out); b.close(); raise SystemExit(1)
    if a.view:
        page.evaluate(f"window.__atlas.view({a.view})")
        page.wait_for_function("window.__ready === true", timeout=300000)
    if a.eval:
        page.evaluate(a.eval)
    page.wait_for_timeout(a.wait)
    page.screenshot(path=a.out)
    print(json.dumps(page.evaluate("window.__atlas.info()")))
    for l in logs[:30]:
        print(l[:400])
    b.close()
