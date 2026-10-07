"""herders.json must be sourced: every fact has text, source, a https url and a checked date; the JS module exists."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "web" / "data" / "diorama" / "herders.json"


def load():
    return json.loads(DATA.read_text(encoding="utf-8"))


def test_schema_and_sources():
    d = load()
    assert d["title"] and d["note"] and d["label"]
    assert set(d["seasons"]) == {"Summer", "Autumn", "Winter"}
    assert d["facts"], "at least one fact"
    for f in d["facts"]:
        for key in ("text", "source", "url", "checked"):
            assert isinstance(f.get(key), str) and f[key].strip(), f"empty {key}: {f}"
        assert f["url"].startswith("https://"), f["url"]
        assert f["checked"] == "2026-10-08"


def test_label_is_illustrative_and_sourced():
    d = load()
    assert d["label"].startswith("Herders' flock (illustrative; ")
    assert d["label"].endswith(")")


def test_estimates_are_labelled():
    # a fact that states months must come from a source; "estimate" entries must say so in the text
    for f in load()["facts"]:
        if f.get("estimate"):
            assert f["text"].startswith("Estimate:")


def test_module_exports_class_and_caps_animals():
    src = (ROOT / "web" / "js" / "diorama" / "herders.js").read_text(encoding="utf-8")
    assert re.search(r"export class Herders\b", src)
    assert re.search(r"const MAX = 300;", src)
    for m in ("setSeason(name)", "update(dt, elapsed)"):
        assert m in src
