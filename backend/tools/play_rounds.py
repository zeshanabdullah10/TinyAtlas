"""Build web/data/play/rounds.json for the "Where is this view?" game.

Only photos with a real credited source and a known place are used:
  (a) web/data/diorama/mahodand/photos.json  (geotagged Wikimedia Commons, lat/lon)
  (b) data/packs/<pack>/atlas/places.json photo entries whose file exists on disk
      (field photos, attributed to Wikimedia Commons, tied to a place slug).
data/reference/* is never read.

Run:  python backend/tools/play_rounds.py
"""
import json
import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from collect_photos import wrong_photo   # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
PACKS = ROOT / "data" / "packs"
MAHODAND = ROOT / "web" / "data" / "diorama" / "mahodand" / "photos.json"
OUT = ROOT / "web" / "data" / "play" / "rounds.json"
PACK_ORDER = ["swat", "swat-lower"]          # first pack wins when the same photo appears in both
ATTR = re.compile(r"^Photo:\s*(.+?),\s*((?:CC[^,]*|Public domain|GFDL[^,]*))(?:,|$)")


def latlon_to_utm(lat, lon, zone=43):
    """WGS84 -> UTM (northern hemisphere), standard series. Returns (easting, northing) in metres."""
    a, f = 6378137.0, 1 / 298.257223563
    k0 = 0.9996
    e2 = f * (2 - f)
    ep2 = e2 / (1 - e2)
    phi, lam = math.radians(lat), math.radians(lon)
    lam0 = math.radians(zone * 6 - 183)
    N = a / math.sqrt(1 - e2 * math.sin(phi) ** 2)
    T = math.tan(phi) ** 2
    C = ep2 * math.cos(phi) ** 2
    A = (lam - lam0) * math.cos(phi)
    M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi
             - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * math.sin(2 * phi)
             + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * math.sin(4 * phi)
             - (35 * e2 ** 3 / 3072) * math.sin(6 * phi))
    east = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000
    north = k0 * (M + N * math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24
                                         + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720))
    return east, north


def load_pack(pack):
    base = PACKS / pack / "atlas"
    meta = json.loads((base / "meta.json").read_text(encoding="utf-8"))
    places = json.loads((base / "places.json").read_text(encoding="utf-8"))
    if isinstance(places, dict):
        places = places.get("places", [])
    sx, sz = meta["size_m"]
    return {"base": base, "meta": meta, "places": places, "sx": sx, "sz": sz,
            "e0": meta["origin_utm"][0], "n0": meta["origin_utm"][1]}


def to_pack_xz(pk, lat, lon):
    e, n = latlon_to_utm(lat, lon)
    return e - pk["e0"], pk["n0"] - n          # same frame as the app: x = E - origin_E, z = origin_N - N


def inside(pk, x, z):
    return 0 <= x <= pk["sx"] and 0 <= z <= pk["sz"]


def parse_attr(text):
    m = ATTR.match(text or "")
    if not m:
        return None, None
    return m.group(1).strip(), m.group(2).strip()


def build(write=True):
    packs = {p: load_pack(p) for p in PACK_ORDER if (PACKS / p / "atlas" / "places.json").exists()}
    rounds, seen = [], set()

    # (a) geotagged Commons photos in the Mahodand set (Kalam valley, inside the swat pack frame)
    if "swat" in packs and MAHODAND.exists():
        pk = packs["swat"]
        for ph in json.loads(MAHODAND.read_text(encoding="utf-8")):
            if not ph.get("page") or not ph.get("thumb") or not ph.get("licence") or not ph.get("author"):
                continue
            if ph["page"] in seen:
                continue
            x, z = to_pack_xz(pk, ph["lat"], ph["lon"])
            if not inside(pk, x, z):
                continue
            seen.add(ph["page"])
            rounds.append({
                "image": ph["thumb"], "credit": f"Photo: {ph['author']}, {ph['licence']}, via Wikimedia Commons",
                "licence": ph["licence"], "source_url": ph["page"],
                "answer": {"lat": ph["lat"], "lon": ph["lon"], "pack": "swat", "x": round(x, 1), "z": round(z, 1),
                           "slug": "mahodand-lake", "name": "Mahodand Lake (Kalam valley)"},
                "caption": ph.get("caption", ""),
            })

    # (b) field photos listed on places in the packs
    for name, pk in packs.items():
        for pl in pk["places"]:
            for ph in pl.get("photos") or []:
                rel = ph.get("file", "")
                url = ph.get("url", "")
                credit, licence = parse_attr(ph.get("attribution", ""))
                if not (credit and licence and url and rel):
                    continue
                disk = pk["base"] / rel
                if not disk.is_file() or url in seen or wrong_photo(url, slug=pl["slug"]):
                    continue           # (a photo of another place never becomes a round)
                if not inside(pk, pl["x"], pl["z"]):
                    continue           # answer must sit on the map grid so the guess can be placed
                seen.add(url)
                rounds.append({
                    "image": f"/packs/{name}/atlas/{rel}", "credit": ph["attribution"],
                    "licence": licence, "source_url": url,
                    "answer": {"pack": name, "slug": pl["slug"], "name": pl.get("name", pl["slug"]),
                               "x": round(pl["x"], 1), "z": round(pl["z"], 1)},
                    "caption": "",
                })

    for i, r in enumerate(rounds, 1):
        r["id"] = f"r{i:03d}"
    if write:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(rounds, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return rounds


if __name__ == "__main__":
    out = build()
    print(f"{len(out)} rounds written to {OUT}")
    sys.exit(0)
