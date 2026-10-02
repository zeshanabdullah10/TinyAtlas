"""Region registry: built-in showcase regions plus user-built ones stored as data/regions/<slug>.json.

A region config is a plain dict:
    name, subtitle, bbox (west, south, east, north), center (lat, lon),
    landmarks [{title, kind}], atlas (optional: slug of an Atlas pack), guide_pages [(host, title)], builtin (bool)
`REGIONS` is a read-only mapping over both sources, re-read on access so a region built in the background
shows up without a restart.
"""
import json
import re
from collections.abc import Mapping
from pathlib import Path

DATA = Path(__file__).resolve().parents[2] / "data" / "regions"

# The launch collection: Northern Pakistan, curated by hand. Landmark titles are Wikipedia pages (text, and
# coordinates when the page has them); `lat`/`lon` in a landmark come from OpenStreetMap for pages without
# coordinates. `tours` are hand-drawn routes in visiting order (titles, as in `landmarks`); the first is the default.
KARAKORAM_SNOW = 5300       # dry continental ranges: permanent snow sits far higher than at the same latitude in the Alps
HIMALAYA_SNOW = 4800

BUILTIN = {
    "hunza": {
        "name": "Hunza Valley",
        "subtitle": "Gilgit-Baltistan, Pakistan",
        "bbox": (74.5, 36.2, 75.0, 36.55),
        "center": (36.375, 74.75),
        "landmarks": [
            {"title": "Baltit Fort", "kind": "fort"},
            {"title": "Altit Fort", "kind": "fort"},
            {"title": "Karimabad, Hunza", "name": "Karimabad", "kind": "town"},
            {"title": "Ganish", "kind": "town"},
            {"title": "Attabad Lake", "kind": "lake"},
            {"title": "Gulmit", "kind": "town"},
            {"title": "Borith Lake", "kind": "lake"},
            {"title": "Hussaini Suspension Bridge", "kind": "bridge"},
            {"title": "Passu", "kind": "town"},
            {"title": "Passu Glacier", "kind": "glacier"},
            {"title": "Batura Glacier", "kind": "glacier"},
            {"title": "Ultar Sar", "kind": "peak"},
        ],
        "tours": [{"name": "Up the Karakoram Highway", "days": 2, "stops": [
            "Baltit Fort", "Altit Fort", "Attabad Lake", "Gulmit", "Borith Lake", "Hussaini Suspension Bridge", "Passu"]}],
        "guide_pages": [("en.wikivoyage.org", "Hunza"), ("en.wikivoyage.org", "Karimabad"),
                        ("en.wikivoyage.org", "Passu"), ("en.wikivoyage.org", "Gulmit"),
                        ("en.wikivoyage.org", "Karakoram Highway")],
        "snowline": KARAKORAM_SNOW,
        "viewpoints": [
            {"slug": "karimabad", "name": "Karimabad", "lat": 36.329, "lon": 74.666},
            {"slug": "altit-fort", "name": "Altit Fort", "lat": 36.315, "lon": 74.6819},
            {"slug": "attabad-lake", "name": "Attabad Lake", "lat": 36.346, "lon": 74.8655},
            {"slug": "passu-cones", "name": "Passu Cones viewpoint", "lat": 36.4926, "lon": 74.8807},
            {"slug": "borith-lake", "name": "Borith Lake", "lat": 36.43056, "lon": 74.8625},
        ],
        "tz": "Asia/Karachi",
        "builtin": True,
    },
    "skardu": {
        "name": "Skardu",
        "subtitle": "Gilgit-Baltistan, Pakistan",
        "bbox": (75.40, 35.16, 75.86, 35.47),
        "center": (35.29, 75.64),
        "landmarks": [
            {"title": "Skardu", "kind": "town"},
            {"title": "Skardu Fort", "kind": "fort"},
            {"title": "Satpara Lake", "kind": "lake"},
            {"title": "Manthal Buddha Rock", "kind": "monument"},
            {"title": "Katpana Desert", "kind": "pin"},
            {"title": "Lower Kachura Lake", "kind": "lake"},
            {"title": "Kachura Lake", "name": "Upper Kachura Lake", "kind": "lake", "lat": 35.4466, "lon": 75.446},
            {"title": "Shigar Palace", "kind": "fort"},
        ],
        "tours": [
            {"name": "Skardu and the Kachura lakes", "days": 1, "stops": [
                "Satpara Lake", "Manthal Buddha Rock", "Skardu Fort", "Katpana Desert", "Lower Kachura Lake", "Kachura Lake"]},
            {"name": "Shigar", "days": 1, "stops": ["Skardu Fort", "Shigar Palace"]},
        ],
        "guide_pages": [("en.wikivoyage.org", "Skardu"), ("en.wikipedia.org", "Skardu")],
        "snowline": KARAKORAM_SNOW,
        "viewpoints": [
            {"slug": "skardu-fort", "name": "Skardu Fort", "lat": 35.30406, "lon": 75.63957},
            {"slug": "upper-kachura", "name": "Upper Kachura Lake", "lat": 35.4466, "lon": 75.446},
            {"slug": "satpara-lake", "name": "Satpara Lake", "lat": 35.2295, "lon": 75.6304},
        ],
        "tz": "Asia/Karachi",
        "builtin": True,
    },
    "fairy-meadows": {
        "name": "Fairy Meadows",
        "subtitle": "Nanga Parbat, Gilgit-Baltistan, Pakistan",
        "bbox": (74.38, 35.19, 74.80, 35.53),
        "center": (35.387, 74.584),
        "view_from": 0,         # from the north, as from the meadows: Nanga Parbat's Raikot face fills the view
        "landmarks": [
            {"title": "Raikot Bridge", "kind": "bridge"},
            {"title": "Fairy Meadows", "kind": "park"},
            {"title": "Nanga Parbat", "kind": "peak"},
        ],
        "tours": [{"name": "Raikot Bridge to Fairy Meadows", "days": 2, "stops": ["Raikot Bridge", "Fairy Meadows"]}],
        "guide_pages": [("en.wikipedia.org", "Fairy Meadows"), ("en.wikipedia.org", "Nanga Parbat"),
                        ("en.wikivoyage.org", "Karakoram Highway")],
        "snowline": HIMALAYA_SNOW,
        "viewpoints": [
            {"slug": "fairy-meadows", "name": "Fairy Meadows", "lat": 35.38685, "lon": 74.58416},
            {"slug": "raikot-bridge", "name": "Raikot Bridge", "lat": 35.49306, "lon": 74.59197},
        ],
        "tz": "Asia/Karachi",
        "builtin": True,
    },
    "naran": {
        "name": "Naran and Kaghan",
        "subtitle": "Khyber Pakhtunkhwa, Pakistan",
        "bbox": (73.58, 34.77, 74.10, 35.18),
        "center": (34.909, 73.653),
        "landmarks": [
            {"title": "Naran (town)", "name": "Naran", "kind": "town"},
            {"title": "Lake Saiful Muluk", "kind": "lake"},
            {"title": "Ansoo Lake", "kind": "lake"},
            {"title": "Malika Parbat", "kind": "peak"},
            {"title": "Batakundi", "kind": "town"},
            {"title": "Lulusar-Dudipatsar National Park", "name": "Lulusar Lake", "kind": "lake",
             "lat": 35.0836, "lon": 73.925},
            {"title": "Babusar Pass", "kind": "pin"},
        ],
        "tours": [{"name": "Naran to Babusar Pass", "days": 2, "stops": [
            "Lake Saiful Muluk", "Naran (town)", "Batakundi", "Lulusar-Dudipatsar National Park", "Babusar Pass"]}],
        "guide_pages": [("en.wikivoyage.org", "Naran"), ("en.wikivoyage.org", "Kaghan Valley")],
        "snowline": HIMALAYA_SNOW,
        "viewpoints": [
            {"slug": "saiful-muluk", "name": "Lake Saiful Muluk", "lat": 34.87696, "lon": 73.69449},
            {"slug": "babusar-pass", "name": "Babusar Pass", "lat": 35.14624, "lon": 74.04817},
            {"slug": "lulusar-lake", "name": "Lulusar Lake", "lat": 35.0836, "lon": 73.925},
        ],
        "tz": "Asia/Karachi",
        "builtin": True,
    },
    "deosai": {
        "name": "Deosai Plains",
        "subtitle": "Gilgit-Baltistan, Pakistan",
        "bbox": (75.15, 34.86, 75.70, 35.25),
        "center": (34.97, 75.40),
        "landmarks": [
            {"title": "Satpara Lake", "kind": "lake"},
            {"title": "Deosai National Park", "kind": "park", "lat": 35.019, "lon": 75.4117},      # at Bara Pani
            {"title": "Sheosar Lake", "kind": "lake"},
        ],
        "tours": [{"name": "Skardu across the Deosai", "days": 1, "stops": [
            "Satpara Lake", "Deosai National Park", "Sheosar Lake"]}],
        "guide_pages": [("en.wikivoyage.org", "Deosai National Park"), ("en.wikipedia.org", "Deosai National Park")],
        "snowline": KARAKORAM_SNOW,
        "viewpoints": [
            {"slug": "sheosar-lake", "name": "Sheosar Lake", "lat": 34.99139, "lon": 75.23667},
            {"slug": "bara-pani", "name": "Bara Pani", "lat": 35.019, "lon": 75.4117},
        ],
        "tz": "Asia/Karachi",
        "builtin": True,
    },
    "khunjerab": {
        "name": "Khunjerab Pass",
        "subtitle": "Gilgit-Baltistan, Pakistan",
        "bbox": (74.78, 36.56, 75.50, 36.90),
        "center": (36.72, 75.14),
        "landmarks": [
            {"title": "Sost", "kind": "town", "lat": 36.6897, "lon": 74.8206},
            {"title": "Morkhun", "kind": "town"},
            {"title": "Khunjerab National Park", "kind": "park"},
            {"title": "Khunjerab Pass", "kind": "pin", "lat": 36.8501, "lon": 75.4283},
        ],
        "tours": [{"name": "Sost to the Chinese border", "days": 1, "stops": [
            "Sost", "Morkhun", "Khunjerab National Park", "Khunjerab Pass"]}],
        "guide_pages": [("en.wikivoyage.org", "Sost"), ("en.wikipedia.org", "Khunjerab National Park"),
                        ("en.wikivoyage.org", "Karakoram Highway")],
        "snowline": KARAKORAM_SNOW,
        "viewpoints": [
            {"slug": "khunjerab-pass", "name": "Khunjerab Pass", "lat": 36.8501, "lon": 75.4283},
            {"slug": "sost", "name": "Sost", "lat": 36.6897, "lon": 74.8206},
        ],
        "tz": "Asia/Karachi",
        "builtin": True,
    },
    "swat": {
        "name": "Swat Valley",
        "subtitle": "Kalam · Utror · Ushu · Mahodand",
        "bbox": (72.1, 35.3, 72.9, 35.85),
        "center": (35.6, 72.6),
        "atlas": "swat",       # Atlas pack at data/packs/swat/atlas/ (docs/atlas-pack-v1.md); card opens /atlas.html
        "landmarks": [
            {"title": "Andrab Lake", "slug": "andrab-lake", "kind": "lake", "lat": 35.6455, "lon": 72.51229},
            {"title": "Gabral", "slug": "gabral", "kind": "village", "lat": 35.51629, "lon": 72.42038},
            {"title": "Izmis Lake", "slug": "izmis-lake", "kind": "lake", "lat": 35.39996, "lon": 72.37728},
            {"title": "Jabba Zomalu Lake", "slug": "jabba-zomalu-lake", "kind": "lake", "lat": 35.6239, "lon": 72.7986},
            {"title": "Jandrai", "slug": "jandrai", "kind": "village", "lat": 35.39488, "lon": 72.30902},
            {"title": "Kalam", "slug": "kalam", "kind": "town", "lat": 35.48611, "lon": 72.58458},
            {"title": "Katora Lake", "slug": "katora-lake", "kind": "lake", "lat": 35.36771, "lon": 72.34612},
            {"title": "Kharkhari Lake", "slug": "kharkhari-lake", "kind": "lake", "lat": 35.6772, "lon": 72.4015},
            {"title": "Kundol Lake", "slug": "kundol-lake", "kind": "lake", "lat": 35.41854, "lon": 72.43302},
            {"title": "Laddu", "slug": "laddu", "kind": "village", "lat": 35.46946, "lon": 72.43959},
            {"title": "Laddu Lake", "slug": "laddu-lake", "kind": "lake", "lat": 35.32331, "lon": 72.46978},
            {"title": "Mahodand Lake", "slug": "mahodand-lake", "kind": "lake", "lat": 35.70825, "lon": 72.65398},
            {"title": "Matiltan", "slug": "matiltan", "kind": "village", "lat": 35.54145, "lon": 72.66128},
            {"title": "Mushroom Lake", "slug": "mushroom-lake", "kind": "lake", "lat": 35.6357, "lon": 72.29624},
            {"title": "Pearl Lake", "slug": "pearl-lake", "kind": "lake", "lat": 35.60234, "lon": 72.59772},
            {"title": "Spin Khwar Lake", "slug": "spin-khwar-lake", "kind": "lake", "lat": 35.43375, "lon": 72.45202},
            {"title": "Thal", "slug": "thal-kumrat", "kind": "village", "lat": 35.47823, "lon": 72.24551},
            {"title": "Ushu", "slug": "ushu", "kind": "village", "lat": 35.60756, "lon": 72.69019},
            {"title": "Utror", "slug": "utror", "kind": "village", "lat": 35.49151, "lon": 72.46902},
            {"title": "Falak Sar", "slug": "falak-sar", "kind": "peak", "lat": 35.6786, "lon": 72.78075},
            {"title": "Jamia Masjid Thal", "slug": "jamia-masjid-thal", "kind": "mosque", "lat": 35.47843, "lon": 72.2454},
            {"title": "Mankial Sar", "slug": "mankial-sar", "kind": "peak", "lat": 35.41745, "lon": 72.7192},
            {"title": "Thalo Zom", "slug": "thalo-zom", "kind": "peak", "lat": 35.78112, "lon": 72.28262},
        ],
        "tours": [
            {"name": "Kalam to Mahodand Lake", "days": 1, "stops": ["Kalam", "Ushu", "Mahodand Lake"]},
            {"name": "Utror, Kalam and Gabral", "days": 1, "stops": ["Utror", "Kalam", "Matiltan", "Gabral"]},
        ],
        "guide_pages": [],
        "snowline": HIMALAYA_SNOW,
        "viewpoints": [
            {"slug": "kalam", "name": "Kalam", "lat": 35.48611, "lon": 72.58458},
            {"slug": "mahodand-lake", "name": "Mahodand Lake", "lat": 35.70825, "lon": 72.65398},
            {"slug": "utror", "name": "Utror", "lat": 35.49151, "lon": 72.46902},
        ],
        "tz": "Asia/Karachi",
        "builtin": True,
    },
    "swat-lower": {
        "name": "Lower Swat",
        "subtitle": "Mingora · Udegram · Malam Jabba",
        "bbox": (72.0, 34.58, 72.7, 35.3),
        "center": (34.84, 72.4),
        "atlas": "swat-lower",       # Atlas pack at data/packs/swat-lower/atlas/ (docs/atlas-pack-v1.md); card opens /atlas.html
        "landmarks": [
            {"title": "Bahrain", "slug": "bahrain", "kind": "town", "lat": 35.2078, "lon": 72.5474},
            {"title": "Barikot", "slug": "barikot", "kind": "town", "lat": 34.678, "lon": 72.22377},
            {"title": "Daral Lake", "slug": "daral-lake", "kind": "lake", "lat": 35.2171, "lon": 72.37524},
            {"title": "Fatehpur", "slug": "fatehpur-swat", "kind": "town", "lat": 35.06907, "lon": 72.48696},
            {"title": "Kanju", "slug": "kanju", "kind": "village", "lat": 34.80442, "lon": 72.33744},
            {"title": "Khwazakhela", "slug": "khwazakhela", "kind": "town", "lat": 34.93632, "lon": 72.46929},
            {"title": "Madyan", "slug": "madyan", "kind": "town", "lat": 35.14129, "lon": 72.53744},
            {"title": "Manglawar", "slug": "manglawar", "kind": "town", "lat": 34.80854, "lon": 72.4304},
            {"title": "Miandam", "slug": "miandam", "kind": "town", "lat": 35.0534, "lon": 72.5606},
            {"title": "Mingora", "slug": "mingora", "kind": "town", "lat": 34.77254, "lon": 72.36077},
            {"title": "Saidu Sharif", "slug": "saidu-sharif", "kind": "town", "lat": 34.74473, "lon": 72.35628},
            {"title": "Udegram", "slug": "udegram", "kind": "village", "lat": 34.752, "lon": 72.293},
            {"title": "Amluk-Dara Stupa", "slug": "amluk-dara-stupa", "kind": "stupa", "lat": 34.64747, "lon": 72.28985},
            {"title": "Bazira", "slug": "bazira-barikot-ghundai", "kind": "archaeological_site", "lat": 34.67834, "lon": 72.21477},
            {"title": "Butkara I Stupa", "slug": "butkara-i-stupa", "kind": "stupa", "lat": 34.76524, "lon": 72.3682},
            {"title": "Butkara III Stupa", "slug": "butkara-iii-stupa", "kind": "stupa", "lat": 34.75852, "lon": 72.37171},
            {"title": "Chakdara Fort", "slug": "chakdara-fort", "kind": "fort_ruin", "lat": 34.64716, "lon": 72.02851},
            {"title": "Elum Ghar", "slug": "elum-ghar", "kind": "peak", "lat": 34.61949, "lon": 72.33073},
            {"title": "Ghalegay Buddha", "slug": "ghalegay-buddha-rock", "kind": "rock_carving", "lat": 34.7059, "lon": 72.26045},
            {"title": "Gogdara Rock Carvings", "slug": "gogdara-rock-carvings", "kind": "rock_carving", "lat": 34.74307, "lon": 72.29508},
            {"title": "Gumbat Stupa", "slug": "gumbat-balo-kale-stupa", "kind": "stupa", "lat": 34.68973, "lon": 72.18542},
            {"title": "Jahanabad Buddha", "slug": "jahanabad-buddha", "kind": "rock_carving", "lat": 34.81151, "lon": 72.46735},
            {"title": "Mahmud Ghaznavi Mosque", "slug": "mahmud-ghaznavi-mosque", "kind": "mosque", "lat": 34.74315, "lon": 72.31426},
            {"title": "Nimogram Stupa", "slug": "nimogram-stupa", "kind": "stupa", "lat": 34.7252, "lon": 72.135},
            {"title": "Raja Gira Castle", "slug": "raja-gira-castle", "kind": "fort_ruin", "lat": 34.74185, "lon": 72.31318},
            {"title": "Saidu Sharif Stupa", "slug": "saidu-sharif-stupa", "kind": "stupa", "lat": 34.75747, "lon": 72.36215},
            {"title": "Shingardar Stupa", "slug": "shingardar-stupa", "kind": "stupa", "lat": 34.69139, "lon": 72.24722},
            {"title": "Swat Museum", "slug": "swat-museum", "kind": "museum", "lat": 34.7635, "lon": 72.35922},
            {"title": "White Palace", "slug": "white-palace-marghazar", "kind": "palace", "lat": 34.66328, "lon": 72.34486},
        ],
        "tours": [
            {"name": "Mingora and the Buddhist valley", "days": 1, "stops": ["Mingora", "Saidu Sharif Stupa", "Butkara I Stupa", "Swat Museum", "Udegram"]},
            {"name": "Chakdara to Barikot", "days": 1, "stops": ["Chakdara Fort", "Manglawar", "Mingora", "Barikot"]},
        ],
        "guide_pages": [],
        "snowline": HIMALAYA_SNOW,
        "viewpoints": [
            {"slug": "mingora", "name": "Mingora", "lat": 34.77254, "lon": 72.36077},
            {"slug": "udegram", "name": "Udegram", "lat": 34.752, "lon": 72.293},
            {"slug": "white-palace-marghazar", "name": "White Palace", "lat": 34.66328, "lon": 72.34486},
        ],
        "tz": "Asia/Karachi",
        "builtin": True,
    },
}


def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower().encode("ascii", "ignore").decode()).strip("-")
    return s or "place"


def _norm(cfg: dict) -> dict:
    """JSON gives lists; the rest of the code unpacks tuples."""
    out = dict(cfg)
    out["bbox"] = tuple(out["bbox"])
    if out.get("center"):
        out["center"] = tuple(out["center"])
    out["guide_pages"] = [tuple(p) for p in out.get("guide_pages", [])]
    return out


def _dynamic() -> dict:
    out = {}
    if DATA.exists():
        for f in sorted(DATA.glob("*.json")):
            try:
                out[f.stem] = _norm({**json.loads(f.read_text(encoding="utf-8")), "builtin": False})
            except (ValueError, KeyError):
                continue      # a half-written or corrupt file must never take the whole app down
    return out


def all_regions() -> dict:
    built = {k: v for k, v in _dynamic().items() if k not in BUILTIN}    # a curated region beats a built one
    return {**{k: _norm(v) for k, v in BUILTIN.items()}, **built}


def save(slug: str, cfg: dict) -> None:
    """Persist a user-built region (atomic write, so readers never see half a file)."""
    DATA.mkdir(parents=True, exist_ok=True)
    tmp = DATA / f"{slug}.json.tmp"
    tmp.write_text(json.dumps({k: v for k, v in cfg.items() if k != "builtin"}, ensure_ascii=False), encoding="utf-8")
    tmp.replace(DATA / f"{slug}.json")


def remove(slug: str) -> bool:
    f = DATA / f"{slug}.json"
    if slug in BUILTIN or not f.exists():
        return False
    f.unlink()
    return True


class _Registry(Mapping):
    def __getitem__(self, k):
        return all_regions()[k]

    def __iter__(self):
        return iter(all_regions())

    def __len__(self):
        return len(all_regions())


REGIONS = _Registry()
