"""Build the static site: the web app plus one pack of files per place, servable from any CDN.

    python backend/tools/pack.py                     # every ready region -> dist/
    python backend/tools/pack.py hunza skardu --api https://api.example.org --out dist

A pack is dist/packs/<slug>/ with region.json, landmarks.json, itinerary.json, stories.json, terrain.bin,
texture.webp, thumb.jpg and manifest.json; dist/packs/index.json lists the packed places. Everything is computed
in-process through the same functions the API serves, so a pack is exactly what the server would have answered.
`--api` is the live server the static site calls for the guide; without it the guide says it is unavailable.
"""
import argparse
import json
import re
import shutil
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PIL import Image  # noqa: E402

from tinyatlas import api, regions  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
TERRAIN_SIZE = 320                      # what the viewer asks for (place.js)


def _write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def write_pack(slug: str, out: Path, log=print) -> dict:
    """Write one place's pack under out/packs/<slug>/ and return its manifest."""
    d = out / "packs" / slug
    d.mkdir(parents=True, exist_ok=True)
    region = api.region_details(slug)
    landmarks = api.region_landmarks(slug)
    _write_json(d / "region.json", region)
    _write_json(d / "landmarks.json", landmarks)
    _write_json(d / "itinerary.json", api.region_itinerary(slug))
    stories = {}
    for lm in landmarks:
        stories[lm["slug"]] = api.landmark_story(slug, lm["slug"])
    _write_json(d / "stories.json", stories)
    (d / "terrain.bin").write_bytes(api.terrain_mesh(slug, size=TERRAIN_SIZE).body)
    (d / "horizon.bin").write_bytes(api.horizon_grid(slug).body)
    (d / "near.bin").write_bytes(api.near_grid(slug).body)
    _write_json(d / "peaks.json", api.region_peaks(slug))
    views = api.region_views(slug)
    if views:
        (d / "views").mkdir(exist_ok=True)
        for v in views:
            for season in v["images"].values():
                for tod, name in season.items():
                    im = Image.open(api.VIEWS / slug / name).convert("RGB")
                    im.thumbnail((1024, 1024))
                    webp = name.replace(".jpg", ".webp")
                    im.save(d / "views" / webp, quality=74, method=6)
                    season[tod] = webp
    _write_json(d / "views.json", views)
    _write_json(d / "facts.json", api.region_facts(slug))
    _write_json(d / "pois.json", api.region_pois(slug))
    audio = api.region_audio(slug)
    if audio:
        (d / "audio").mkdir(exist_ok=True)
        for langs in audio.values():
            for clip in langs.values():
                shutil.copyfile(api.AUDIO / slug / clip["file"], d / "audio" / clip["file"])
    _write_json(d / "audio.json", audio)
    for season in region["seasons"]:
        Image.open(api._texture_path(slug, season=season)).convert("RGB").save(d / f"texture_{season}.webp",
                                                                                quality=88, method=6)
    shutil.copyfile(api.region_thumb(slug, w=640).path, d / "thumb.jpg")
    files = {str(p.relative_to(d)).replace("\\", "/"): p.stat().st_size for p in sorted(d.rglob("*"))
             if p.is_file() and p.name != "manifest.json"}
    manifest = {"slug": slug, "name": region["name"], "built": time.strftime("%Y-%m-%d"), "files": files,
                "bytes": sum(files.values())}
    _write_json(d / "manifest.json", manifest)
    log(f"{slug}: {len(landmarks)} landmarks, {manifest['bytes'] / 1e6:.1f} MB")
    return manifest


TOPIC = {"getting_there": "Getting there", "getting_around": "Getting around", "when_to_go": "When to go",
         "permits": "Permits and fees", "health": "Altitude and health", "money": "Money and connectivity",
         "safety": "Staying safe", "respect": "Local customs"}
PAGE_CSS = """
body{margin:0;background:#e8eae3;color:#2c3733;font:400 17px/1.6 Literata,Georgia,serif}
main{max-width:980px;margin:0 auto;padding:24px 20px 80px}
a{color:#1f5c52}
header a{font:600 18px 'Schibsted Grotesk',system-ui;text-decoration:none;color:#2c3733}
h1{font:500 clamp(34px,6vw,58px)/1.05 'Schibsted Grotesk',system-ui;letter-spacing:-.03em;margin:28px 0 6px}
h2{font:600 22px 'Schibsted Grotesk',system-ui;margin:44px 0 10px}
h3{font:600 17px 'Schibsted Grotesk',system-ui;margin:22px 0 6px}
.sub{font-style:italic;color:#56625d;margin:0 0 18px}
.cta{display:inline-block;background:#1f5c52;color:#fbfaf6;font:500 16px 'Schibsted Grotesk',system-ui;padding:12px 20px;border-radius:2px;text-decoration:none;margin:10px 0}
figure{margin:18px 0;background:#fbfaf6;padding:10px;box-shadow:0 14px 30px -14px rgba(28,36,33,.5)}
figure img{width:100%;height:auto;display:block}
figcaption{font-size:14px;color:#56625d;padding-top:6px}
.views{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px}
ol.route{padding-left:22px} li{margin:4px 0}
.note{font-size:14px;color:#56625d}
"""


def place_page(slug: str, summary: dict, region: dict, views: list, facts: dict, itinerary: dict, base_url: str) -> str:
    """A plain, fast, indexable page about a place, linking into the 3D app."""
    from html import escape as e
    b = _base_path(base_url)                                        # root links only work with the site's path prefix
    name, sub = summary["name"], summary.get("subtitle", "")
    cover = summary.get("cover")
    title = f"{name}: 3D map, views, best time to visit and itinerary | Tiny Atlas"
    desc = (f"Explore {name} ({sub}) as a 3D miniature built from real terrain: see the view from the best spots in "
            f"every season, plan a trip on real roads, and get a free offline audio guide.")
    img = f"{b}packs/{slug}/views/{cover['image']}" if cover else f"{b}packs/{slug}/thumb.jpg"
    parts = [f"<header><a href='{b}'>Tiny Atlas</a></header><h1>{e(name)}</h1><p class='sub'>{e(sub)}</p>"]
    if region.get("intro"):
        parts.append(f"<p>{e(region['intro'])} <a href='{e(region.get('intro_url', ''))}'>Wikipedia</a></p>")
    parts.append(f"<a class='cta' href='{b}?region={slug}'>Open the 3D miniature of {e(name)}</a>")
    if views:
        parts.append(f"<h2>The view from the best spots</h2><div class='views'>")
        for v in views:
            season = next((s for s in ("autumn", "summer", "spring", "winter") if v["images"].get(s)), None)
            if not season:
                continue
            pic = v["images"][season].get("evening") or next(iter(v["images"][season].values()))
            peaks = ", ".join(l["name"] for l in v["labels"])
            parts.append(f"<figure><img loading='lazy' src='{b}packs/{slug}/views/{e(pic)}' alt='The view from {e(v['name'])}, {season}'>"
                         f"<figcaption><b>{e(v['name'])}</b>, standing at {v['elev']:,} m{'. In view: ' + e(peaks) if peaks else ''}. "
                         "AI preview painted over the real skyline.</figcaption></figure>")
        parts.append("</div>")
    if itinerary.get("stops"):
        parts.append(f"<h2>{e(itinerary.get('name') or 'A classic route')}</h2><ol class='route'>"
                     + "".join(f"<li>{e(s['name'])}</li>" for s in itinerary["stops"]) + "</ol>"
                     f"<p><a href='{b}?region={slug}'>Fly the route and plan your own days in the app</a>.</p>")
    if facts.get("facts"):
        parts.append("<h2>Know before you go</h2>")
        groups = {}
        for f in facts["facts"]:
            groups.setdefault(f["topic"], []).append(f)
        for topic, fs in groups.items():
            parts.append(f"<h3>{TOPIC.get(topic, topic)}</h3><ul>" + "".join(
                f"<li>{e(f['text'])} <a href='{e(f['url'])}'>{e(f['source'])}</a></li>" for f in fs) + "</ul>")
        parts.append(f"<p class='note'>From Wikivoyage and Wikipedia, checked {facts.get('checked') or 'recently'}. Confirm locally.</p>")
    parts.append("<p class='note'>Elevation: Mapzen and AWS Terrain Tiles. Map data © OpenStreetMap contributors (ODbL). "
                 "Text © Wikipedia and Wikivoyage contributors (CC BY-SA).</p>")
    ld = {"@context": "https://schema.org", "@type": "TouristDestination", "name": name, "description": desc,
          "geo": {"@type": "GeoCoordinates", "latitude": summary["center"][0], "longitude": summary["center"][1]},
          "image": base_url + img}
    return (f"<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
            f"<title>{e(title)}</title><meta name='description' content='{e(desc)}'>"
            f"<link rel='canonical' href='{base_url}/place/{slug}/'>"
            f"<meta property='og:title' content='{e(name)} in 3D | Tiny Atlas'><meta property='og:description' content='{e(desc)}'>"
            f"<meta property='og:image' content='{base_url}{img}'><meta name='twitter:card' content='summary_large_image'>"
            f"<link rel='preconnect' href='https://fonts.googleapis.com'>"
            f"<link rel='stylesheet' href='https://fonts.googleapis.com/css2?family=Literata:opsz,wght@7..72,400&family=Schibsted+Grotesk:wght@500;600&display=swap'>"
            f"<style>{PAGE_CSS}</style><script type='application/ld+json'>{json.dumps(ld).replace('<', chr(92) + 'u003c')}</script></head>"
            f"<body><main>{''.join(parts)}</main></body></html>")


def _base_path(base_url: str) -> str:
    """The site's path prefix: '/tinyatlas/' for https://host/tinyatlas, '' at a domain root."""
    p = urlparse(base_url).path.rstrip("/")
    return p + "/" if p else ""


def static_index(html: str, live_api: str | None, base: str = "") -> str:
    """index.html for the static site: tells the app to read packs, where the live guide is, and its subpath."""
    cfg = json.dumps({"static": True, "api": live_api or "", "base": base})
    if base:                                                        # local assets live under the base path (GitHub Pages)
        html = re.sub(r'(href|src)="/', rf'\1="{base}', html)
    return html.replace("<script type=\"module\"", f"<script>window.TINYATLAS = {cfg};</script>\n<script type=\"module\"", 1)


def write_atlas_pack(slug: str, out: Path, log=print) -> int:
    """Copy an Atlas pack (data/packs/<slug>/atlas/) to out/packs/<slug>/atlas/; returns its size in bytes."""
    src, dst = ROOT / "data" / "packs" / slug / "atlas", out / "packs" / slug / "atlas"
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns("_check.png", "_bake"))
    size = sum(f.stat().st_size for f in dst.rglob("*") if f.is_file())
    log(f"{slug}: Atlas pack, {size / 1e6:.1f} MB")
    return size


def build_site(slugs: list[str], out: Path, live_api: str | None = None, log=print, base_url: str = "") -> None:
    if (out / "packs").exists():
        shutil.rmtree(out / "packs")
    shutil.copytree(ROOT / "web", out, dirs_exist_ok=True)
    (out / "index.html").write_text(static_index((ROOT / "web" / "index.html").read_text(encoding="utf-8"), live_api,
                                                 _base_path(base_url)), encoding="utf-8")
    atlas_html = static_index((ROOT / "web" / "atlas.html").read_text(encoding="utf-8"), live_api, _base_path(base_url))
    (out / "atlas.html").write_text(atlas_html, encoding="utf-8")        # same static config: packs come from <base>/packs/
    index = {}
    for slug in slugs:
        if regions.REGIONS[slug].get("atlas"):       # drawn by the Atlas: just its pack, no classic place page
            write_atlas_pack(regions.REGIONS[slug]["atlas"], out, log)
            index[slug] = api._summary(slug, regions.REGIONS[slug])
            continue
        write_pack(slug, out, log)
        index[slug] = api._summary(slug, regions.REGIONS[slug])
        if index[slug]["cover"]:                                   # packs carry the previews as WebP
            index[slug]["cover"]["image"] = index[slug]["cover"]["image"].replace(".jpg", ".webp")
        d = out / "packs" / slug
        page = place_page(slug, index[slug], json.loads((d / "region.json").read_text(encoding="utf-8")),
                          json.loads((d / "views.json").read_text(encoding="utf-8")),
                          json.loads((d / "facts.json").read_text(encoding="utf-8")),
                          json.loads((d / "itinerary.json").read_text(encoding="utf-8")), base_url)
        (out / "place" / slug).mkdir(parents=True, exist_ok=True)
        (out / "place" / slug / "index.html").write_text(page, encoding="utf-8")
    _write_json(out / "packs" / "index.json", index)
    urls = [f"{base_url}/"] + [f"{base_url}/place/{s}/" for s in slugs if not regions.REGIONS[s].get("atlas")]
    (out / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                                     + "".join(f"<url><loc>{u}</loc></url>" for u in urls) + "</urlset>\n", encoding="utf-8")
    (out / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {base_url}/sitemap.xml\n", encoding="utf-8")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("slugs", nargs="*", help="regions to pack (default: every ready region)")
    ap.add_argument("--out", default=str(ROOT / "dist"))
    ap.add_argument("--api", help="URL of the live Tiny Atlas server, for the guide and the planner")
    ap.add_argument("--base-url", default="", help="public URL of the static site, for canonical links and the sitemap")
    a = ap.parse_args()
    slugs = a.slugs or [s for s in regions.REGIONS if api._ready(s)]
    build_site(slugs, Path(a.out), a.api, base_url=a.base_url.rstrip("/"))
