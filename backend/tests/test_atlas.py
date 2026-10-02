"""Atlas places: the Swat regions, short label names, files.json, and the pack-backed planner catalogue."""
import importlib.util
import json
import struct
import sys
from pathlib import Path

import pytest
from tinyatlas import atlaspack, planner, regions

TOOLS = Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))
import shortname  # noqa: E402

REAL = Path(__file__).resolve().parents[2] / "data" / "packs"


def _atlas_pack_module():
    spec = importlib.util.spec_from_file_location("atlas_pack_tool", TOOLS / "atlas_pack.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---------- regions ----------
@pytest.mark.parametrize("slug", ["swat", "swat-lower"])
def test_swat_regions_are_atlas_places_with_landmarks_inside_the_bbox(slug):
    cfg = regions.REGIONS[slug]
    assert cfg["atlas"] == slug and cfg["builtin"] is True and cfg["landmarks"]
    w, s, e, n = cfg["bbox"]
    assert w <= cfg["center"][1] <= e and s <= cfg["center"][0] <= n
    for lm in cfg["landmarks"]:
        assert w <= lm["lon"] <= e and s <= lm["lat"] <= n, lm["title"]
        assert lm["slug"] and lm["title"]
    titles = {lm["title"] for lm in cfg["landmarks"]}
    assert len(titles) == len(cfg["landmarks"]) and cfg["tours"]
    for tour in cfg["tours"]:
        assert set(tour["stops"]) <= titles


def test_swat_names_and_regular_regions_have_no_atlas_field():
    assert regions.REGIONS["swat"]["name"] == "Swat Valley" and regions.REGIONS["swat-lower"]["name"] == "Lower Swat"
    assert "atlas" not in regions.REGIONS["hunza"]


@pytest.mark.skipif(not (REAL / "swat" / "atlas" / "places.json").exists(), reason="Atlas packs are not built here")
@pytest.mark.parametrize("slug", ["swat", "swat-lower"])
def test_landmarks_exist_in_the_pack(slug):
    by = {p["slug"]: p for p in atlaspack.places(slug)}
    for lm in regions.REGIONS[slug]["landmarks"]:
        assert lm["slug"] in by, lm["slug"]


# ---------- short names ----------
@pytest.mark.parametrize("name,short", [
    ("Bahrain (Behrain)", "Bahrain"),
    ("Saidu Sharif I Stupa and Monastery", "Saidu Sharif Stupa"),         # override
    ("Mahmud Ghaznavi Mosque (Udegram)", "Mahmud Ghaznavi Mosque"),      # parenthetical dropped, exactly 22 chars
    ("Malam Jabba Ski Resort", "Malam Jabba"),                           # suffix rule
    ("Kalam", "Kalam"),
])
def test_short_name_rules(name, short):
    assert shortname.short_name(name) == short


def test_short_name_never_exceeds_the_chip_length():
    s = shortname.short_name("The Extraordinarily Long Archaeological Museum of Upper Swat")
    assert len(s) <= shortname.MAXLEN and s.endswith("…")


# ---------- files.json ----------
def test_list_files_skips_debug_and_bake_files(tmp_path):
    tool = _atlas_pack_module()
    (tmp_path / "albedo").mkdir()
    (tmp_path / "_bake" / "raw").mkdir(parents=True)
    (tmp_path / "meta.json").write_text("{}")
    (tmp_path / "albedo" / "a.webp").write_bytes(b"12345")
    (tmp_path / "_check.png").write_bytes(b"x")
    (tmp_path / "_bake" / "raw" / "t.exr").write_bytes(b"x")
    (tmp_path / "files.json").write_text("[]")
    assert tool.list_files(tmp_path) == [{"path": "albedo/a.webp", "bytes": 5}, {"path": "meta.json", "bytes": 2}]


@pytest.mark.skipif(not (REAL / "swat" / "atlas" / "files.json").exists(), reason="files.json has not been written")
@pytest.mark.parametrize("slug", ["swat", "swat-lower"])
def test_built_files_json_lists_existing_files(slug):
    d = REAL / slug / "atlas"
    files = json.loads((d / "files.json").read_text(encoding="utf-8"))
    assert files and all((d / f["path"]).is_file() and (d / f["path"]).stat().st_size == f["bytes"] for f in files)
    assert not any(f["path"] in ("_check.png", "files.json") or "_bake" in f["path"] for f in files)


# ---------- planner catalogue from a pack ----------
@pytest.fixture
def tiny_pack(tmp_path, monkeypatch):
    """A 20 x 10 cell pack, 100 m cells: a paved road along the middle with three places on it, and one far off it."""
    d = tmp_path / "tiny" / "atlas"
    d.mkdir(parents=True)
    cols, rows, res = 20, 10, 100
    (d / "meta.json").write_text(json.dumps({"cols": cols, "rows": rows, "res_m": res, "hmin": 1000.0, "hmax": 1655.35}))
    (d / "height.bin").write_bytes(struct.pack(f"<{cols * rows}H", *[c * 1000 for _ in range(rows) for c in range(cols)]))
    road = [[x, 500.0] for x in range(100, 1901, 100)]
    (d / "vectors.json").write_text(json.dumps({"roads": [{"class": "paved", "pts": road}, {"class": "path", "pts": [[1900, 500], [1900, 900]]}]}))
    (d / "places.json").write_text(json.dumps([{"slug": s, "x": x, "z": z, "summary": f"About {s}.", "facts": []}
                                               for s, x, z in (("a", 100, 500), ("b", 1000, 520), ("c", 1900, 500), ("far", 300, 50))]))
    monkeypatch.setattr(atlaspack, "PACKS", tmp_path)
    for fn in (atlaspack.meta, atlaspack.places, atlaspack._height, atlaspack.network, planner._atlas_catalog):
        fn.cache_clear()
    cfg = {"atlas": "tiny", "bbox": (0, 0, 1, 1), "landmarks": [{"title": s.upper(), "slug": s, "kind": "town", "lat": 0.5, "lon": 0.5} for s in ("a", "b", "c", "far")]}
    yield cfg
    for fn in (atlaspack.meta, atlaspack.places, atlaspack._height, atlaspack.network, planner._atlas_catalog):
        fn.cache_clear()


def test_atlas_catalog_measures_legs_on_the_pack_roads(tiny_pack):
    lms = atlaspack.landmarks("tiny", tiny_pack)
    assert [l["slug"] for l in lms] == ["a", "b", "c", "far"] and lms[0]["u"] == pytest.approx(0.05)
    stops, legs = planner.catalog("tiny", tiny_pack, lms)
    assert stops["a"]["elev"] < stops["c"]["elev"]                       # heights come from height.bin
    leg = legs[("a", "c")]
    assert leg["mode"] == "road" and leg["km"] == pytest.approx(1.8, abs=0.05)
    assert leg["path"][0][0] < leg["path"][-1][0] and all(0 <= p[0] <= 1 and 0 <= p[1] <= 1 for p in leg["path"])
    assert ("a", "far") in legs                                          # 450 m from the road: still snaps (limit 2 km)
    assert legs[("a", "b")]["min"] < legs[("a", "c")]["min"]


def test_jeep_edges_are_slower_than_paved_of_the_same_length(tiny_pack, tmp_path):
    d = tmp_path / "tiny" / "atlas"
    v = {"roads": [{"class": "paved", "pts": [[100, 100], [900, 100]]}, {"class": "jeep", "pts": [[100, 300], [900, 300]]}]}
    (d / "vectors.json").write_text(json.dumps(v))
    atlaspack.network.cache_clear()
    adj, _ = atlaspack.network("tiny")
    paved = next(e for n, es in adj.items() if abs(n[1] - 0.1) < 1e-6 for e in es)
    jeep = next(e for n, es in adj.items() if abs(n[1] - 0.3) < 1e-6 for e in es)
    assert paved[2] == pytest.approx(jeep[2]) and jeep[1] > paved[1] * 2.5
