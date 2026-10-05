"""The committed diorama data (web/data/diorama/<site>/) must match its own meta.json and stay honest."""
import json
import math
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
SITES = sorted(p for p in (ROOT / "web" / "data" / "diorama").glob("*") if (p / "meta.json").exists())


@pytest.mark.parametrize("d", SITES, ids=lambda p: p.name)
def test_files_match_grid(d):
    m = json.loads((d / "meta.json").read_text(encoding="utf-8"))
    g, f = m["grid"], m["far"]
    assert (d / "height.bin").stat().st_size == g["cols"] * g["rows"] * 2
    assert (d / "cover.bin").stat().st_size == g["cols"] * g["rows"]
    assert (d / "far.bin").stat().st_size == f["cols"] * f["rows"] * 2
    assert (d / "farcover.bin").stat().st_size == f["cols"] * f["rows"]
    assert math.isclose(g["width"], (g["cols"] - 1) * g["cell"]) and math.isclose(g["height"], (g["rows"] - 1) * g["cell"])
    cover = np.frombuffer((d / "cover.bin").read_bytes(), np.uint8)
    assert set(np.unique(cover)) <= {1, 2, 3, 4, 5, 6, 7}
    if m["lake"]:
        assert (cover == 5).sum() * g["cell"] ** 2 / 1e6 == pytest.approx(m["facts"]["lake_area_km2"], abs=0.006)
    else:
        assert not (cover == 5).any(), "a site without a lake has no water cells"
    assert m["arrival"]["kind"] in ("lake", "viewpoint") and m["facts"]["arrival_m"] == round(m["arrival"]["y"])


@pytest.mark.parametrize("d", SITES, ids=lambda p: p.name)
def test_drive_is_on_the_model_and_ends_at_the_lake(d):
    m = json.loads((d / "meta.json").read_text(encoding="utf-8"))
    g = m["grid"]
    drive = np.array(m["drive"])
    assert len(drive) > 100
    assert np.all(np.abs(drive[:, 0]) < g["width"] / 2) and np.all(np.abs(drive[:, 1]) < g["height"] / 2)
    steps = np.hypot(*np.diff(drive[:, :2], axis=0).T)
    assert steps.max() < 6, "the drive is sampled about every 4 m"
    assert steps.sum() / 1000 == pytest.approx(m["facts"]["drive_km"], abs=0.02)
    # heights in the drive are the terrain under it (the bench is cut to them)
    h = np.frombuffer((d / "height.bin").read_bytes(), "<u2").reshape(g["rows"], g["cols"]) / 10 + g["hmin"]
    c = np.rint((drive[:, 0] + g["width"] / 2) / g["cell"]).astype(int)
    r = np.rint((drive[:, 1] + g["height"] / 2) / g["cell"]).astype(int)
    assert np.abs(h[r, c] - drive[:, 2]).max() < 1.5
    end = drive[-1, :2]
    if m["lake"]:
        cover = np.frombuffer((d / "cover.bin").read_bytes(), np.uint8).reshape(g["rows"], g["cols"])
        lr, lc = np.nonzero(cover == 5)
        gap = np.hypot(lc * g["cell"] - g["width"] / 2 - end[0], lr * g["cell"] - g["height"] / 2 - end[1]).min()
        assert gap < 60
        assert drive[-1, 2] == pytest.approx(m["lake"]["level"], abs=12)
    else:
        assert math.hypot(end[0] - m["arrival"]["x"], end[1] - m["arrival"]["z"]) < 150


@pytest.mark.parametrize("d", SITES, ids=lambda p: p.name)
def test_sources_and_edits_are_declared(d):
    m = json.loads((d / "meta.json").read_text(encoding="utf-8"))
    names = {s["name"] for s in m["sources"]}
    assert {"Copernicus DEM GLO-30", "ESA WorldCover 10 m 2021 v200", "OpenStreetMap"} <= names
    assert all(s["licence"] and s["url"].startswith("https://") for s in m["sources"])
    text = " ".join(m["edits"]).lower()
    for word in ("bench", "bumps", "trees", "season"):
        assert word in text
    if m["lake"]:
        assert "lake bed" in text


@pytest.mark.parametrize("d", SITES, ids=lambda p: p.name)
def test_optional_files_carry_sources(d):
    p = d / "practical.json"
    if p.exists():
        for it in json.loads(p.read_text(encoding="utf-8")):
            assert it["label"] and it["value"] and it["source"] and it["url"].startswith("https://") and it["quote"]
    p = d / "photos.json"
    if p.exists():
        for ph in json.loads(p.read_text(encoding="utf-8")):
            assert ph["author"] and ph["licence"].startswith("CC") and ph["page"].startswith("https://commons.wikimedia.org/")
            assert -90 < ph["lat"] < 90 and ph["thumb"].startswith("https://")
