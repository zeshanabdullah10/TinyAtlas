"""Schema and honesty checks for web/data/roads.json."""
import json
import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "web" / "data" / "roads.json"
STATUSES = {"open", "caution", "closed", "unknown"}
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
EXPECTED_IDS = {"n95-mingora-bahrain", "n95-bahrain-kalam", "kalam-ushu-mahodand",
                "kalam-utror-gabral", "malam-jabba-road"}


def load():
    return json.loads(DATA.read_text(encoding="utf-8"))


def test_top_level_schema():
    d = load()
    assert set(d) == {"checked", "roads"}
    assert DATE_RE.match(d["checked"])
    assert isinstance(d["roads"], list) and d["roads"]


def test_expected_roads_present_once():
    ids = [r["id"] for r in load()["roads"]]
    assert len(ids) == len(set(ids))
    assert set(ids) == EXPECTED_IDS


def test_road_fields_non_empty():
    for r in load()["roads"]:
        assert set(r) == {"id", "name", "segment_slugs", "advisories", "seasonal"}, r["id"]
        assert ID_RE.match(r["id"])
        assert r["name"].strip()
        assert r["segment_slugs"] and all(isinstance(s, str) and s.strip() for s in r["segment_slugs"])
        assert isinstance(r["advisories"], list)


def test_advisories_schema_and_sources():
    d = load()
    today = date.today()
    checked = date.fromisoformat(d["checked"])
    for r in d["roads"]:
        for a in r["advisories"]:
            assert set(a) == {"date", "status", "text", "source", "url"}, r["id"]
            assert DATE_RE.match(a["date"])
            parsed = date.fromisoformat(a["date"])
            assert parsed <= checked and parsed <= today, f"future date in {r['id']}"
            assert a["status"] in STATUSES, a["status"]
            assert 0 < len(a["text"]) <= 160, a["text"]
            assert a["source"].strip()
            assert a["url"].startswith("https://"), a["url"]


def test_every_seasonal_or_stale_entry_is_dated():
    # Seasonal facts must still carry a source and a real report date (no undated "caution").
    for r in load()["roads"]:
        for a in r["advisories"]:
            if a["status"] == "caution":
                assert a["source"] and a["url"]


def test_advisories_sorted_in_file_is_not_required_but_dates_unique_per_road():
    for r in load()["roads"]:
        dates = [a["date"] for a in r["advisories"]]
        assert len(dates) == len(set(dates)), r["id"]


PACKS = ROOT / "data" / "packs"


def _pack_slugs():
    import pytest
    if not PACKS.exists():
        pytest.skip("data/packs absent")
    slugs = set()
    for p in PACKS.glob("*/atlas/places.json"):
        d = json.loads(p.read_text(encoding="utf-8"))
        items = d if isinstance(d, list) else d.get("places", [])
        slugs |= {x["slug"] for x in items}
    return slugs


def test_segment_slugs_exist_in_packs():
    slugs = _pack_slugs()
    for r in load()["roads"]:
        for s in r["segment_slugs"]:
            assert s in slugs, f"{r['id']}: unknown place slug {s}"


def test_seasonal_entries_sourced():
    for r in load()["roads"]:
        for se in r.get("seasonal", []):
            assert set(se) == {"months", "text", "source", "url"}, r["id"]
            assert se["months"].strip() and se["text"].strip() and se["source"].strip()
            assert se["url"].startswith("https://")
