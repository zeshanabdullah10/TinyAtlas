"""Place search (Nominatim) and region extents.

A region is a fixed-size window around the searched place: big enough to hold a valley or a town with its
surroundings, small enough that terrain, OSM and painting stay quick. Results are cached on disk, and the
usage policy is respected (identifying User-Agent, results cached, no bulk queries).
"""
import hashlib
import json
import math
import re
from pathlib import Path

import httpx

URL = "https://nominatim.openstreetmap.org/search"
HEADERS = {"User-Agent": "TinyAtlas/0.1 (https://github.com/zeshanabdullah10/tinyatlas; open-source map project) httpx"}
CACHE = Path(__file__).resolve().parents[2] / "data" / "geo"
LATLON = re.compile(r"^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$")

WIDTH_KM, HEIGHT_KM = 36.0, 28.0


def make_bbox(lat: float, lon: float, width_km: float = WIDTH_KM, height_km: float = HEIGHT_KM):
    """(west, south, east, north) of a width x height km window centred on lat, lon."""
    dlat = height_km / 2 / 110.54
    dlon = width_km / 2 / (111.32 * max(math.cos(math.radians(lat)), 0.05))
    return (round(lon - dlon, 5), round(lat - dlat, 5), round(lon + dlon, 5), round(lat + dlat, 5))


def _subtitle(display: str, name: str) -> str:
    """'Zermatt, Visp, Oberwallis, Valais/Wallis, 3920, Schweiz/Suisse/Svizzera/Svizra' -> 'Valais/Wallis, Schweiz'."""
    parts = [p.strip() for p in display.split(",") if p.strip() and not p.strip().isdigit()]
    parts = [p for p in parts if p != name]
    if len(parts) >= 2:
        parts = [parts[-2], parts[-1]]
    return ", ".join(p.split("/")[0] for p in parts)


def search(query: str, limit: int = 5, client: httpx.Client | None = None) -> list[dict]:
    """Candidates for a place name (or a 'lat, lon' pair): [{name, subtitle, lat, lon, kind, importance}]."""
    query = query.strip()
    if not query:
        return []
    m = LATLON.match(query)
    if m:
        lat, lon = float(m.group(1)), float(m.group(2))
        if abs(lat) <= 90 and abs(lon) <= 180:
            return [{"name": f"{lat:.3f}, {lon:.3f}", "subtitle": "Custom coordinates", "lat": lat, "lon": lon,
                     "kind": "coordinates", "importance": 1.0}]
    key = hashlib.sha1(f"{query.lower()}|{limit}".encode()).hexdigest()[:16]
    path = CACHE / f"{key}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    c = client or httpx
    r = c.get(URL, headers=HEADERS, timeout=30, params={
        "q": query, "format": "jsonv2", "limit": limit, "addressdetails": 0, "accept-language": "en"})
    r.raise_for_status()
    out = []
    for x in r.json():
        name = x.get("name") or x["display_name"].split(",")[0]
        out.append({"name": name, "subtitle": _subtitle(x["display_name"], name), "lat": float(x["lat"]),
                    "lon": float(x["lon"]), "kind": x.get("type", ""), "importance": float(x.get("importance", 0))})
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    return out
