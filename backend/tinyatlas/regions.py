"""Region registry: built-in showcase regions plus user-built ones stored as data/regions/<slug>.json.

A region config is a plain dict:
    name, subtitle, bbox (west, south, east, north), center (lat, lon),
    landmarks [{title, kind}], guide_pages [(host, title)], builtin (bool)
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
