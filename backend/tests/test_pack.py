import importlib.util
from pathlib import Path

from PIL import Image

spec = importlib.util.spec_from_file_location("pack", Path(__file__).resolve().parents[1] / "tools" / "pack.py")
pack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack)


def test_write_pack_with_views(tmp_path, monkeypatch):
    """A pack with view previews: names become .webp and the manifest still builds. The views loop once shadowed
    the time module and crashed pack.py on the very first real build."""
    views_dir = tmp_path / "views_src" / "hunza"
    views_dir.mkdir(parents=True)
    Image.new("RGB", (40, 30), (10, 120, 200)).save(views_dir / "karimabad_autumn_evening.jpg")
    tex = tmp_path / "tex.jpg"
    Image.new("RGB", (20, 20), (90, 110, 70)).save(tex)
    body = type("Body", (), {"body": b"mesh"})
    monkeypatch.setattr(pack.api, "VIEWS", tmp_path / "views_src")
    monkeypatch.setattr(pack.api, "region_details", lambda s: {"name": "Hunza", "seasons": ["summer"]})
    monkeypatch.setattr(pack.api, "region_landmarks", lambda s: [])
    monkeypatch.setattr(pack.api, "region_itinerary", lambda s: {})
    monkeypatch.setattr(pack.api, "landmark_story", lambda s, l: {})
    monkeypatch.setattr(pack.api, "terrain_mesh", lambda s, size: body)
    monkeypatch.setattr(pack.api, "horizon_grid", lambda s: body)
    monkeypatch.setattr(pack.api, "near_grid", lambda s: body)
    monkeypatch.setattr(pack.api, "region_peaks", lambda s: [])
    monkeypatch.setattr(pack.api, "region_views",
                        lambda s: [{"images": {"autumn": {"evening": "karimabad_autumn_evening.jpg"}}}])
    monkeypatch.setattr(pack.api, "region_facts", lambda s: {})
    monkeypatch.setattr(pack.api, "region_pois", lambda s: {})
    monkeypatch.setattr(pack.api, "region_audio", lambda s: {})
    monkeypatch.setattr(pack.api, "_texture_path", lambda s, season=None: tex)
    monkeypatch.setattr(pack.api, "region_thumb", lambda s, w: type("T", (), {"path": str(tex)})())

    manifest = pack.write_pack("hunza", tmp_path, log=lambda *a: None)

    import json
    d = tmp_path / "packs" / "hunza"
    assert (d / "views" / "karimabad_autumn_evening.webp").is_file()
    assert json.loads((d / "views.json").read_text(encoding="utf-8"))[0]["images"]["autumn"]["evening"] \
        == "karimabad_autumn_evening.webp"
    assert manifest["files"]["views/karimabad_autumn_evening.webp"] > 0


def test_place_page_is_indexable_and_escaped():
    summary = {"name": "Hunza <Valley>", "subtitle": "Gilgit-Baltistan", "center": [36.3, 74.7],
               "cover": {"image": "karimabad_autumn_evening.webp", "view": "Karimabad", "labels": []}}
    views = [{"name": "Karimabad", "elev": 2439, "labels": [{"name": "Rakaposhi"}],
              "images": {"autumn": {"evening": "karimabad_autumn_evening.webp"}}}]
    facts = {"checked": "2026-09-30", "facts": [{"topic": "when_to_go", "text": "Best in spring.", "url": "https://v/H", "source": "Hunza"}]}
    html = pack.place_page("hunza", summary, {"intro": "A valley."}, views, facts,
                           {"name": "Up the KKH", "stops": [{"name": "Baltit Fort"}]}, "https://tinyatlas.example")
    assert "Hunza &lt;Valley&gt;" in html and "<Valley>" not in html
    assert "<link rel='canonical' href='https://tinyatlas.example/place/hunza/'>" in html
    assert "Rakaposhi" in html and "Baltit Fort" in html and "When to go" in html and "TouristDestination" in html


def test_static_index_tells_the_app_to_read_packs():
    html = '<head></head><body><script type="module" src="/js/main.js"></script></body>'
    out = pack.static_index(html, "https://api.example.org")
    assert out.index("window.TINYATLAS") < out.index('type="module"')
    assert '"static": true' in out and '"api": "https://api.example.org"' in out
    assert '"api": ""' in pack.static_index(html, None)
