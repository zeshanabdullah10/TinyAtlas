"""Checks for the Urdu interface strings, the selector map and the phrase data."""
import json
from pathlib import Path

import pytest
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[2] / "web"
EN = ROOT / "data" / "i18n" / "en.json"
UR = ROOT / "data" / "i18n" / "ur.json"
MAP = ROOT / "data" / "i18n" / "map.json"
PHRASES = ROOT / "data" / "phrases.json"
PAGES = {"index": "index.html", "atlas": "atlas.html", "diorama": "diorama.html"}


def load(p):
    return json.loads(p.read_text(encoding="utf-8"))


def test_ur_has_status_and_every_en_key():
    en = load(EN)
    ur = load(UR)
    assert "draft" in ur["_status"].lower()
    missing = [k for k in en if k not in ur["strings"]]
    assert not missing, f"keys missing from ur.json: {missing}"


def test_no_empty_strings():
    en = load(EN)
    ur = load(UR)["strings"]
    for table, name in ((en, "en"), (ur, "ur")):
        empty = [k for k, v in table.items() if not isinstance(v, str) or not v.strip()]
        assert not empty, f"empty values in {name}: {empty}"


@pytest.mark.parametrize("page", list(PAGES))
def test_each_selector_matches_exactly_one_element(page):
    soup = BeautifulSoup((ROOT / PAGES[page]).read_text(encoding="utf-8"), "html.parser")
    entries = load(MAP)[page]
    en = load(EN)
    bad = []
    for e in entries:
        hits = soup.select(e["sel"])
        if len(hits) != 1:
            bad.append((e["sel"], len(hits)))
        if e["key"] not in en:
            bad.append(("unknown key", e["key"]))
        if "text" in e and hits:
            direct = [s for s in hits[0].find_all(string=True, recursive=False) if s.strip()]
            if len(direct) <= e["text"]:
                bad.append(("no text node", e["sel"], e["text"]))
    assert not bad, bad


def test_map_keys_all_exist_in_ur():
    ur = load(UR)["strings"]
    keys = {e["key"] for p in load(MAP).values() for e in p}
    assert keys <= set(ur), keys - set(ur)


def test_phrases_have_all_fields_and_sources():
    data = load(PHRASES)
    assert len(data["phrases"]) >= 30
    for p in data["phrases"]:
        for field in ("en", "ur", "roman_ur", "category", "source", "url", "checked"):
            assert isinstance(p.get(field), str) and p[field].strip(), (p.get("en"), field)
        assert p["url"].startswith("https://")
        assert p["checked"] == "2026-10-08"
        if p["category"] == "Emergencies":
            assert p.get("review") == "required", p["en"]
        assert any("\u0600" <= c <= "\u06ff" for c in p["ur"]), p["en"]


def test_place_phrases_have_placeholders():
    for p in load(PHRASES)["phrases"]:
        if "{place}" in p["en"]:
            assert p.get("placeholder") == "place" and "{place_ur}" in p["ur"] or "{place}" in p["roman_ur"]
