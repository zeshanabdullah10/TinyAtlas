"""Fetch OSM building footprints -> <bundle>/buildings.json (UTM metres).

    python backend/tools/blender/fetch_buildings.py data/bundles/swat                    # default: Kalam/Matiltan/Ushu sub-bbox
    python backend/tools/blender/fetch_buildings.py data/bundles/swat_lower --bbox 72.30 34.72 72.45 34.82 --bbox ... [--cap 15000]

Each --bbox is W S E N; boxes larger than 0.05 deg are split into tiles (one cached Overpass query each, data/cache/osm/).
If the total exceeds --cap, only the largest box is thinned (deterministic random sample) so small towns stay whole.
"""
import argparse, json, time, random
from pathlib import Path
import httpx
from pyproj import Transformer

ap = argparse.ArgumentParser()
ap.add_argument("bundle")
ap.add_argument("--bbox", nargs=4, type=float, action="append", metavar=("W", "S", "E", "N"))
ap.add_argument("--cap", type=int, default=0)
ap.add_argument("--tile", type=float, default=0.05)
a = ap.parse_args()
b = Path(a.bundle); cache = Path("data/cache/osm"); cache.mkdir(parents=True, exist_ok=True)
URLS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]


def query(bb, depth=0):
    """cached Overpass query; if the server keeps timing out, split the box into quadrants and retry."""
    cp = cache / f"buildings_{bb[0]:.3f}_{bb[1]:.3f}_{bb[2]:.3f}_{bb[3]:.3f}.json"
    old = cache / f"buildings_{bb[0]:.2f}_{bb[1]:.2f}_{bb[2]:.2f}_{bb[3]:.2f}.json"
    for c in (cp, old):
        if c.exists():
            return json.loads(c.read_text(encoding="utf-8"))
    q = f'[out:json][timeout:120];way["building"]({bb[1]},{bb[0]},{bb[3]},{bb[2]});out geom;'
    d = None
    for att in range(2):
        for url in URLS:
            try:
                r = httpx.post(url, data={"data": q}, headers={"User-Agent": "TinyAtlas/0.1"}, timeout=150)
                r.raise_for_status(); d = r.json()
                if d.get("remark") and not d.get("elements"): raise RuntimeError(d["remark"][:60])   # server-side runtime error / timeout
                break
            except Exception as e:
                d = None
                print("retry", [round(v, 3) for v in bb], repr(e)[:70], flush=True)
        if d: break
        time.sleep(6)
    if not d:
        if depth >= 3:
            raise SystemExit(f"Overpass failed for {bb}")
        w, s_, e_, n = bb; mx, my = (w + e_) / 2, (s_ + n) / 2
        els = {}
        for sub in ((w, s_, mx, my), (mx, s_, e_, my), (w, my, mx, n), (mx, my, e_, n)):
            for el in query(sub, depth + 1)["elements"]:
                els[el["id"]] = el
        d = {"elements": list(els.values())}
    cp.write_text(json.dumps(d), encoding="utf-8")
    return d


def tiles(bb):
    w, s, e, n = bb
    nx, ny = max(1, round((e - w) / a.tile)), max(1, round((n - s) / a.tile))
    for i in range(nx):
        for j in range(ny):
            yield (w + (e - w) * i / nx, s + (n - s) * j / ny, w + (e - w) * (i + 1) / nx, s + (n - s) * (j + 1) / ny)


if a.bbox:
    groups = []
    for bb in a.bbox:
        els = {}
        for t in tiles(bb):
            for el in query(t)["elements"]:
                els[el["id"]] = el
        groups.append(list(els.values()))
        print("bbox", bb, len(els), flush=True)
    seen, merged = set(), []
    for g in groups:
        keep = []
        for el in g:
            if el["id"] not in seen:
                seen.add(el["id"]); keep.append(el)
        merged.append(keep)
    total = sum(len(g) for g in merged)
    if a.cap and total > a.cap:
        big = max(range(len(merged)), key=lambda i: len(merged[i]))
        room = max(a.cap - (total - len(merged[big])), 1000)
        merged[big] = random.Random(5).sample(merged[big], min(room, len(merged[big])))
        print(f"cap {a.cap}: total {total} -> thinned biggest box to {len(merged[big])}")
    elements = [el for g in merged for el in g]
else:
    bb = (72.45, 35.40, 72.75, 35.65)  # W S E N
    cp = cache / "buildings_72.45_35.40_72.75_35.65.json"
    if cp.exists():
        d = json.loads(cp.read_text(encoding="utf-8"))
    else:
        q = f'[out:json][timeout:180];way["building"]({bb[1]},{bb[0]},{bb[3]},{bb[2]});out geom;'
        d = None
        for att in range(4):
            for url in URLS:
                try:
                    r = httpx.post(url, data={"data": q}, headers={"User-Agent": "TinyAtlas/0.1"}, timeout=240)
                    r.raise_for_status(); d = r.json(); break
                except Exception as e:
                    print("retry", e)
            if d: break
            time.sleep(8)
        cp.write_text(json.dumps(d), encoding="utf-8")
    elements = d["elements"]

tr = Transformer.from_crs(4326, 32643, always_xy=True)
out = []
for el in elements:
    g = el.get("geometry") or []
    if len(g) < 4: continue
    xs, ys = tr.transform([p["lon"] for p in g], [p["lat"] for p in g])
    out.append({"id": el["id"], "pts": [[round(x, 1), round(y, 1)] for x, y in zip(xs, ys)], "tags": el.get("tags", {}).get("building")})
(b / "buildings.json").write_text(json.dumps(out), encoding="utf-8")
print("buildings", len(out))
