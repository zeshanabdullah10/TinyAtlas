import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "web" / "data" / "floods.json"
URL_RE = re.compile(r"^https?://")


@pytest.fixture(scope="module")
def doc():
    return json.loads(DATA.read_text(encoding="utf-8"))


def test_years_and_shape(doc):
    years = [e["year"] for e in doc["events"]]
    assert set(years) <= {2010, 2022} and len(years) == len(set(years))
    for e in doc["events"]:
        assert e["summary"].strip()
        assert isinstance(e["facts"], list)


def test_every_fact_is_sourced(doc):
    for e in doc["events"]:
        for f in e["facts"]:
            for k in ("text", "source", "url", "checked"):
                assert str(f.get(k, "")).strip(), (e["year"], k)
            assert URL_RE.match(f["url"]), f["url"]
            assert f["checked"] == "2026-10-08"


def test_extent_is_null_or_complete(doc):
    for e in doc["events"]:
        ext = e["extent"]
        if ext is None:
            continue
        for k in ("source", "licence", "url", "pack"):
            assert str(ext.get(k, "")).strip(), (e["year"], k)
        assert ext["pack"] in ("swat", "swat-lower")
        assert ext["polys"] and all(len(r) >= 3 for r in ext["polys"])


def test_build_validator_passes():
    import sys
    sys.path.insert(0, str(ROOT / "backend" / "tools"))
    import flood_build
    assert flood_build.validate(json.loads(DATA.read_text(encoding="utf-8"))) == []


def test_utm_projection_sanity():
    import sys
    sys.path.insert(0, str(ROOT / "backend" / "tools"))
    import flood_build
    # Kalam (35.488 N, 72.583 E) must land inside the Swat pack frame (74.1 km x 62.9 km).
    E, N = flood_build.lonlat_to_utm43n(72.5830, 35.4880)
    x, z = E - 236280.0, 3971220.0 - N
    assert 0 < x < 74100 and 0 < z < 62910
    assert abs(x - 44460) < 50 and abs(z - 41372) < 50
