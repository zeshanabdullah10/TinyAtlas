"""End-to-end smoke test of the app against the running server (start it first).

Landing page (hero, two cards with real stats, six-era timeline, no horizontal scroll on a phone) -> open the map from the
hero button -> both Atlas packs load and report draw statistics -> the "Plan a day" sheet and the offline dialog open ->
no console errors anywhere.

    python backend/tools/smoke.py [base_url]   (default http://127.0.0.1:8000)
"""
import os
import sys

from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000").rstrip("/")
GL = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
# Use the Playwright Chromium when this machine has it (the sandbox has no Edge); otherwise Playwright's default browser.
CHROMIUM = "/opt/pw-browsers/chromium"
errors, fails = [], []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (f"  {detail}" if detail and not ok else ""))
    if not ok:
        fails.append(name)


with sync_playwright() as p:
    kw = {"executable_path": CHROMIUM} if os.path.exists(CHROMIUM) else {}
    b = p.chromium.launch(args=GL, **kw)

    def new_page(w, h):
        page = b.new_page(viewport={"width": w, "height": h})
        # "Failed to load resource" lines carry no URL, so judge HTTP failures by the response itself: the only expected
        # 404s are empty tree tiles (packs/<slug>/atlas/trees/*.bin); CDN hiccups (fonts, three.js) are not app errors.
        page.on("response", lambda r: r.status >= 400 and "/atlas/trees/" not in r.url and errors.append(f"HTTP {r.status} {r.url}"))
        page.on("console", lambda m: m.type == "error" and "Failed to load resource" not in m.text and errors.append(m.text))
        page.on("pageerror", lambda e: errors.append(str(e)))
        return page

    # --- landing page, desktop and phone
    for w, h, tag in ((1440, 900, "desktop"), (390, 844, "phone")):
        page = new_page(w, h)
        page.goto(f"{BASE}/")
        page.wait_for_function("window.__ready === true", timeout=30000)
        check(f"{tag}: two region cards", page.locator(".card").count() == 2)
        check(f"{tag}: six timeline eras", page.locator(".era").count() == 6)
        check(f"{tag}: title and map button", page.text_content("h1") == "Swat Valley" and page.get_by_role("link", name="Open the map").first.is_visible())
        check(f"{tag}: no sideways page scroll", page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_function("[...document.querySelectorAll('.card img')].every(i => i.complete && i.naturalWidth > 0)", timeout=30000)
        check(f"{tag}: card pictures load", True)
        if tag == "desktop":
            page.evaluate("window.scrollTo(0, 0)")
            page.get_by_role("link", name="Open the map").first.click()
            page.wait_for_function("window.__ready === true && window.__atlas", timeout=180000)
            check("hero button opens the Swat map", "pack=swat" in page.url and page.evaluate("window.__atlas.info().calls") > 0)
            # --- planner sheet and offline dialog
            page.locator(".lbl:not(.off) .chip").first.click(force=True)
            page.get_by_role("button", name="Plan a day").first.click()
            page.wait_for_selector(".sheet:not([hidden])", timeout=10000)
            check("planner sheet opens", True)
            page.keyboard.press("Escape")
            page.locator(".off-btn").click()
            page.wait_for_selector(".modal", timeout=10000)
            check("offline dialog opens", True)
            page.keyboard.press("Escape")
            page.evaluate("window.__switch('swat-lower')")
            page.wait_for_function("window.__ready === true", timeout=180000)
            check("Lower Swat pack loads", page.evaluate("window.__atlas.info().calls") > 0)
        page.close()
    b.close()

check("no console errors", not errors, "; ".join(errors[:5]))
print("\nALL PASSED" if not fails else f"\nFAILED: {fails}")
sys.exit(1 if fails else 0)
