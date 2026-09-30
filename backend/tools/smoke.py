"""End-to-end smoke test against the running app (server must be up):
load Hunza -> real mouse click on a landmark -> story card -> ask the guide -> unanswerable question is refused
-> no console errors.

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
    page = b.new_page(viewport={"width": 1280, "height": 800})
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{BASE}/?region=hunza")
    page.wait_for_function("window.__ready === true", timeout=120000)
    check("landmarks loaded", page.evaluate("window.__landmarks") >= 5)

    pos = page.evaluate("window.__project('baltit-fort')")
    page.mouse.click(pos["x"], pos["y"])                       # a real click, through the raycaster
    page.wait_for_function("document.querySelector('#story h2')?.textContent === 'Baltit Fort'", timeout=30000)
    page.wait_for_function("!document.querySelector('#story').textContent.includes('Loading')", timeout=30000)
    story = page.inner_text("#story")
    check("click opens Baltit Fort story", "palatial fort" in story, story[:120])
    check("story links its source", page.locator("#story a[href*='wikipedia.org']").count() == 1)

    def ask(q):
        n = page.locator("#log .a").count()
        page.fill("#q", q); page.press("#q", "Enter")
        page.wait_for_function(f"document.querySelectorAll('#log .a').length > {n} && "
                               "!document.querySelector('#log .a:last-child').textContent.startsWith('…')", timeout=60000)
        return page.inner_text("#log .a:last-child")

    a = ask("How did Attabad Lake form?")
    check("guide answers with a citation", "landslide" in a and "[1]" in a, a[:150])
    check("guide cites a wikipedia link", page.locator("#log .a:last-child a[href*='wikipedia.org']").count() >= 1)
    r = ask("Where is the best pizza restaurant with wifi?")
    check("guide refuses what the sources don't cover", "isn't in my sources" in r, r[:150])

    page.evaluate("window.renderFrame(0.5)")
    page.screenshot(path="smoke.png")
    b.close()

check("no console errors", not errors, "; ".join(errors)[:300])
print("\nSMOKE " + ("FAILED: " + ", ".join(fails) if fails else "PASSED"))
sys.exit(1 if fails else 0)
