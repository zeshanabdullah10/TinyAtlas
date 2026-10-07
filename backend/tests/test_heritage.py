"""Checks web/data/heritage.json: every slug exists in the swat-lower places.json, and every sourced statement has source, url and checked."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERITAGE = ROOT / "web" / "data" / "heritage.json"
PLACES = ROOT / "data" / "packs" / "swat-lower" / "atlas" / "places.json"

SOURCED_KEYS = {"period", "conservation"}          # single objects
SOURCED_LISTS = {"excavations", "records_held_by", "further_reading"}


def load():
    return json.loads(HERITAGE.read_text(encoding="utf8"))


def place_slugs():
    data = json.loads(PLACES.read_text(encoding="utf8"))
    items = data if isinstance(data, list) else data.get("places", [])
    return {p["slug"] for p in items}


def leaves(entry):
    """Yield every sourced leaf object in one site entry."""
    for k in SOURCED_KEYS:
        if k in entry:
            yield f"{k}", entry[k]
    for k in SOURCED_LISTS:
        for i, item in enumerate(entry.get(k, [])):
            yield f"{k}[{i}]", item
    for i, d in enumerate(entry.get("disputed", [])):
        assert d.get("claim"), f"disputed[{i}] has no claim"
        assert len(d.get("views", [])) >= 1, f"disputed[{i}] has no views"
        for j, v in enumerate(d["views"]):
            yield f"disputed[{i}].views[{j}]", v


def test_every_slug_exists_in_places():
    slugs = place_slugs()
    for key, entry in load().items():
        if key.startswith("_"):
            continue
        assert key in slugs, f"{key} is not in places.json"
        assert entry.get("slug") == key, f"{key}: slug field mismatch"


def test_every_statement_has_source_url_and_checked():
    for key, entry in load().items():
        if key.startswith("_"):
            continue
        for where, leaf in leaves(entry):
            for field in ("source", "url", "checked"):
                assert leaf.get(field), f"{key}.{where} missing {field}"
            assert leaf["url"].startswith("https://"), f"{key}.{where} url is not https"
            text = leaf.get("text") or leaf.get("name") or leaf.get("status") or leaf.get("title") or leaf.get("years")
            assert text, f"{key}.{where} has no statement text"


def test_no_empty_fields():
    for key, entry in load().items():
        if key.startswith("_"):
            continue
        for field, value in entry.items():
            assert value not in (None, "", [], {}), f"{key}.{field} is empty"
