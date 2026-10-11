"""Openly licensed Commons photos for place cards, added to built Atlas packs.

    python backend/tools/pack_photos.py find <slug> ["query" ...]   # candidates + contact sheet for the judge
    python backend/tools/pack_photos.py apply [<pack> ...]           # add the approved photos to the built packs

Wikimedia's APIs answer 429 to this machine's shared address, so everything is read from ordinary pages: the
Commons media search page, and each file page (licence, author, size, camera location from their marked-up fields).
`find` searches Commons, keeps only free licences (CC0, PD, CC BY, CC BY-SA) and titles that pass collect_photos.wrong_photo, notes the distance from the place when the file is
geotagged, and writes data/reference/places/<slug>/candidates.json plus sheet.jpg (numbered thumbnails) to look at.

`apply` reads backend/tools/pack_photos.json, the photos a person has looked at and approved:
    {"<slug>": [{"title": "File:....jpg", "caption": "What the photo shows"}, ...]}
and for every built pack that has the place it downloads each file (1280 px Commons thumbnail, JPEG q85), stores it
as photos/<slug>/NN.jpg after the photos already there, adds {file, attribution, url, caption} to places.json (a file
already on the card is skipped; at most MAX photos per place) and re-measures files.json. Running it twice changes
nothing. The licence and author come from Commons' own metadata at apply time; a file whose licence is not free is
refused, whatever the list says.
"""
import hashlib
import html as htmllib
import io
import json
import math
import re
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import quote, unquote

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from collect_photos import UA, lic_ok, wrong_photo  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
PACKS = ROOT / "data" / "packs"
LIST = Path(__file__).with_name("pack_photos.json")
REF = ROOT / "data" / "reference" / "places"
MAX = 6
WIDTH = 1280                                                # a standard Commons thumbnail step
HTML = ROOT / "data" / "cache" / "wiki" / "html"
COMMONS = "https://commons.wikimedia.org"
_last = [0.0]


def places(pack):
    d = json.loads((PACKS / pack / "atlas" / "places.json").read_text(encoding="utf-8"))
    return d, (d["places"] if isinstance(d, dict) else d)


def latlon(pack, p):
    from pyproj import Transformer
    m = json.loads((PACKS / pack / "atlas" / "meta.json").read_text(encoding="utf-8"))
    t = Transformer.from_crs(m["crs"], "EPSG:4326", always_xy=True)
    lon, lat = t.transform(m["origin_utm"][0] + p["x"], m["origin_utm"][1] - p["z"])   # x east, z south of the origin
    return lat, lon


def find_place(slug):
    for pack in sorted(x.name for x in PACKS.iterdir() if (x / "atlas" / "places.json").exists()):
        for p in places(pack)[1]:
            if p["slug"] == slug:
                return pack, p
    sys.exit(f"{slug}: not in any pack")


def km(a, b, c, d):
    r = math.pi / 180
    x = math.sin((c - a) * r / 2) ** 2 + math.cos(a * r) * math.cos(c * r) * math.sin((d - b) * r / 2) ** 2
    return 12742 * math.asin(math.sqrt(x))


def get(url, cache=False):
    """Bytes of `url`, politely: one request every 2 s, a minute's wait on 429; pages are cached when asked."""
    f = HTML / (hashlib.md5(url.encode()).hexdigest() + ".html")
    if cache and f.exists():
        return f.read_bytes()
    for i in range(5):
        time.sleep(max(0.0, 2 - (time.time() - _last[0])))
        _last[0] = time.time()
        # curl, not httpx: Wikimedia refuses httpx's requests ("respect our robot policy") and answers curl's
        r = subprocess.run(["curl", "-s", "-L", "--max-time", "90", "-A", UA["User-Agent"], "-w", "\n%{http_code}", url],
                           capture_output=True)
        body, _, code = r.stdout.rpartition(b"\n")
        code = int(code or 0)
        if code == 200:
            if cache:
                HTML.mkdir(parents=True, exist_ok=True)
                f.write_bytes(body)
            return body
        if code in (429, 503):
            time.sleep(60); continue
        if code:
            print("  ", code, url[:120]); return None
        time.sleep(4 * (i + 1))
    return None


def search(q):
    """File titles from the Commons media search page (images only)."""
    b = get(f"{COMMONS}/w/index.php?search={quote(q)}&title=Special:MediaSearch&type=image", cache=True)
    names = re.findall(r'/wiki/(File:[^"&?#<]+?\.(?:jpe?g|JPE?G))', (b or b"").decode("utf-8", "replace"))
    return list(dict.fromkeys(unquote(n).replace("_", " ") for n in names))


def _cell(s, key):
    m = re.search(r'id="fileinfotpl_%s"[^>]*>.*?</td>\s*<td[^>]*>(.*?)</td>' % key, s, re.S)
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", m.group(1))).strip() if m else ""


def info(title):
    """What the file page says: original URL and size, licence, author, description, date, camera location."""
    b = get(f"{COMMONS}/wiki/{quote(title.replace(' ', '_'))}", cache=True)
    if not b:
        return None
    s = htmllib.unescape(b.decode("utf-8", "replace"))
    url = re.search(r'class="fullImageLink"[^>]*><a href="([^"?]+)', s)
    size = re.search(r'Original file</a></bdi>\s*<span class="fileInfo">\(([\d,]+) × ([\d,]+) pixels', s) \
        or re.search(r'class="fileInfo">\(([\d,]+) × ([\d,]+) pixels', s)
    lic = re.search(r'licensetpl_short"[^>]*>([^<]*)', s)
    geo = re.search(r'params=([\d.]+)_([NS])_([\d.]+)_([EW])_[^"]*type:camera', s)
    return {"url": url.group(1) if url else "",
            "size": [int(size.group(1).replace(",", "")), int(size.group(2).replace(",", ""))] if size else [0, 0],
            "licence": lic.group(1).strip() if lic else "", "artist": _cell(s, "aut")[:120],
            "desc": re.sub(r"^\w+: ", "", _cell(s, "desc"))[:300], "date": _cell(s, "date")[:40],
            "lat": (float(geo.group(1)) * (1 if geo.group(2) == "N" else -1)) if geo else None,
            "lon": (float(geo.group(3)) * (1 if geo.group(4) == "E" else -1)) if geo else None}


def thumb(i, w):
    """A standard-width Commons thumbnail of the original (the original itself when it is no wider)."""
    if i["size"][0] <= w:
        return i["url"]
    head, name = i["url"].rsplit("/", 1)
    return f"{head.replace('/wikipedia/commons/', '/wikipedia/commons/thumb/', 1)}/{name}/{w}px-{name}"


def cmd_find(slug, qs):
    pack, p = find_place(slug)
    lat, lon = latlon(pack, p)
    qs = qs or [p["name"]]
    titles = list(dict.fromkeys(t for q in qs for t in search(q)))[:40]
    out = []
    for t in titles:
        if wrong_photo(t, "", slug):
            continue
        i = info(t)
        if not i or not i["url"] or i["size"][0] < 800 or not lic_ok(i["licence"]) or wrong_photo(t, i["desc"], slug):
            continue
        d = round(km(lat, lon, i["lat"], i["lon"]), 1) if i["lat"] is not None else None
        out.append({"title": t, "licence": i["licence"], "artist": i["artist"], "km": d, "desc": i["desc"],
                    "size": i["size"], "thumb": thumb(i, 330)})
    out.sort(key=lambda c: (c["km"] is None, c["km"] or 0))
    d = REF / slug
    d.mkdir(parents=True, exist_ok=True)
    (d / "candidates.json").write_text(json.dumps({"place": p["name"], "lat": lat, "lon": lon, "candidates": out},
                                                  ensure_ascii=False, indent=1), encoding="utf-8")
    tiles = []
    for n, c in enumerate(out[:24]):
        b = get(c["thumb"])
        if b:
            im = Image.open(io.BytesIO(b)).convert("RGB")
            im.thumbnail((330, 250))
            tile = Image.new("RGB", (330, 270), "white")
            tile.paste(im, (0, 0))
            ImageDraw.Draw(tile).text((4, 252), f"{n}  {c['km'] if c['km'] is not None else '?'} km  {c['title'][5:45]}", fill="black")
            tiles.append(tile)
    if tiles:
        sheet = Image.new("RGB", (330 * 4, 270 * math.ceil(len(tiles) / 4)), "white")
        for n, t in enumerate(tiles):
            sheet.paste(t, ((n % 4) * 330, (n // 4) * 270))
        sheet.save(d / "sheet.jpg", quality=85)
    print(f"{slug} ({pack}, {lat:.4f} {lon:.4f}): {len(out)} candidates -> {d}")


def remeasure(atlas):
    files = json.loads((atlas / "files.json").read_text(encoding="utf-8"))
    known = {f["path"] for f in files}
    for f in (atlas / "photos").rglob("*.jpg"):
        rel = f.relative_to(atlas).as_posix()
        if rel not in known:
            files.append({"path": rel, "bytes": 0})
    files = [f for f in files if (atlas / f["path"]).exists()]
    for f in files:
        f["bytes"] = (atlas / f["path"]).stat().st_size
    (atlas / "files.json").write_text(json.dumps(files, separators=(",", ":")), encoding="utf-8")


def cmd_apply(packs):
    want = json.loads(LIST.read_text(encoding="utf-8"))
    packs = packs or sorted(x.name for x in PACKS.iterdir() if (x / "atlas" / "places.json").exists())
    cache = {}
    for pack in packs:
        atlas = PACKS / pack / "atlas"
        doc, ps = places(pack)
        added = 0
        for p in ps:
            for w in want.get(p["slug"], []):
                photos = p.setdefault("photos", [])
                url = "https://commons.wikimedia.org/wiki/" + w["title"].replace(" ", "_")
                if any(x["url"] == url for x in photos) or len(photos) >= MAX:
                    continue
                if w["title"] not in cache:
                    cache[w["title"]] = info(w["title"])
                m = i = cache[w["title"]]
                if not i or not i["url"]:
                    print(f"  {p['slug']}: {w['title']} not found"); continue
                if not lic_ok(m["licence"]):
                    print(f"  {p['slug']}: {w['title']} licence {m['licence']!r} refused"); continue
                b = get(thumb(i, WIDTH))
                if not b:
                    continue
                im = Image.open(io.BytesIO(b)).convert("RGB")
                im.thumbnail((1600, 1600))
                n = 1 + max([int(Path(x["file"]).stem) for x in photos if Path(x["file"]).stem.isdigit()] or [0])
                rel = f"photos/{p['slug']}/{n:02d}.jpg"
                (atlas / rel).parent.mkdir(parents=True, exist_ok=True)
                im.save(atlas / rel, quality=85, optimize=True, progressive=True)
                photos.append({"file": rel, "attribution": f"Photo: {m['artist'] or 'unknown author'}, {m['licence']}, via Wikimedia Commons",
                               "url": url, "caption": w.get("caption", "")})
                added += 1
        (atlas / "places.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
        remeasure(atlas)
        print(f"{pack}: {added} photos added")


if __name__ == "__main__":
    if sys.argv[1:2] == ["find"]:
        cmd_find(sys.argv[2], sys.argv[3:])
    elif sys.argv[1:2] == ["apply"]:
        cmd_apply(sys.argv[2:])
    else:
        sys.exit(__doc__)
