"""Fetch OSM building footprints for the Kalam/Matiltan/Ushu sub-bbox -> <bundle>/buildings.json (UTM metres).
python backend/tools/blender/fetch_buildings.py data/bundles/swat"""
import sys, json, time
from pathlib import Path
import httpx
from pyproj import Transformer
b = Path(sys.argv[1]); cache = Path("data/cache/osm"); cache.mkdir(parents=True, exist_ok=True)
bb = (72.45, 35.40, 72.75, 35.65)  # W S E N
cp = cache / "buildings_72.45_35.40_72.75_35.65.json"
if cp.exists():
    d = json.loads(cp.read_text(encoding="utf-8"))
else:
    q = f'[out:json][timeout:180];way["building"]({bb[1]},{bb[0]},{bb[3]},{bb[2]});out geom;'
    d = None
    for att in range(4):
        for url in ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]:
            try:
                r = httpx.post(url, data={"data": q}, headers={"User-Agent": "TinyAtlas/0.1"}, timeout=240)
                r.raise_for_status(); d = r.json(); break
            except Exception as e:
                print("retry", e)
        if d: break
        time.sleep(8)
    cp.write_text(json.dumps(d), encoding="utf-8")
tr = Transformer.from_crs(4326, 32643, always_xy=True)
out = []
for el in d["elements"]:
    g = el.get("geometry") or []
    if len(g) < 4: continue
    xs, ys = tr.transform([p["lon"] for p in g], [p["lat"] for p in g])
    out.append({"id": el["id"], "pts": [[round(x, 1), round(y, 1)] for x, y in zip(xs, ys)], "tags": el.get("tags", {}).get("building")})
(b / "buildings.json").write_text(json.dumps(out), encoding="utf-8")
print("buildings", len(out))
