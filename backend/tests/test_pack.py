import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("pack", Path(__file__).resolve().parents[1] / "tools" / "pack.py")
pack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack)


def test_static_index_tells_the_app_to_read_packs():
    html = '<head></head><body><script type="module" src="/js/main.js"></script></body>'
    out = pack.static_index(html, "https://api.example.org")
    assert out.index("window.TINYATLAS") < out.index('type="module"')
    assert '"static": true' in out and '"api": "https://api.example.org"' in out
    assert '"api": ""' in pack.static_index(html, None)


def test_static_index_respects_a_subpath_and_makes_social_links_absolute():
    html = '<head><meta property="og:image" content="img/og.jpg"></head><body><link href="/css/a.css"><script type="module" src="/js/main.js"></script></body>'
    out = pack.static_index(html, None, "/tinyatlas/", "https://u.github.io/tinyatlas")
    assert 'href="/tinyatlas/css/a.css"' in out and '"base": "/tinyatlas/"' in out
    assert 'content="https://u.github.io/tinyatlas/img/og.jpg"' in out
    assert '<link rel="canonical" href="https://u.github.io/tinyatlas/">' in out
    assert pack._base_path("https://u.github.io/tinyatlas") == "/tinyatlas/" and pack._base_path("https://x.org") == ""


def test_build_site_lists_only_the_two_swat_maps(tmp_path, monkeypatch):
    monkeypatch.setattr(pack, "write_atlas_pack", lambda slug, out, log: (out / "packs" / slug / "atlas").mkdir(parents=True) or 0)
    pack.build_site(["swat", "swat-lower"], tmp_path, base_url="https://x.org/tinyatlas")
    sitemap = (tmp_path / "sitemap.xml").read_text(encoding="utf-8")
    assert sitemap.count("<loc>") == 3 and "atlas.html?pack=swat-lower" in sitemap
    assert (tmp_path / "index.html").exists() and (tmp_path / "data" / "home.json").exists() and (tmp_path / "img" / "hero-1600.webp").exists()
    assert "tinyatlas/sitemap.xml" in (tmp_path / "robots.txt").read_text()
    assert not (tmp_path / "place").exists()


def test_home_data_is_complete_and_sourced():
    d = json.loads((Path(__file__).resolve().parents[2] / "web" / "data" / "home.json").read_text(encoding="utf-8"))
    assert [r["slug"] for r in d["regions"]] == ["swat", "swat-lower"]
    assert all(r["places"] and r["peak"]["m"] > 0 and r["peak"]["source"] for r in d["regions"])
    assert len(d["timeline"]) == 6
    for era in d["timeline"]:
        assert 1 <= len(era["events"]) <= 2 and all(e["source"].startswith("https://") for e in era["events"])
