"""Credited photos for a diorama site from Wikimedia Commons, fetched in one batched request.

    python backend/tools/commons_photos.py <site>

Reads data/reference/<site>/commons_candidates.txt: one Commons file per line, `File name.jpg | caption`
(caption <= 60 chars, the visitor-facing words; `#` starts a comment). Asks the en.wikipedia.org API (which serves
Commons file info; commons.wikimedia.org itself may not resolve) for up to 50 files per request, keeps only freely
licensed files (CC BY / CC BY-SA / CC0 / public domain; never NC or ND), and writes web/data/diorama/<site>/photos.json
in the Mahodand schema. lat/lon come from the file's GPS metadata, or are null when it has none. Files geotagged
outside the site's grid are dropped; the run prints what it kept and why it dropped the rest.
"""
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from collect_photos import wrong_photo   # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
UA = "TinyAtlas/2 (https://github.com/zeshanabdullah10/tinyatlas; diorama photo credits)"
API = "https://en.wikipedia.org/w/api.php"
FREE = re.compile(r"^(CC BY(-SA)? \d\.\d.*|CC0.*|Public domain|PD.*)$", re.I)


def plain(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", s or ""))).strip()


def fetch(titles):
    q = {"action": "query", "format": "json", "prop": "imageinfo", "iiprop": "url|extmetadata", "iiurlwidth": "960",
         "titles": "|".join("File:" + t for t in titles)}
    req = urllib.request.Request(API + "?" + urllib.parse.urlencode(q), headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)["query"]["pages"].values()
        except Exception as e:          # rate limit or network: back off and retry (brief: 60 s on HTTP 429)
            print("retry", attempt + 1, e); time.sleep(60 if getattr(e, "code", None) == 429 else 20 * (attempt + 1))
    raise SystemExit("the API did not answer")


def main(site):
    cand = ROOT / "data" / "reference" / site / "commons_candidates.txt"
    rows = []
    for line in cand.read_text(encoding="utf-8").splitlines():
        line = line.split("#")[0].strip()
        if line:
            name, _, cap = (s.strip() for s in line.partition("|"))
            rows.append((name.removeprefix("File:").replace("_", " "), cap))
    meta = json.loads((ROOT / "web" / "data" / "diorama" / site / "meta.json").read_text(encoding="utf-8"))
    s, w, n, e = meta["grid"]["bbox"]
    caps = dict(rows)
    out, dropped = [], []
    for i in range(0, len(rows), 50):
        for p in fetch([r[0] for r in rows[i:i + 50]]):
            t = p["title"].removeprefix("File:")
            if "imageinfo" not in p:
                dropped.append((t, "not on Commons")); continue
            if wrong_photo("File:" + t, slug={"mahodand": "mahodand-lake", "white-palace": "white-palace-marghazar"}.get(site, site)):
                dropped.append((t, "of another place (collect_photos.EXCLUDE / ELSEWHERE)")); continue
            ii = p["imageinfo"][0]; m = {k: v.get("value") for k, v in ii.get("extmetadata", {}).items()}
            lic = plain(m.get("LicenseShortName"))
            if not FREE.match(lic) or re.search(r"\b(NC|ND)\b", lic):
                dropped.append((t, f"licence {lic!r}")); continue
            lat, lon = m.get("GPSLatitude"), m.get("GPSLongitude")
            lat = float(lat) if lat else None; lon = float(lon) if lon else None
            if lat is not None and not (s <= lat <= n and w <= lon <= e):
                dropped.append((t, f"geotagged outside the model ({lat:.4f}, {lon:.4f})")); continue
            date = (plain(m.get("DateTimeOriginal")) or plain(m.get("DateTime")))[:10]
            out.append({"title": t, "caption": caps.get(t, "")[:60], "lat": lat, "lon": lon, "date": date or None,
                        "author": plain(m.get("Artist")) or "unknown", "licence": lic,
                        "page": "https://commons.wikimedia.org/wiki/File:" + urllib.parse.quote(t.replace(" ", "_")),
                        "thumb": ii.get("thumburl") or ii.get("url")})
        time.sleep(2)
    missing = set(caps) - {o["title"] for o in out} - {d[0] for d in dropped}
    dropped += [(t, "not returned") for t in missing]
    dest = ROOT / "web" / "data" / "diorama" / site / "photos.json"
    dest.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"kept {len(out)} ({sum(o['lat'] is not None for o in out)} geotagged in the model) -> {dest}")
    for t, why in dropped:
        print("  dropped", t, "-", why)


if __name__ == "__main__":
    main(sys.argv[1])
