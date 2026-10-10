"""Headless screenshots of a diorama site, for checking a build by eye.

    python backend/tools/diorama_shot.py <site> <out_dir> [--shots table,lake,close,ground,walk] [--size 1280x800]

Serves web/ on a local port, opens diorama.html?site=<site> in Playwright Chromium (software WebGL), and writes one
PNG per shot plus console.txt (every console message and page error: read it, a module error shows up only here):
  table   the whole tabletop model, as the page opens
  lake    the overview the page shows on arrival (?view=lake)
  close   a camera 3x the landmark size away (or 120 m from the arrival point), 30 degrees up, looking at it
  ground  eye height (1.7 m) 25 m in front of the landmark / arrival point, looking at it
  walk    the visitor's walk view after "Walk it yourself"
Software GL runs at under 1 fps, so the page is stepped with window.__diorama.advance() and drawn once per shot.
"""
import argparse
import functools
import http.server
import math
import socketserver
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

CAM = """([mode, dist]) => {
  document.getElementById("intro")?.setAttribute("hidden", "");
  const d = window.__diorama, m = d.site.meta, lm = m.landmark, a = m.arrival, Y0 = d.site.Y0;
  const x = lm ? lm.x : a.x, z = lm ? lm.z : a.z, gy = d.site.heightAt(x, z);
  const end = d.path.at(d.path.length);
  let dx = end.x - x, dz = end.z - z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;   // from the landmark toward the road
  const cam = d.camera;
  d.setEnv?.("real");                                   // sky, horizon ring and fog, as the visitor sees it on the ground
  if (mode === "close") {
    const D = dist, el = 0.52;
    cam.position.set(x + dx * D * Math.cos(el), gy + D * Math.sin(el), z + dz * D * Math.cos(el));
    cam.lookAt(x, gy + Math.min(D * 0.08, 10), z);
  } else {
    const px = x + dx * dist, pz = z + dz * dist;
    cam.position.set(px, d.site.heightAt(px, pz) + 1.7, pz);
    cam.lookAt(x, gy + 4, z);
  }
  cam.near = 0.2; cam.updateProjectionMatrix();
  d.renderer.render(d.scene, cam);
  return [x, gy + Y0, z];
}"""


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    h = functools.partial(Quiet, directory=str(ROOT / "web"))
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv.server_address[1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("site"); ap.add_argument("out")
    ap.add_argument("--shots", default="table,lake,close,ground")
    ap.add_argument("--size", default="1280x800")
    ap.add_argument("--close-m", type=float, default=0, help="distance for the close shot (default from the landmark)")
    a = ap.parse_args()
    from playwright.sync_api import sync_playwright
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    W, H = map(int, a.size.split("x"))
    port = serve()
    log = []
    import sys
    sys.path.insert(0, str(Path(__file__).parent))
    from slots import slot
    with slot("render", 2), sync_playwright() as p:      # software GL is heavy: two renders at a time on this machine
        exe = next((str(x) for x in (Path("/opt/pw-browsers/chromium"),) if x.exists()), None)   # a preinstalled Chromium, when the pinned one is absent
        b = p.chromium.launch(executable_path=exe, args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        for shot in a.shots.split(","):
            pg = b.new_page(viewport={"width": W, "height": H})
            pg.on("console", lambda msg, s=shot: log.append(f"[{s}] {msg.type}: {msg.text}"))
            pg.on("pageerror", lambda err, s=shot: log.append(f"[{s}] PAGEERROR: {err}"))
            q = "&view=lake" if shot == "lake" else ""
            pg.goto(f"http://127.0.0.1:{port}/diorama.html?site={a.site}&tier=low{q}", wait_until="load", timeout=120000)
            pg.wait_for_function("window.__diorama", timeout=180000)
            pg.wait_for_timeout(4000)                           # GLB and module parts load asynchronously
            pg.evaluate("window.__diorama.advance(3)")
            if shot == "walk":
                pg.evaluate("window.__diorama.emit('walk')"); pg.evaluate("window.__diorama.advance(4)")
            if shot in ("close", "ground"):
                size = pg.evaluate("(() => { const m = window.__diorama.site.meta; return m.landmark ? (m.landmark.top_m || 20) : 0; })()")
                dist = a.close_m or (max(60.0, size * 3.5) if shot == "close" else max(25.0, size * 1.6))
                if not a.close_m and not size:
                    dist = 120.0 if shot == "close" else 30.0
                pg.evaluate(f"({CAM})(['{shot}', {dist}])")
            pg.screenshot(path=str(out / f"{shot}.png"))
            pg.close()
        b.close()
    (out / "console.txt").write_text("\n".join(log) or "(no console output)", encoding="utf-8")
    errs = [l for l in log if ("PAGEERROR" in l or "error" in l.lower().split(":")[0]) and "404" not in l]   # optional files (photos.json) may be absent
    print(f"wrote {a.shots} to {out}; {len(errs)} console errors" + ("".join("\n  " + e[:300] for e in errs[:10])))


if __name__ == "__main__":
    main()
