"""Bring a built diorama's meta.json up to date with its site entry, without a rebuild.

    python backend/tools/diorama_meta_sync.py <site> [<site> ...]      (or --all)

For sites whose build inputs (OSM extract, Sentinel-2 scene) are not in this checkout, so a rebuild would not
reproduce the same ground. Only words and switches that come from the site entry are touched, the same way
diorama_build.py writes them: title, subtitle, pack, road, road_kind, built_up, lake_life, and the generic lines in
`edits` (the lake camp, the buildings, the road's name for itself, duplicates). Grids, drive, walk, facts and sources are left as built.
Running it on a freshly built site changes nothing.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from diorama_build import ROOT, SITES  # noqa: E402

CAMP = "At the lake, the positions of the boats, tents, tea stalls and horses are illustrative"


def sync(name):
    site, f = SITES[name], ROOT / "web" / "data" / "diorama" / name / "meta.json"
    meta = json.loads(f.read_text(encoding="utf-8"))
    before = json.dumps(meta, ensure_ascii=False, separators=(",", ":"))
    for k in ("title", "subtitle"):
        meta[k] = site[k]
    meta["road"], meta["pack"] = site.get("road", "Mahodand Lake Road"), site.get("pack", "swat")
    for k in ("built_up", "road_kind", "lake_life"):
        v = site.get(k) if k != "lake_life" or meta.get("lake") else None
        if v:
            meta[k] = True if k != "road_kind" else v
        else:
            meta.pop(k, None)
    try:
        has_photos = bool(json.loads((f.parent / "photos.json").read_text(encoding="utf-8")))
    except (OSError, ValueError):
        has_photos = False
    n, edits = len(meta.get("buildings") or []), []
    way = "road" if site.get("road_kind") == "road" else "jeep track"
    for e in meta["edits"]:
        if e.startswith("A bench up to 24 m wide is cut along the "):
            e = f"A bench up to 24 m wide is cut along the {way} to its smoothed profile (the 30 m DSM includes tree canopy)."
        if e.startswith("Road bumps and ruts in the drive are illustrative"):
            e = f"Road bumps and ruts in the drive are illustrative; the grade and the line of the {way} are real."
        if e.startswith(CAMP) and not meta.get("lake_life"):
            continue                                        # no camp is drawn where the sources don't describe one
        if n and e.startswith(f"The {n} buildings stand on their OSM footprints") or e.startswith("The building stands on its OSM footprint"):
            e = (("The building stands on its OSM footprint; its" if n == 1 else f"The {n} buildings stand on their OSM footprints; their")
                 + " height (OSM levels where mapped, else one or two storeys), roofs and colours are illustrative"
                 + (", after visitors' photos." if has_photos else "."))
        edits.append(e)
    meta["edits"] = list(dict.fromkeys(edits))
    after = json.dumps(meta, ensure_ascii=False, separators=(",", ":"))
    if after != before:
        f.write_text(after, encoding="utf-8")
    return after != before


if __name__ == "__main__":
    names = sorted(p.parent.name for p in (ROOT / "web" / "data" / "diorama").glob("*/meta.json")) if sys.argv[1:] == ["--all"] else sys.argv[1:]
    for s in names:
        print(s, "updated" if sync(s) else "unchanged")
