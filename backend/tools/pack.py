"""Build the static site: the web app plus the Atlas packs, servable from any CDN (GitHub Pages included).

    python backend/tools/pack.py                                  # both Swat packs -> dist/
    python backend/tools/pack.py swat --api https://api.example.org --base-url https://user.github.io/tinyatlas

dist/ gets the contents of web/ (landing page, atlas.html, css, js, data/home.json, img/), plus
dist/packs/<slug>/atlas/ for each pack (data/packs/<slug>/atlas/, minus debug files), the audio clips when
data/audio/<slug>/ has them, a sitemap with the landing page and each map, and robots.txt.
`--api` is the live server the static site calls for the day planner; without it the planner says it is unavailable.
`--base-url` is the public URL of the site: it sets the subpath (GitHub Pages) and the canonical/Open Graph links.
"""
import argparse
import json
import re
import shutil
import sys
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tinyatlas import regions  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def _base_path(base_url: str) -> str:
    """The site's path prefix: '/tinyatlas/' for https://host/tinyatlas, '' at a domain root."""
    p = urlparse(base_url).path.rstrip("/")
    return p + "/" if p else ""


def static_index(html: str, live_api: str | None, base: str = "", base_url: str = "") -> str:
    """A page for the static site: tells the app to read packs, where the live planner is, and its subpath.
    `base_url` (optional) turns the page's relative Open Graph image into an absolute URL and adds the canonical link."""
    cfg = json.dumps({"static": True, "api": live_api or "", "base": base})
    if base:                                                        # root-absolute assets need the path prefix (GitHub Pages)
        html = re.sub(r'(href|src)="/', rf'\1="{base}', html)
    if base_url:
        html = html.replace('content="img/', f'content="{base_url}/img/')
        html = html.replace("</head>", f'<link rel="canonical" href="{base_url}/">\n</head>', 1)
    return html.replace("<script type=\"module\"", f"<script>window.TINYATLAS = {cfg};</script>\n<script type=\"module\"", 1)


def write_atlas_pack(slug: str, out: Path, log=print) -> int:
    """Copy an Atlas pack (data/packs/<slug>/atlas/) to out/packs/<slug>/atlas/, with its audio clips when it has any.
    Returns the size in bytes."""
    src, dst = ROOT / "data" / "packs" / slug / "atlas", out / "packs" / slug / "atlas"
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns("_check.png", "_bake"))
    audio = ROOT / "data" / "audio" / slug
    if (audio / "audio.json").exists():                              # same layout api.js reads in a static build
        clips = json.loads((audio / "audio.json").read_text(encoding="utf-8"))
        (out / "packs" / slug / "audio").mkdir(parents=True, exist_ok=True)
        for langs in clips.values():
            for clip in langs.values():
                shutil.copyfile(audio / clip["file"], out / "packs" / slug / "audio" / clip["file"])
        shutil.copyfile(audio / "audio.json", out / "packs" / slug / "audio.json")
    size = sum(f.stat().st_size for f in (out / "packs" / slug).rglob("*") if f.is_file())
    log(f"{slug}: Atlas pack, {size / 1e6:.1f} MB")
    return size


def build_site(slugs: list[str], out: Path, live_api: str | None = None, log=print, base_url: str = "") -> None:
    if (out / "packs").exists():
        shutil.rmtree(out / "packs")
    shutil.copytree(ROOT / "web", out, dirs_exist_ok=True)
    base = _base_path(base_url)
    for page in ("index.html", "atlas.html"):                         # same static config on both: packs come from <base>packs/
        html = static_index((ROOT / "web" / page).read_text(encoding="utf-8"), live_api, base, base_url if page == "index.html" else "")
        (out / page).write_text(html, encoding="utf-8")
    for slug in slugs:
        write_atlas_pack(regions.REGIONS[slug]["atlas"], out, log)
    urls = [f"{base_url}/"] + [f"{base_url}/atlas.html?pack={regions.REGIONS[s]['atlas']}" for s in slugs]
    (out / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                                     + "".join(f"<url><loc>{u.replace('&', '&amp;')}</loc></url>" for u in urls) + "</urlset>\n", encoding="utf-8")
    (out / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {base_url}/sitemap.xml\n", encoding="utf-8")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("slugs", nargs="*", help="regions to pack (default: both Swat packs)")
    ap.add_argument("--out", default=str(ROOT / "dist"))
    ap.add_argument("--api", help="URL of the live Tiny Atlas server, for the day planner")
    ap.add_argument("--base-url", default="", help="public URL of the static site, for canonical links and the sitemap")
    a = ap.parse_args()
    build_site(a.slugs or list(regions.REGIONS), Path(a.out), a.api, base_url=a.base_url.rstrip("/"))
