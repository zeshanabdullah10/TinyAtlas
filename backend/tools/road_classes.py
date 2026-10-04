"""Classify the lower-Swat OSM roads from their surface / smoothness / tracktype tags (evidence only).

Reads the cached raw Overpass response (no network) and writes data/research/swat_lower_road_classes.json.
Only ways whose class differs from the highway-tag fallback, or that carry evidence tags, are listed.
Run: python -X utf8 backend/tools/road_classes.py
"""
import json, math
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "data/cache/osm/72.0_34.58_72.7_35.3_roads.json"
OUT = ROOT / "data/research/swat_lower_road_classes.json"

HWY_CLASS = {"motorway": "paved", "trunk": "paved", "primary": "paved", "secondary": "paved", "tertiary": "jeep",
             "unclassified": "minor", "residential": "minor", "service": "minor", "living_street": "minor",
             "track": "track", "path": "path", "footway": "path", "steps": "path", "bridleway": "path", "cycleway": "path"}
PATHS = {"path", "footway", "steps", "bridleway", "cycleway"}
MAIN = {"motorway", "trunk", "primary", "secondary", "tertiary"}
LOCAL = {"unclassified", "residential", "living_street", "service"}
SEALED = {"asphalt", "paved", "paving_stones", "sett", "chipseal"}
UNSEALED = {"unpaved", "ground", "dirt", "earth", "gravel", "fine_gravel", "compacted", "mud", "sand", "pebblestone"}
BAD = {"bad", "very_bad", "horrible"}
GOOD = {"good", "excellent", "intermediate"}
WORST = {"very_bad", "horrible", "impassable"}


def classify(highway, surface=None, tracktype=None, smoothness=None):
    """-> (class, reason). Direct renderer class paved|minor|jeep|track|path. Pure function."""
    hw = str(highway).replace("_link", "")
    fb = HWY_CLASS.get(hw, "minor")
    if hw in PATHS:
        return "path", "path-family highway tag"
    if hw == "track":
        if tracktype == "grade1":
            return "minor", "tracktype=grade1"
        return "track", ("tracktype=%s" % tracktype) if tracktype else "highway=track"
    sealed = bool(surface) and (surface in SEALED or surface.startswith("concrete"))
    if sealed:
        if smoothness in BAD:
            return "minor", "surface=%s but smoothness=%s" % (surface, smoothness)
        if hw in MAIN:
            return "paved", "surface=%s" % surface
        if hw in LOCAL:
            return "minor", "surface=%s on highway=%s" % (surface, hw)
    if surface in UNSEALED:
        if hw in MAIN or hw == "unclassified":
            return "jeep", "surface=%s" % surface
        if hw in LOCAL:
            return "minor", "surface=%s on highway=%s" % (surface, hw)
    if smoothness in GOOD and hw == "tertiary":
        return "paved", "smoothness=%s" % smoothness
    if smoothness in WORST:
        return "jeep", "smoothness=%s" % smoothness
    return fb, "highway tag only"


def _km(geom):
    s = 0.0
    for a, b in zip(geom, geom[1:]):
        dx = math.radians(b["lon"] - a["lon"]) * math.cos(math.radians(a["lat"]))
        dy = math.radians(b["lat"] - a["lat"])
        s += 6371.0088 * math.hypot(dx, dy)
    return s


def main():
    els = json.loads(SRC.read_text(encoding="utf-8"))["elements"]
    ways, counts, km = [], Counter(), Counter()
    for e in els:
        t = e.get("tags") or {}
        hw = t.get("highway")
        if not hw or "geometry" not in e:
            continue
        s, tt, sm = t.get("surface"), t.get("tracktype"), t.get("smoothness")
        c, reason = classify(hw, s, tt, sm)
        fb = HWY_CLASS.get(hw.replace("_link", ""), "minor")
        if c == fb and not (s or tt or sm):
            continue
        if c == fb and reason == "highway tag only":
            reason = "highway tag only (surface/smoothness tags do not change the class)"
        ways.append({"way_id": e["id"], "highway": hw, "surface": s, "tracktype": tt, "smoothness": sm, "class": c, "reason": reason})
        counts[c] += 1
        km[c] += _km(e["geometry"])
    OUT.write_text(json.dumps({
        "note": "Lower-Swat road classes from OSM surface/smoothness/tracktype tags (data/cache/osm/72.0_34.58_72.7_35.3_roads.json). "
                "class is the direct renderer class; rules in backend/tools/road_classes.py. Ways not listed keep the highway-tag class. Evidence only, nothing inferred.",
        "counts": dict(counts), "length_km": {k: round(v, 1) for k, v in km.items()}, "ways": ways}, indent=1), encoding="utf-8")
    print(len(ways), dict(counts), {k: round(v, 1) for k, v in km.items()})


if __name__ == "__main__":
    main()
