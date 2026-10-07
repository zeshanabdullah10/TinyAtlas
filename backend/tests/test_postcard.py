import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
JS = (ROOT / "web/js/postcard.js").read_text(encoding="utf-8")


def test_files_exist():
    for rel in ["web/js/postcard.js", "web/css/postcard.css", "web/dev/postcard.html"]:
        assert (ROOT / rel).is_file(), rel


def test_exports():
    for name in ["makePostcard", "sharePostcard", "postcardSheet"]:
        assert re.search(rf"export\s+(async\s+)?function\s+{name}\s*\(", JS), name


def test_wording_present():
    assert "Copernicus DEM, ESA WorldCover, OpenStreetMap" in JS
    assert "Scene painted; heights and roads are real" in JS
    assert "wa.me" in JS
