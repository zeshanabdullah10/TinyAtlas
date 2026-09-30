"""Export a flyover video and a print poster from the running viewer (server must be up).

    python backend/tools/export.py video  [region] [--seconds 20] [--fps 24]
    python backend/tools/export.py poster [region] [--scale 3]

Needs: playwright + an installed Edge/Chrome, and ffmpeg (FFMPEG env var, PATH, or D:\ffmpeg\bin).
Output goes to data/export/. The in-page attribution (OSM ODbL / Wikipedia CC BY-SA) is part of every frame.
"""
import argparse
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import httpx
from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "export"
BASE = os.environ.get("TINYATLAS_URL", "http://localhost:8000")
GL = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]


def ffmpeg() -> str:
    found = os.environ.get("FFMPEG") or shutil.which("ffmpeg")
    if found:
        return found
    for cand in (r"D:\ffmpeg\bin\ffmpeg.exe", r"C:\ffmpeg\bin\ffmpeg.exe"):
        if Path(cand).exists():
            return cand
    raise SystemExit("ffmpeg not found: set FFMPEG or add it to PATH")


def video(region: str, seconds: float, fps: int, w: int = 1280, h: int = 720) -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    n = int(seconds * fps)
    tmp = Path(tempfile.mkdtemp(prefix="tinyatlas_frames_"))
    with sync_playwright() as p:
        b = p.chromium.launch(channel="msedge", args=GL)
        page = b.new_page(viewport={"width": w, "height": h})
        page.goto(f"{BASE}/?region={region}&clean=1")
        page.wait_for_function("window.__ready === true", timeout=120000)
        for i in range(n):
            page.evaluate(f"window.renderFrame({i / (n - 1)})")
            page.screenshot(path=str(tmp / f"f_{i:04d}.jpg"), type="jpeg", quality=92)
            if i % 48 == 0:
                print(f"frame {i}/{n}", flush=True)
        b.close()
    out = OUT / f"{region}_flyover.mp4"
    subprocess.run([ffmpeg(), "-y", "-loglevel", "error", "-framerate", str(fps), "-i", str(tmp / "f_%04d.jpg"),
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", str(out)], check=True)
    shutil.rmtree(tmp, ignore_errors=True)
    return out


def font(size: int):
    for f in ("arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            pass
    return ImageFont.load_default()


def poster(region: str, scale: int) -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    info = httpx.get(f"{BASE}/api/region/{region}", timeout=30).json()
    title = info["name"] + (f", {info['subtitle']}" if info.get("subtitle") else "")
    png = OUT / f"{region}_poster_raw.png"
    with sync_playwright() as p:
        b = p.chromium.launch(channel="msedge", args=GL)
        page = b.new_page(viewport={"width": 1600, "height": 1000}, device_scale_factor=scale)
        page.goto(f"{BASE}/?region={region}&clean=1")
        page.wait_for_function("window.__ready === true", timeout=120000)
        page.wait_for_timeout(1500)
        page.screenshot(path=str(png))
        b.close()
    art = Image.open(png).convert("RGB")
    band = art.height // 9
    sheet = Image.new("RGB", (art.width, art.height + band), (220, 223, 214))
    sheet.paste(art, (0, band))
    d = ImageDraw.Draw(sheet)
    d.text((art.width // 2, band // 2), title, fill=(44, 55, 51), font=font(band // 2), anchor="mm")
    pdf = OUT / f"{region}_poster.pdf"
    sheet.save(pdf, resolution=art.width / 16)          # 16 in wide
    sheet.resize((1600, round(1600 * sheet.height / sheet.width))).save(OUT / f"{region}_poster_preview.png")
    png.unlink()
    return pdf


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("what", choices=["video", "poster"])
    ap.add_argument("region", nargs="?", default="hunza")
    ap.add_argument("--seconds", type=float, default=20)
    ap.add_argument("--fps", type=int, default=24)
    ap.add_argument("--scale", type=int, default=3)
    a = ap.parse_args()
    if a.what == "video":
        print("wrote", video(a.region, a.seconds, a.fps))
    else:
        print("wrote", poster(a.region, a.scale))
