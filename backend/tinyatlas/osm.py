"""OSM features (roads, rivers, lakes, buildings) via Overpass, cached on disk.

Output is region-normalised: every polyline is a list of (u, v) in [0, 1] where
u runs west->east and v runs north->south, matching heightmap row/col order.

Roads and water are required. Buildings are a separate, best-effort query because
Overpass often 504s on dense bboxes; a failure yields an empty list and is not cached.
"""
import hashlib
import json
from pathlib import Path

import httpx

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
HEADERS = {"User-Agent": "TinyAtlas/0.1 (open-source hobby project)", "Accept": "application/json"}
CACHE = Path(__file__).resolve().parents[2] / "data" / "osm"

ROAD_CLASSES = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "track", "service"}
WATER_WAYS = {"river", "stream", "canal"}


def _bbox_str(bbox) -> str:
    w, s, e, n = bbox
    return f"{s},{w},{n},{e}"


def core_query(bbox) -> str:
    b = _bbox_str(bbox)
    return (
        "[out:json][timeout:90];("
        f'way["highway"]({b});'
        f'way["waterway"~"^(river|stream|canal)$"]({b});'
        f'way["natural"="water"]({b});'
        ");out geom;"
    )


def buildings_query(bbox) -> str:
    return f'[out:json][timeout:90];way["building"]({_bbox_str(bbox)});out geom;'


def _run(query: str, client: httpx.Client | None = None) -> dict:
    path = CACHE / f"{hashlib.sha1(query.encode()).hexdigest()[:16]}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    last = None
    for url in OVERPASS_URLS:
        try:
            c = client or httpx
            r = c.post(url, data={"data": query}, headers=HEADERS, timeout=150)
            r.raise_for_status()
            data = r.json()
            CACHE.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(data), encoding="utf-8")
            return data
        except Exception as exc:  # try the next mirror
            last = exc
    raise RuntimeError(f"Overpass failed: {last}")


def classify(tags: dict) -> str | None:
    if "building" in tags:
        return "building"
    if tags.get("waterway") in WATER_WAYS:
        return "river"
    if tags.get("natural") == "water":
        return "lake"
    if tags.get("highway") in ROAD_CLASSES:
        return "road"
    return None


def normalise(raw: dict, bbox) -> dict[str, list[list[tuple[float, float]]]]:
    w, s, e, n = bbox
    out: dict[str, list] = {"road": [], "river": [], "lake": [], "building": []}
    for el in raw.get("elements", []):
        if el.get("type") != "way" or "geometry" not in el:
            continue
        kind = classify(el.get("tags", {}))
        if kind is None:
            continue
        pts = [
            (round((p["lon"] - w) / (e - w), 5), round((n - p["lat"]) / (n - s), 5))
            for p in el["geometry"]
        ]
        if len(pts) >= 2:
            out[kind].append(pts)
    return out


def features(bbox, client: httpx.Client | None = None, buildings: bool = False):
    out = normalise(_run(core_query(bbox), client), bbox)
    if buildings:
        try:
            out["building"] = normalise(_run(buildings_query(bbox), client), bbox)["building"]
        except RuntimeError:
            pass  # best-effort; retried on next request
    return out
