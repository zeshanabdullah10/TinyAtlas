"""Home-page thumbnails of the site models: a real render of each tabletop, canvas only.

    python3 backend/tools/diorama_thumbs.py                 # every site (about a minute each on software GL)
    python3 backend/tools/diorama_thumbs.py kalam ushu      # just these
    options: --az DEG   turn the view round the model (default 0 = the page's own table-view bearing)
             --el DEG   camera elevation (default 36; the page's table view is 23, which hides low terrain behind the front wall)
             --fill F   share of the frame the model covers (default 0.9)
             --keep DIR also saves the 1280x800 PNGs

Opens diorama.html?site=<site> in Playwright Chromium (software WebGL, one shared render slot), hides all page chrome,
refits the page's table-view camera to the model's bounds so it fills the picture, and captures the canvas.
Writes web/img/dioramas/<site>.webp (640x400, q80) and <site>-320.webp. Then run backend/tools/dioramas_index.py."""
import argparse
import functools
import http.server
import io
import socketserver
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "web" / "img" / "dioramas"
sys.path.insert(0, str(Path(__file__).parent))

HIDE = "body > *:not(#app), #app > *:not(canvas) { display: none !important; } html, body { background: #15120f; overflow: hidden; }"

FIT = """([az, el, fill]) => {
  const d = window.__diorama, cam = d.camera, V = cam.position.constructor, g = d.site.meta.grid, s = d.site;
  document.getElementById("intro")?.setAttribute("hidden", "");
  cam.clearViewOffset();
  const x0 = s.x0, x1 = s.x0 + g.width, z0 = s.z0, z1 = s.z0 + g.height, y0 = g.hmin - s.Y0 - 120, y1 = g.hmax - s.Y0;
  const corners = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) corners.push(new V(x, y, z));
  const a = (az + 37) * Math.PI / 180, e = el * Math.PI / 180;       // az 0 = the page's own table-view bearing (SE)
  const dir = new V(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
  const target = new V((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); let dist = Math.max(g.width, g.height) * 2;
  cam.far = Math.max(cam.far, 60000);
  for (let it = 0; it < 14; it++) {
    cam.position.copy(target).addScaledVector(dir, dist); cam.lookAt(target); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    let a0 = 9, a1 = -9, b0 = 9, b1 = -9;
    for (const p of corners) { const q = p.clone().project(cam); a0 = Math.min(a0, q.x); a1 = Math.max(a1, q.x); b0 = Math.min(b0, q.y); b1 = Math.max(b1, q.y); }
    const k = Math.max((a1 - a0) / 2, (b1 - b0) / 2) / fill;
    const right = new V().setFromMatrixColumn(cam.matrixWorld, 0), up = new V().setFromMatrixColumn(cam.matrixWorld, 1), half = dist * Math.tan(cam.fov * Math.PI / 360);
    target.addScaledVector(right, ((a0 + a1) / 2) * half * cam.aspect).addScaledVector(up, ((b0 + b1) / 2) * half);
    dist *= k;
  }
  cam.position.copy(target).addScaledVector(dir, dist); cam.lookAt(target); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  d.renderer.render(d.scene, cam);
  return Math.round(dist);
}"""


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    h = functools.partial(Quiet, directory=str(ROOT / "web"))
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv.server_address[1]


def all_sites():
    return sorted(p.parent.name for p in (ROOT / "web" / "data" / "diorama").glob("*/meta.json"))


def shoot(browser, port, site, az, el, fill, keep):
    from PIL import Image
    log = []
    pg = browser.new_page(viewport={"width": 1280, "height": 800})
    pg.on("console", lambda m: log.append(f"{m.type}: {m.text}"))
    pg.on("pageerror", lambda e: log.append(f"PAGEERROR: {e}"))
    try:
        pg.goto(f"http://127.0.0.1:{port}/diorama.html?site={site}&tier=low", wait_until="load", timeout=120000)
        pg.wait_for_function("window.__diorama", timeout=240000)
        pg.wait_for_timeout(5000)                                   # GLB and module parts settle
        pg.evaluate("window.__diorama.advance(3)")
        pg.add_style_tag(content=HIDE)
        pg.evaluate(FIT, [az, el, fill])
        png = pg.screenshot(clip={"x": 0, "y": 0, "width": 1280, "height": 800}, timeout=240000)   # chrome is hidden: the page is the canvas
        im = Image.open(io.BytesIO(png)).convert("RGB")
        if im.size != (1280, 800):
            im = im.resize((1280, 800), Image.LANCZOS)
        if keep:
            Path(keep).mkdir(parents=True, exist_ok=True); im.save(Path(keep) / f"{site}.png")
        OUT.mkdir(parents=True, exist_ok=True)
        im.resize((640, 400), Image.LANCZOS).save(OUT / f"{site}.webp", quality=80, method=6)
        im.resize((320, 200), Image.LANCZOS).save(OUT / f"{site}-320.webp", quality=80, method=6)
    finally:
        pg.close()
    return [l for l in log if l.startswith("PAGEERROR") or (l.startswith("error") and "404" not in l)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sites", nargs="*")
    ap.add_argument("--az", type=float, default=0); ap.add_argument("--el", type=float, default=36); ap.add_argument("--fill", type=float, default=0.9)
    ap.add_argument("--keep", default="")
    a = ap.parse_args()
    from playwright.sync_api import sync_playwright
    from slots import slot
    todo = a.sites or all_sites()
    unknown = [s for s in todo if s not in all_sites()]
    if unknown:
        sys.exit(f"unknown site(s): {', '.join(unknown)}")
    port = serve()
    with sync_playwright() as p:
        exe = next((str(x) for x in (Path("/opt/pw-browsers/chromium"),) if x.exists()), None)
        b = p.chromium.launch(executable_path=exe, args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        for site in todo:
            for attempt in (1, 2, 3):                                   # software GL under load can time out
                try:
                    with slot("render", 2):
                        errs = shoot(b, port, site, a.az, a.el, a.fill, a.keep)
                    break
                except Exception as e:
                    print(f"{site}: attempt {attempt} failed: {str(e).splitlines()[0][:150]}", flush=True)
            else:
                continue
            print(f"{site}: ok" + ("".join("\n  " + e[:200] for e in errs[:5])), flush=True)
        b.close()


if __name__ == "__main__":
    main()
