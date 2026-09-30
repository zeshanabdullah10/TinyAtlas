"""Headless screenshot of the app (uses installed Edge; no browser download).

    python backend/tools/screenshot.py [url] [out.png] [--open SLUG] [--ask "question"] [--frame T]
                                       [--size 1280x800] [--tab guide] [--click SELECTOR] [--wait MS]

--open   select a landmark (what clicking it does) and wait for its story
--ask    open the guide and ask a question, waiting for the answer
--frame  render flyover frame T in [0, 1] instead of the orbit view
--click  click a CSS selector before the screenshot (e.g. ".toolbar .btn")
--sun    light with the real sun at "YYYY-MM-DD HH:MM" on the place's clock
--eval   run JavaScript in the page first, e.g. "window.__view(36.329, 74.666, 'Karimabad')"
"""
import argparse

from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument("url", nargs="?", default="http://localhost:8000/?region=hunza")
ap.add_argument("out", nargs="?", default="shot.png")
ap.add_argument("--open")
ap.add_argument("--ask")
ap.add_argument("--frame", type=float)
ap.add_argument("--size", default="1280x800")
ap.add_argument("--click")
ap.add_argument("--eval", help="run this JavaScript in the page before the screenshot")
ap.add_argument("--sun", help='light with the real sun at "YYYY-MM-DD HH:MM" on the place\'s clock')
ap.add_argument("--wait", type=int, default=600)
a = ap.parse_args()
w, h = (int(v) for v in a.size.split("x"))

with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge", args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    page = b.new_page(viewport={"width": w, "height": h})
    logs = []
    page.on("console", lambda m: logs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: logs.append(f"pageerror: {e}"))
    page.goto(a.url)
    page.wait_for_function("window.__ready === true", timeout=180000)
    if a.open:
        page.evaluate(f"window.__open({a.open!r})")
        page.wait_for_function("!document.querySelector('.placard .story')?.textContent.startsWith('Reading up')", timeout=90000)
        page.wait_for_timeout(1400)  # camera focus animation
    if a.ask:
        page.click("#tab-guide")
        page.fill("#q", a.ask)
        page.press("#q", "Enter")
        page.wait_for_function("document.querySelector('.msg.a:last-child') && !document.querySelector('.msg.a:last-child').classList.contains('think')", timeout=90000)
    if a.sun:
        date, _, hhmm = a.sun.partition(" ")
        page.evaluate(f"window.__sun({date!r}, {hhmm!r})")
        page.wait_for_timeout(400)            # shadows are cast on the next frame
    if a.eval:
        page.evaluate(a.eval)
    if a.click:
        page.click(a.click)
    if a.frame is not None:
        page.evaluate(f"window.renderFrame({a.frame})")
    page.wait_for_timeout(a.wait)
    page.screenshot(path=a.out)
    b.close()
print("\n".join(logs) or "no console problems")
print("saved", a.out)
