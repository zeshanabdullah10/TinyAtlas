"""Headless screenshot of the viewer (uses installed Edge; no browser download).

    python backend/tools/screenshot.py [url] [out.png] [--open SLUG] [--ask "question"] [--frame T]

--open   open a landmark's story card (what clicking it does)
--ask    type a question into the guide chat and wait for the answer
--frame  render flyover frame at T in [0, 1] instead of the orbit view
"""
import argparse

from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument("url", nargs="?", default="http://localhost:8000/?region=hunza")
ap.add_argument("out", nargs="?", default="shot.png")
ap.add_argument("--open")
ap.add_argument("--ask")
ap.add_argument("--frame", type=float)
a = ap.parse_args()

with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge", args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    page = b.new_page(viewport={"width": 1280, "height": 800})
    logs = []
    page.on("console", lambda m: logs.append(f"{m.type}: {m.text}"))
    page.on("pageerror", lambda e: logs.append(f"pageerror: {e}"))
    page.goto(a.url)
    page.wait_for_function("window.__ready === true", timeout=120000)
    if a.open:
        page.evaluate(f"window.__open({a.open!r})")
        page.wait_for_function("!document.querySelector('#story').textContent.includes('Loading')", timeout=60000)
        page.wait_for_timeout(1500)  # camera focus animation
    if a.ask:
        page.fill("#q", a.ask)
        page.press("#q", "Enter")
        page.wait_for_function("!document.querySelector('#log .a:last-child').textContent.startsWith('…')", timeout=60000)
    if a.frame is not None:
        page.evaluate(f"window.renderFrame({a.frame})")
    page.wait_for_timeout(800)
    page.screenshot(path=a.out)
    b.close()
print("\n".join(logs) or "no console output")
print("saved", a.out)
