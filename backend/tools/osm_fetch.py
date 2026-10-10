"""OSM extract for a diorama site from the main OSM API, written in the Overpass `out geom;` JSON shape the build reads.

    python backend/tools/osm_fetch.py <south> <west> <north> <east> <out.json>

Overpass is often unreachable or times out; the main API's `/api/0.6/map` call is not. It returns every node and way
in the box (whole ways, with all their nodes, even where they leave it), up to 50,000 nodes per call, so a dense box is
split in four until each part fits. Ways keep their tags and get a `geometry` list of {lat, lon}; tagged nodes are kept
too (handy for finding a mapped landmark). Responses are cached under data/cache/osm/ (gitignored).
"""
import json
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "data" / "cache" / "osm"
UA = "TinyAtlas/0.1 (https://github.com/zeshanabdullah10/tinyatlas; open-source travel map research)"
API = "https://api.openstreetmap.org/api/0.6/map?bbox={w:.5f},{s:.5f},{e:.5f},{n:.5f}"


def get(s, w, n, e, depth=0):
    """XML roots covering the box; split in four when the API refuses it as too large."""
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / f"map_{s:.5f}_{w:.5f}_{n:.5f}_{e:.5f}.xml"
    if not f.exists():
        url = API.format(s=s, w=w, n=n, e=e)
        for attempt in range(5):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=180) as r:
                    f.write_bytes(r.read())
                break
            except urllib.error.HTTPError as err:
                if err.code == 400 and depth < 6:          # "too many nodes" or "area too large": split the box
                    ms, mw = (s + n) / 2, (w + e) / 2
                    return [x for b in ((s, w, ms, mw), (s, mw, ms, e), (ms, w, n, mw), (ms, mw, n, e)) for x in get(*b, depth + 1)]
                if err.code in (429, 509, 503, 504) and attempt < 4:
                    time.sleep(2 ** (attempt + 2)); continue
                raise
            except (urllib.error.URLError, TimeoutError):
                if attempt == 4:
                    raise
                time.sleep(2 ** (attempt + 1))
        time.sleep(1)                                       # be gentle with the shared API
    return [ET.parse(f).getroot()]


def extract(s, w, n, e):
    nodes, ways, tagged = {}, {}, {}
    for root in get(s, w, n, e):
        for nd in root.iter("node"):
            i = int(nd.get("id"))
            nodes[i] = (float(nd.get("lat")), float(nd.get("lon")))
            tags = {t.get("k"): t.get("v") for t in nd.iter("tag")}
            if tags:
                tagged[i] = tags
        for wy in root.iter("way"):
            ways[int(wy.get("id"))] = ([int(r.get("ref")) for r in wy.iter("nd")], {t.get("k"): t.get("v") for t in wy.iter("tag")})
    out = []
    for i, (refs, tags) in ways.items():
        if all(r in nodes for r in refs):
            out.append({"type": "way", "id": i, "tags": tags, "nodes": refs,
                        "geometry": [{"lat": nodes[r][0], "lon": nodes[r][1]} for r in refs]})
    for i, tags in tagged.items():
        out.append({"type": "node", "id": i, "lat": nodes[i][0], "lon": nodes[i][1], "tags": tags})
    return {"version": 0.6, "generator": "osm_fetch.py (OSM API /map)", "elements": out}


if __name__ == "__main__":
    s, w, n, e = map(float, sys.argv[1:5])
    data = extract(s, w, n, e)
    Path(sys.argv[5]).parent.mkdir(parents=True, exist_ok=True)
    Path(sys.argv[5]).write_text(json.dumps(data), encoding="utf-8")
    nw = sum(1 for x in data["elements"] if x["type"] == "way")
    print(f"{nw} ways, {len(data['elements']) - nw} tagged nodes -> {sys.argv[5]}")
