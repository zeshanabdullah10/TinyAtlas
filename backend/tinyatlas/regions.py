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

BUILTIN = {
    "hunza": {
        "name": "Hunza Valley",
        "subtitle": "Gilgit-Baltistan, Pakistan",
        "bbox": (74.5, 36.2, 75.0, 36.55),
        "center": (36.375, 74.75),
        # Wikipedia titles; coordinates and text are fetched live, then filtered to the bbox.
        "landmarks": [
            {"title": "Baltit Fort", "kind": "fort"},
            {"title": "Altit Fort", "kind": "fort"},
            {"title": "Attabad Lake", "kind": "lake"},
            {"title": "Passu Cones", "kind": "peak"},
            {"title": "Ultar Sar", "kind": "peak"},
            {"title": "Hussaini Suspension Bridge", "kind": "bridge"},
        ],
        # Extra guide text (Wikivoyage) used for retrieval-grounded answers.
        "guide_pages": [("en.wikivoyage.org", "Hunza"), ("en.wikivoyage.org", "Karakoram Highway")],
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
    return {**{k: _norm(v) for k, v in BUILTIN.items()}, **_dynamic()}


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
