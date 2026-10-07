"""Checks for the "Where is this view?" round data (web/data/play/rounds.json)."""
import importlib.util
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ROUNDS = ROOT / "web" / "data" / "play" / "rounds.json"
PACKS = ROOT / "data" / "packs"

spec = importlib.util.spec_from_file_location("play_rounds", ROOT / "backend" / "tools" / "play_rounds.py")
play_rounds = importlib.util.module_from_spec(spec)
spec.loader.exec_module(play_rounds)


def load():
    return json.loads(ROUNDS.read_text(encoding="utf-8"))


def test_rounds_file_is_not_empty_and_ids_are_unique():
    rounds = load()
    assert len(rounds) >= 10, "a game needs 10 rounds"
    ids = [r["id"] for r in rounds]
    assert len(set(ids)) == len(ids)


def test_every_round_has_credit_licence_source_and_answer():
    for r in load():
        for key in ("id", "image", "credit", "licence", "source_url", "answer"):
            assert r.get(key), f"{r.get('id')}: missing {key}"
        assert r["source_url"].startswith("https://commons.wikimedia.org/wiki/File:"), r["id"]
        assert re.search(r"CC|Public domain|GFDL", r["licence"]), r["id"]
        assert r["licence"] in r["credit"], f"{r['id']}: licence not in credit line"


def test_answers_have_a_place_or_coordinates_and_a_map_position():
    for r in load():
        a = r["answer"]
        if "lat" in a:
            assert -90 <= a["lat"] <= 90 and -180 <= a["lon"] <= 180, r["id"]
        else:
            assert a.get("slug") and a.get("name") and a.get("pack"), r["id"]
        assert isinstance(a["x"], (int, float)) and isinstance(a["z"], (int, float)), r["id"]
        meta = json.loads((PACKS / a["pack"] / "atlas" / "meta.json").read_text(encoding="utf-8"))
        sx, sz = meta["size_m"]
        assert 0 <= a["x"] <= sx and 0 <= a["z"] <= sz, f"{r['id']}: answer is off the map grid"


def test_local_images_exist_on_disk():
    local = [r for r in load() if r["image"].startswith("/packs/")]
    assert local, "expected some field photos from the packs"
    for r in local:
        rel = r["image"][len("/packs/"):]
        assert (PACKS / rel).is_file(), f"{r['id']}: missing {rel}"


def test_remote_images_are_https_thumbnails():
    for r in load():
        if not r["image"].startswith("/packs/"):
            assert r["image"].startswith("https://upload.wikimedia.org/") or r["image"].startswith("https://thumb.wikimedia.org/"), r["id"]


def test_utm_conversion_matches_a_known_point():
    # Mahodand Lake sits near 35.71 N, 72.65 E. The pack's own place is at x 51483.7, z 17093.2.
    x, z = play_rounds.to_pack_xz(play_rounds.load_pack("swat"), 35.7103, 72.6537)
    assert abs(x - 51483.7) < 1500 and abs(z - 17093.2) < 1500


def test_builder_output_matches_checked_in_file():
    built = play_rounds.build(write=False)
    assert built == load(), "rounds.json is stale; run python backend/tools/play_rounds.py"
