"""Headless screenshot of the viewer (uses installed Edge; no browser download).

    python backend/tools/screenshot.py [url] [out.png]
"""
import sys

from playwright.sync_api import sync_playwright

url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000/?region=hunza"
out = sys.argv[2] if len(sys.argv) > 2 else "shot.png"

with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge", args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    page = b.new_page(viewport={"width": 1280, "height": 800})
    logs = []
    page.on("console", lambda m: logs.append(f"{m.type}: {m.text}"))
    page.on("pageerror", lambda e: logs.append(f"pageerror: {e}"))
    page.goto(url)
    page.wait_for_function("window.__ready === true", timeout=120000)
    page.wait_for_timeout(1500)
    page.screenshot(path=out)
    b.close()
print("\n".join(logs) or "no console output")
print("saved", out)
