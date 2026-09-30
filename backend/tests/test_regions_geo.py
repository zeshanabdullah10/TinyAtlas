import json

import pytest
from tinyatlas import discover, geocode, regions


# ---------- region registry ----------
@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(regions, "DATA", tmp_path / "regions")
    return tmp_path / "regions"


def test_registry_merges_builtin_and_saved_regions(store):
    assert "hunza" in regions.REGIONS and "zermatt" not in regions.REGIONS
    cfg = {"name": "Zermatt", "subtitle": "Valais, Schweiz", "bbox": [7.5, 45.9, 8.0, 46.1], "center": [46.0, 7.75],
           "landmarks": [{"title": "Matterhorn", "kind": "peak"}], "guide_pages": [["en.wikivoyage.org", "Zermatt"]]}
    regions.save("zermatt", cfg)
    z = regions.REGIONS["zermatt"]
    assert z["bbox"] == (7.5, 45.9, 8.0, 46.1) and z["guide_pages"] == [("en.wikivoyage.org", "Zermatt")]
    assert z["builtin"] is False and regions.REGIONS["hunza"]["builtin"] is True
    assert set(regions.REGIONS) == {"hunza", "zermatt"}


def test_corrupt_region_file_is_skipped_not_fatal(store):
    store.mkdir(parents=True)
    (store / "broken.json").write_text("{not json", encoding="utf-8")
    (store / "partial.json").write_text(json.dumps({"name": "No bbox"}), encoding="utf-8")
    assert list(regions.REGIONS) == ["hunza"]


def test_remove_only_touches_saved_regions(store):
    regions.save("zermatt", {"name": "Z", "bbox": [0, 0, 1, 1]})
    assert regions.remove("zermatt") is True and regions.remove("zermatt") is False
    assert regions.remove("hunza") is False and "hunza" in regions.REGIONS


def test_slugify_handles_accents_and_symbols():
    assert regions.slugify("Zermatt") == "zermatt"
    assert regions.slugify("Machu Picchu, Peru!") == "machu-picchu-peru"
    assert regions.slugify("Café del Mar") == "caf-del-mar"
    assert regions.slugify("東京") == "place"          # nothing ASCII left: still a valid slug


# ---------- geocoding ----------
def test_make_bbox_is_centred_and_km_sized():
    w, s, e, n = geocode.make_bbox(46.0, 7.75, width_km=36, height_km=28)
    assert abs((w + e) / 2 - 7.75) < 1e-4 and abs((s + n) / 2 - 46.0) < 1e-4
    assert abs((n - s) * 110.54 - 28) < 0.1
    assert abs((e - w) * 111.32 * 0.6947 - 36) < 0.5                       # cos(46 deg) ~ 0.6947


def test_subtitle_keeps_last_two_meaningful_parts():
    d = "Zermatt, Visp, Oberwallis, Valais/Wallis, 3920, Schweiz/Suisse/Svizzera/Svizra"
    assert geocode._subtitle(d, "Zermatt") == "Valais, Schweiz"
    assert geocode._subtitle("Fuji, Japan", "Fuji") == "Japan"


def test_search_parses_coordinates_without_network():
    r = geocode.search("46.02, 7.75")
    assert r[0]["lat"] == 46.02 and r[0]["lon"] == 7.75 and r[0]["kind"] == "coordinates"
    assert geocode.search("-13.16 -72.55")[0]["lon"] == -72.55


def test_search_caches_results(tmp_path, monkeypatch):
    monkeypatch.setattr(geocode, "CACHE", tmp_path)
    calls = []

    class C:
        def get(self, url, **kw):
            calls.append(kw["params"]["q"])

            class R:
                def raise_for_status(self): pass
                def json(self_): return [{"display_name": "Zermatt, Visp, Schweiz", "name": "Zermatt", "lat": "46.02",
                                          "lon": "7.75", "type": "administrative", "importance": 0.54}]
            return R()

    assert geocode.search("Zermatt", client=C())[0]["name"] == "Zermatt"
    assert geocode.search("zermatt", client=C())[0]["lat"] == 46.02          # same key, served from cache
    assert calls == ["Zermatt"]


# ---------- landmark discovery ----------
def test_classify_kinds_and_noise():
    assert discover.classify("Mountain in the Alps") == "peak"
    assert discover.classify("Museum in Zermatt") == "museum"
    assert discover.classify("Fort in Gilgit-Baltistan", "Baltit Fort is a fort in the Hunza district of Pakistan.") == "fort"
    assert discover.classify("Railway station in Zermatt, Switzerland") is None
    assert discover.classify("Hotel, located in Zermatt") is None
    assert discover.classify("Place in Valais, Switzerland", "Zermatt is a municipality in the district of Visp.") == "town"
    # an unrecognisable page becomes a generic pin rather than being dropped
    assert discover.classify("Cultural item", "The Thing is an object.") == "pin"
    assert discover.classify("Lake in Valais") == "lake" and discover.classify("Waterfall in Iceland") == "waterfall"
    assert discover.classify("Mountain rack railway in Valais") == "rail"


def test_classify_regressions_from_real_pages():
    assert discover.classify("Formula One motor race") is None                       # 2008 Japanese Grand Prix
    assert discover.classify("1966 aviation accident") is None                       # BOAC Flight 911
    assert discover.classify("Census-designated place in California") is None        # Yosemite West
    # What the page IS decides the kind, not every word of the sentence: this one mentions "Falls".
    s = "Lost Arrow Spire is a granite pinnacle in Yosemite Valley near Yosemite Falls."
    assert discover.classify("", s) == "peak"
    assert discover.classify("", "El Capitan is a vertical rock formation in Yosemite National Park.") == "peak"
    assert discover.classify("Amusement park in Japan") is None and discover.classify("Diocese of Avezzano") is None
    assert discover.classify("Steamship") is None and discover.classify("Glacier in the Alps") == "glacier"
    assert discover.classify("Place of worship in Kyoto") is not None            # "worship" must not look like "ship"
    assert discover.classify("Place in Valais, Switzerland") == "town"


def test_classify_drops_events_by_title():
    assert discover.classify("", "The event is held yearly.", title="Men's Olympic Downhill (East Summit)") is None
    assert discover.classify("Mountain in Alberta", title="Mount Temple (Alberta)") == "peak"


def _cand(title, lat, lon):
    return {"title": title, "lat": lat, "lon": lon}


def test_pick_ranks_filters_and_spaces_out():
    bbox = (7.5, 45.9, 8.0, 46.1)
    cands = [_cand("Matterhorn", 45.976, 7.658), _cand("Matterhorn Museum", 46.02, 7.75),
             _cand("Zermatt station", 46.021, 7.741), _cand("Riffelsee", 45.95, 7.85),
             _cand("Tiny hamlet", 46.05, 7.6), _cand("Next to Matterhorn", 45.977, 7.659)]
    info = {
        "Matterhorn": {"length": 60000, "description": "Mountain in the Alps", "extract": "", "thumb": "x"},
        "Matterhorn Museum": {"length": 3000, "description": "Museum in Zermatt", "extract": "", "thumb": "x"},
        "Zermatt station": {"length": 6000, "description": "Railway station in Zermatt", "extract": "", "thumb": "x"},
        "Riffelsee": {"length": 900, "description": "Lake in Valais", "extract": "", "thumb": None},
        "Tiny hamlet": {"length": 200, "description": "Hamlet in Valais", "extract": "", "thumb": None},
        "Next to Matterhorn": {"length": 40000, "description": "Mountain in the Alps", "extract": "", "thumb": "x"},
    }
    got = discover.pick(cands, info, bbox, n=8)
    titles = [g["title"] for g in got]
    assert titles[0] == "Matterhorn"                                          # biggest, iconic and pictured
    assert "Zermatt station" not in titles and "Tiny hamlet" not in titles    # noise and too-short pages dropped
    assert "Next to Matterhorn" not in titles                                 # closer than the minimum spacing
    assert {"Matterhorn Museum", "Riffelsee"} <= set(titles)
    assert dict((g["title"], g["kind"]) for g in got)["Riffelsee"] == "lake"


def test_pick_caps_kinds_and_count():
    bbox = (0.0, 0.0, 1.0, 1.0)
    cands = [_cand(f"Town {i}", 0.1 * i + 0.05, 0.1 * i + 0.05) for i in range(9)]
    info = {c["title"]: {"length": 5000, "description": "Village in X", "extract": "", "thumb": "x"} for c in cands}
    assert len(discover.pick(cands, info, bbox, n=8, min_sep_km=1)) == 1      # MAX_PER_KIND["town"] == 1
    cands = [_cand(f"Peak {i}", 0.1 * i + 0.05, 0.1 * i + 0.05) for i in range(9)]
    info = {c["title"]: {"length": 5000, "description": "Mountain in X", "extract": "", "thumb": "x"} for c in cands}
    assert len(discover.pick(cands, info, bbox, n=5, min_sep_km=1)) == 5


def test_search_dedupes_repeated_records_for_one_place(tmp_path, monkeypatch):
    monkeypatch.setattr(geocode, "CACHE", tmp_path)
    rec = lambda lat, sub: {"display_name": f"Cappadocia, {sub}", "name": "Cappadocia", "lat": str(lat), "lon": "13.3", "type": "village", "importance": 0.3}

    class C:
        def get(self, url, **kw):
            class R:
                def raise_for_status(self): pass
                def json(self_): return [rec(42.0, "Abruzzo, Italy"), rec(42.001, "Abruzzo, Italy"), rec(38.6, "Central Anatolia Region, Turkey")]
            return R()

    got = geocode.search("Cappadocia", client=C())
    assert [g["subtitle"] for g in got] == ["Abruzzo, Italy", "Central Anatolia Region, Turkey"]
