import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EMERGENCY = ROOT / "web" / "data" / "emergency.json"
PACK = ROOT / "data" / "packs" / "swat" / "atlas"


def load_emergency():
    return json.loads(EMERGENCY.read_text(encoding="utf-8"))


def test_emergency_schema_and_sources():
    data = load_emergency()
    assert data["checked"] == "2026-10-08"
    assert data["numbers"], "at least one verified number"
    for n in data["numbers"]:
        for key in ("name", "number", "covers", "source", "url", "checked"):
            assert str(n.get(key, "")).strip(), f"{n.get('name')}: empty {key}"
        assert n["url"].startswith("https://"), n["name"]
        assert re.fullmatch(r"[0-9]{2,6}", n["number"]), n["name"]
        assert n["checked"] == "2026-10-08"


def test_no_911_and_no_duplicate_numbers():
    numbers = [n["number"] for n in load_emergency()["numbers"]]
    assert "911" not in numbers
    assert len(numbers) == len(set(numbers))


def test_pack_file_list_present_and_sizes_positive():
    files = json.loads((PACK / "files.json").read_text(encoding="utf-8"))
    assert files and all(isinstance(f["bytes"], int) and f["bytes"] > 0 for f in files)
    assert all(f["path"] for f in files)


def test_places_have_fields_the_print_page_uses():
    places = json.loads((PACK / "places.json").read_text(encoding="utf-8"))
    assert places
    for p in places:
        assert p["slug"] and p["name"], p
        assert "ground_m" in p and "summary" in p and "access" in p


def test_tripkit_js_exports_present():
    src = (ROOT / "web" / "js" / "tripkit.js").read_text(encoding="utf-8")
    for name in ("packSizeMB", "lowDataMode", "setLowDataMode", "tripKitPanel"):
        assert re.search(rf"export function {name}\b", src), name
