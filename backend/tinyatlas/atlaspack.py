"""Regions that are drawn by the Atlas renderer (docs/atlas-pack-v1.md) are served from their pack, not from
Wikipedia/OSM downloads: stops, facts, the road network and heights all come from data/packs/<slug>/atlas/.

Planner coordinates for these regions are normalised over the pack's own extent: u = x / W, v = z / H, with
x east and z south in scene metres (so the browser maps a route point straight back to the terrain).
"""
import json
import math
from functools import lru_cache
from pathlib import Path

import numpy as np

PACKS = Path(__file__).resolve().parents[2] / "data" / "packs"
ROAD_CLASSES = {"paved", "jeep", "minor", "track"}      # drivable; "path" is on foot
CLASS_KMH = {"paved": 40.0, "minor": 25.0, "jeep": 14.0, "track": 9.0}   # real speeds on these roads, before the slope penalty
COVER = "cover.webp"


def dir_of(slug: str) -> Path:
    return PACKS / slug / "atlas"


def available(slug: str | None) -> bool:
    return bool(slug) and (dir_of(slug) / "meta.json").exists()


def _json(slug: str, name: str):
    return json.loads((dir_of(slug) / name).read_text(encoding="utf-8"))


@lru_cache(maxsize=8)
def meta(slug: str) -> dict:
    return _json(slug, "meta.json")


@lru_cache(maxsize=8)
def places(slug: str) -> list[dict]:
    return _json(slug, "places.json")


def size_m(slug: str) -> tuple[float, float]:
    m = meta(slug)
    return float(m["cols"] * m["res_m"]), float(m["rows"] * m["res_m"])


def cover_url(slug: str) -> str | None:
    return f"/packs/{slug}/atlas/{COVER}" if (dir_of(slug) / COVER).exists() else None


@lru_cache(maxsize=8)
def _height(slug: str):
    m = meta(slug)
    raw = np.fromfile(dir_of(slug) / "height.bin", dtype="<u2").reshape(m["rows"], m["cols"])
    return raw, m["hmin"], m["hmax"]


def elevation(slug: str, u: float, v: float) -> float:
    raw, lo, hi = _height(slug)
    rows, cols = raw.shape
    j, i = min(rows - 1, max(0, int(v * rows))), min(cols - 1, max(0, int(u * cols)))
    return lo + float(raw[j, i]) / 65535 * (hi - lo)


def landmarks(slug: str, cfg: dict) -> list[dict]:
    """The region's configured landmarks in the shape sources.landmarks() returns, with story text from the pack."""
    W, H = size_m(slug)
    by = {p["slug"]: p for p in places(slug)}
    out = []
    for lm in cfg["landmarks"]:
        p = by.get(lm.get("slug"))
        if not p:
            continue
        ph = (p.get("photos") or [None])[0]
        src = next((f["source"] for f in p.get("facts") or [] if f.get("source")), "")
        out.append({"slug": p["slug"], "name": lm["title"], "kind": lm["kind"], "lat": lm["lat"], "lon": lm["lon"],
                    "u": p["x"] / W, "v": p["z"] / H, "summary": p.get("summary", "")[:600], "url": src,
                    "image": ph["file"] if ph else None, "description": p.get("area", "")})
    return out


def facts(slug: str, cfg: dict) -> dict:
    keep = {lm.get("slug") for lm in cfg["landmarks"]}
    items = [{"text": f["text"], "topic": "place", "source": p["name"], "url": f.get("source", "")}
             for p in places(slug) if p["slug"] in keep for f in (p.get("facts") or [])[:2]]
    return {"checked": None, "facts": items}


@lru_cache(maxsize=8)
def network(slug: str):
    """(adjacency, (W, H)) in the planner's format: node -> [(next node, minutes, metres, on foot?)]."""
    from . import planner
    W, H = size_m(slug)
    adj: dict = {}
    for r in _json(slug, "vectors.json").get("roads", []):
        pts = r["pts"]
        foot = r.get("class") == "path"
        if len(pts) < 2 or not (foot or r.get("class") in ROAD_CLASSES):
            continue
        run = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))
        e0, e1 = elevation(slug, pts[0][0] / W, pts[0][1] / H), elevation(slug, pts[-1][0] / W, pts[-1][1] / H)
        slope = max(0.5, planner.road_kmh(abs(e1 - e0) / max(run, 1.0)) / planner.ROAD_KMH)   # steep ways are slower, never below half
        kmh = planner.WALK_KMH if foot else CLASS_KMH[r["class"]] * (slope if r["class"] in ("jeep", "track") else 1.0)
        for a, b in zip(pts, pts[1:]):
            p, q = (round(a[0] / W, 7), round(a[1] / H, 7)), (round(b[0] / W, 7), round(b[1] / H, 7))
            m = math.hypot(b[0] - a[0], b[1] - a[1])
            if m == 0 or p == q:
                continue
            mins = m / 1000 / kmh * 60
            adj.setdefault(p, []).append((q, mins, m, foot))
            adj.setdefault(q, []).append((p, mins, m, foot))
    return adj, (W, H)
