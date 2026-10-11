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


def _web_files():
    return list((ROOT / "js").rglob("*.js")) + list(ROOT.glob("*.html"))


def test_data_i18n_marks_use_known_keys():
    en, ur = load(EN), load(UR)["strings"]
    bad = []
    for f in ROOT.glob("*.html"):
        soup = BeautifulSoup(f.read_text(encoding="utf-8"), "html.parser")
        for el in soup.select("[data-i18n]"):
            bad += [(f.name, el["data-i18n"])] if el["data-i18n"] not in en or el["data-i18n"] not in ur else []
        for el in soup.select("[data-i18n-attr]"):
            for pair in el["data-i18n-attr"].split(";"):
                k = pair.split(":")[1].strip()
                bad += [(f.name, k)] if k not in en or k not in ur else []
    assert not bad, bad


def test_tr_calls_match_the_english_table():
    """tr("key", "English") in code: the key must exist in both tables and the English text must equal en.json (no drift)."""
    import re
    en, ur = load(EN), load(UR)["strings"]
    rx = re.compile(r'\btr\(\s*"([A-Za-z0-9_.\-]+)"\s*,\s*"((?:[^"\\]|\\.)*)"')
    bad = []
    for f in _web_files():
        if f.name == "i18n.js":
            continue
        for k, fb in rx.findall(f.read_text(encoding="utf-8")):
            fb = json.loads(f'"{fb}"') if "\\" in fb else fb
            if k not in en or k not in ur or en[k] != fb:
                bad.append((f.name, k))
    assert not bad, bad


def test_urdu_keeps_the_placeholders():
    import re
    en, ur = load(EN), load(UR)["strings"]
    ph = lambda s: sorted(re.findall(r"\{(\w+)\}", s))
    bad = [k for k in en if k in ur and ph(en[k]) != ph(ur[k])]
    assert not bad, bad


@pytest.mark.parametrize("page", list(PAGES))
def test_map_entries_still_point_at_their_english_text(page):
    """A selector that shifts when markup is added would put the wrong sentence on an element; the English must still match."""
    soup = BeautifulSoup((ROOT / PAGES[page]).read_text(encoding="utf-8"), "html.parser")
    en = load(EN)
    norm = lambda s: " ".join(str(s).split())
    bad = []
    for e in load(MAP)[page]:
        el = soup.select(e["sel"])[0]
        if e.get("attr"):
            cur = el.get(e["attr"], "")
        elif "text" in e:
            cur = [s for s in el.find_all(string=True, recursive=False) if s.strip()][e["text"]]
        else:
            cur = el.get_text()
        if norm(cur) != norm(en[e["key"]]):
            bad.append((e["sel"][-50:], norm(cur)[:40], e["key"]))
    assert not bad, bad
