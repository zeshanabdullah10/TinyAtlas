"""Schema checks for web/data/voices.json (Voices of the valley)."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "web" / "data" / "voices.json"
DOC = ROOT / "docs" / "voices-consent.md"
LICENCES = {"CC BY-SA 4.0", "CC BY-NC 4.0"}


def load():
    return json.loads(DATA.read_text(encoding="utf-8"))


def test_status_and_top_keys():
    d = load()
    assert d["_status"] == "no recordings yet" or d["recordings"]
    assert isinstance(d["languages"], list) and d["languages"]
    assert isinstance(d["recordings"], list)


def test_languages_have_fields_and_sources():
    for l in load()["languages"]:
        for key in ("code", "name", "where_spoken", "speakers_estimate", "status", "source", "url", "checked"):
            assert str(l.get(key, "")).strip(), f"{l.get('name')}: empty {key}"
        assert l["url"].startswith("https://"), l["name"]
        assert isinstance(l.get("places", []), list)
        assert isinstance(l.get("also_known_as", []), list)


def test_language_codes_unique():
    codes = [l["code"] for l in load()["languages"]]
    assert len(codes) == len(set(codes))


def test_recordings_have_consent_licence_credit():
    langs = {l["code"] for l in load()["languages"]}
    ids = set()
    for r in load()["recordings"]:
        assert r.get("id") and r["id"] not in ids, r
        ids.add(r["id"])
        assert r.get("consent_ref", "").strip(), r["id"]
        assert r.get("licence") in LICENCES, r["id"]
        assert r.get("speaker_credit", "").strip(), r["id"]
        assert r.get("lang") in langs, r["id"]
        assert r.get("place_slug", "").strip(), r["id"]
        assert r.get("recorded_on", "").strip(), r["id"]


def test_consent_doc_exists_and_cites_sources():
    text = DOC.read_text(encoding="utf-8")
    assert "consent" in text.lower()
    assert "https://oralhistory.org/" in text
    assert "https://creativecommons.org/licenses/by-sa/4.0/" in text


def test_consent_page_exists_and_linked():
    page = ROOT / "web" / "voices-consent.html"
    assert page.exists()
    assert "voices-consent.html" in (ROOT / "web" / "js" / "voices.js").read_text(encoding="utf-8")
