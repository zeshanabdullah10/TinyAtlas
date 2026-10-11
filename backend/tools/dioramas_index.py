"""Builds web/data/dioramas.json for the home page: one entry per site model (web/data/diorama/<site>/meta.json) and the
real counts behind the home page's stats strip (site models, audio clips from data/audio/*/audio.json).
Run after adding or removing a diorama or audio clip:  python3 backend/tools/dioramas_index.py"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KIND_LABEL = {"stupa": "Stupa", "rock_carving": "Rock carving", "waterfall": "Waterfall", "mosque": "Mosque", "museum": "Museum",
              "fort_ruin": "Fort ruin", "ski_resort": "Ski resort", "archaeological_site": "Archaeological site", "palace": "Palace",
              "lake": "Lake", "viewpoint": "Viewpoint"}


def kind_of(meta: dict) -> str:
    """The landmark kind, else 'lake' for a lake site, else the arrival kind (e.g. viewpoint)."""
    lm = meta.get("landmark") or {}
    if lm.get("kind"):
        return lm["kind"]
    if meta.get("lake"):
        return "lake"
    return (meta.get("arrival") or {}).get("kind") or "viewpoint"


def build() -> dict:
    sites = []
    for f in sorted((ROOT / "web" / "data" / "diorama").glob("*/meta.json")):
        m = json.loads(f.read_text(encoding="utf-8"))
        k = kind_of(m)
        sites.append({"site": m["site"], "title": m["title"], "subtitle": m.get("subtitle", ""), "pack": m.get("pack", ""),
                      "kind": k, "kind_label": KIND_LABEL.get(k, k.replace("_", " ").capitalize())})
    sites.sort(key=lambda s: s["title"].lower())
    clips = places = 0
    for f in sorted((ROOT / "data" / "audio").glob("*/audio.json")):
        a = json.loads(f.read_text(encoding="utf-8"))
        places += len(a)
        clips += sum(len(v) for v in a.values())
    return {"stats": {"site_models": len(sites), "audio_clips": clips, "audio_places": places}, "sites": sites}


if __name__ == "__main__":
    out = ROOT / "web" / "data" / "dioramas.json"
    data = build()
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{out}: {len(data['sites'])} sites, {data['stats']}")
