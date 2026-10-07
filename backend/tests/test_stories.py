"""Story flight data (web/data/stories/swat-road.json): schema, sourced captions, and stop slugs that exist in the packs."""
import json
from datetime import date
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
STORIES = ROOT / "web" / "data" / "stories" / "swat-road.json"
CHECKED = "2026-10-08"


def _load():
    return json.loads(STORIES.read_text(encoding="utf-8"))


def _places(pack):
    p = ROOT / "data" / "packs" / pack / "atlas" / "places.json"
    if not p.exists():
        pytest.skip(f"pack {pack} not built on this machine")
    return {q["slug"]: q for q in json.loads(p.read_text(encoding="utf-8"))}


def test_schema_and_no_empty_fields():
    data = _load()
    assert isinstance(data.get("stories"), list) and data["stories"]
    for s in data["stories"]:
        for key in ("id", "pack", "title", "stops"):
            assert s.get(key), f"{s.get('id')}: missing {key}"
        assert s["pack"] in ("swat", "swat-lower")
        assert len(s["stops"]) >= 2, s["id"]
        for st in s["stops"]:
            for key in ("slug", "name", "caption", "sources"):
                assert st.get(key), f"{s['id']}/{st.get('slug')}: missing {key}"


def test_stop_slugs_exist_in_pack_places():
    for s in _load()["stories"]:
        places = _places(s["pack"])
        for st in s["stops"]:
            assert st["slug"] in places, f"{st['slug']} not in pack {s['pack']}"
            assert places[st["slug"]]["name"] == st["name"]


def test_captions_quote_places_json_facts_and_fit_card():
    for s in _load()["stories"]:
        places = _places(s["pack"])
        for st in s["stops"]:
            cap = st["caption"]
            assert len(cap) <= 200, f"{st['slug']} caption is {len(cap)} chars"
            facts = places[st["slug"]].get("facts") or []
            fact_texts = [f["text"] for f in facts]
            joined = " ".join(fact_texts)
            assert cap in joined, f"{st['slug']} caption is not places.json fact text"


def test_every_source_has_url_and_checked_date():
    for s in _load()["stories"]:
        for st in s["stops"]:
            assert st["sources"], st["slug"]
            for src in st["sources"]:
                assert src["url"].startswith("https://"), st["slug"]
                assert src["checked"] == CHECKED
                date.fromisoformat(src["checked"])
                assert src.get("quote_verified") is True, st["slug"]
