"""End-to-end smoke test against the running app (server must be up).

Home gallery lists built places -> open Hunza -> real mouse click on a landmark -> placard with photo and source
-> ask the guide (cited answer) -> unanswerable question is refused -> real sun and autumn -> panorama from Karimabad
-> view previews -> go mode -> flyover frame renders -> no console errors.

    python backend/tools/smoke.py [base_url]
"""
import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
GL = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
errors, fails = [], []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (f"  {detail}" if detail and not ok else ""))
    if not ok:
        fails.append(name)


with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge", args=GL)
    page = b.new_page(viewport={"width": 1440, "height": 900})
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(f"{BASE}/")
    page.wait_for_function("window.__ready === true", timeout=60000)
    page.wait_for_selector(".frame a", timeout=30000)
    check("gallery lists the built places", page.locator(".frame a").count() >= 5)
    page.mouse.wheel(0, 4000)                                  # lazy thumbnails below the fold only load on scroll
    page.wait_for_function("[...document.querySelectorAll('.mat img')].length > 0 && "
                           "[...document.querySelectorAll('.mat img')].every(i => i.complete && i.naturalWidth > 0)",
                           timeout=60000)
    check("gallery images load", True)

    page.goto(f"{BASE}/?region=hunza")
    page.wait_for_function("window.__ready === true", timeout=180000)
    check("landmarks loaded", page.evaluate("window.__landmarks") >= 5)
    check("route rail lists stops", page.locator(".stop").count() >= 5)
    check("route stats shown", "along the route" in page.inner_text(".rail .stats"))

    pos = page.evaluate("window.__project('baltit-fort')")
    page.mouse.click(pos["x"], pos["y"])                                       # a real click, through the raycaster
    page.wait_for_function("document.querySelector('.placard h2')?.textContent === 'Baltit Fort'", timeout=30000)
    page.wait_for_function("!document.querySelector('.placard .story')?.textContent.startsWith('Reading up')", timeout=60000)
    story = page.inner_text(".placard .story")
    check("click opens the Baltit Fort placard with a story", len(story) > 60 and "baltit" in story.lower() + page.inner_text(".placard h2").lower(), story[:120])
    check("placard has a photo and a source link", page.locator(".placard .photo img").count() == 1 and page.locator(".placard a.src[href*='wikipedia.org']").count() == 1)
    check("url records the selected landmark", "lm=baltit-fort" in page.url)
    check("route list highlights the stop", page.locator(".stop[aria-current='true']").count() == 1)

    def ask(q):
        n = page.locator(".msg.a").count()
        page.fill("#q", q); page.press("#q", "Enter")
        page.wait_for_function(f"document.querySelectorAll('.msg.a').length > {n} && !document.querySelector('.msg.a:last-child').classList.contains('think')", timeout=90000)
        return page.inner_text(".msg.a:last-child")

    page.click("#tab-guide")
    a = ask("How did Attabad Lake form?")
    check("guide answers with a citation", "landslide" in a.lower() and "[1]" in a, a[:150])
    check("guide cites a wikipedia link", page.locator(".msg.a:last-child a[href*='wikipedia.org']").count() >= 1)
    r = ask("Where is the best pizza restaurant with wifi?")
    check("guide refuses what the sources don't cover", "isn't in my sources" in r, r[:150])

    # real sun and seasons: an October evening lights the terrain and switches to the autumn texture
    page.evaluate("window.__sun('2026-10-12', '17:00')")
    page.wait_for_timeout(1500)
    check("real sun lights the terrain", page.evaluate("window.__dio.terrain.material.uniforms.uReal.value") == 1)
    check("the date picks the autumn season", page.locator(".segs.seasons .seg[aria-pressed='true']").inner_text() == "Autumn")

    # what can I see from Karimabad: Rakaposhi and Diran to the south
    page.evaluate("window.__view(36.329, 74.666, 'Karimabad')")
    page.wait_for_selector(".pano-peaks .chip", timeout=60000)
    peaks = page.inner_text(".pano-peaks")
    check("panorama names Rakaposhi and Diran from Karimabad", "Rakaposhi" in peaks and "Diran" in peaks, peaks[:200])
    page.keyboard.press("Escape")

    # see the view before you go
    if page.locator("#tab-views").count():
        page.click("#tab-views")
        page.wait_for_function("[...document.querySelectorAll('.vfig img')].some(i => i.complete && i.naturalWidth > 0)", timeout=30000)
        check("views tab shows labelled previews", page.locator(".vfig .vlabel").count() >= 1)
    else:
        check("views tab exists (run backend/tools/previews.py)", False)

    # the audio guide plays from the landmark placard
    page.evaluate("window.__open('baltit-fort')")
    page.click("#tab-place")
    page.wait_for_selector(".placard .listen", timeout=30000)
    page.click(".placard .listen-play")
    page.wait_for_function("window.__listen().playing", timeout=30000)
    check("placard plays the audio guide", True)
    check("placard offers languages and read-along", page.locator(".placard .listen-langs .seg").count() >= 2
          and page.locator(".placard .listen-text summary").count() == 1)

    page.evaluate("window.renderFrame(0.5)")
    pose = page.evaluate("window.__flyPose(0.5)")
    check("flyover pose is above the terrain", pose is not None and pose["cam"][1] > 0)
    page.screenshot(path="smoke.png")
    b.close()

check("no console errors", not errors, "; ".join(errors)[:300])
print("\nSMOKE " + ("FAILED: " + ", ".join(fails) if fails else "PASSED"))
sys.exit(1 if fails else 0)
