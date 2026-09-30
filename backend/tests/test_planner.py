from tinyatlas import planner

STOPS = {
    "town": {"slug": "town", "name": "Town", "kind": "town", "u": 0.1, "v": 0.5, "elev": 2400},
    "lake": {"slug": "lake", "name": "Lake", "kind": "lake", "u": 0.5, "v": 0.5, "elev": 2600},
    "camp": {"slug": "camp", "name": "High camp", "kind": "town", "u": 0.9, "v": 0.5, "elev": 4100},
    "island": {"slug": "island", "name": "Island", "kind": "pin", "u": 0.5, "v": 0.9, "elev": 2500},
}
LEGS = {
    ("town", "lake"): {"km": 30.0, "min": 60, "mode": "road", "path": [[0.1, 0.5], [0.5, 0.5]]},
    ("lake", "camp"): {"km": 12.0, "min": 400, "mode": "foot", "path": [[0.5, 0.5], [0.9, 0.5]]},
}


def test_invented_stops_are_dropped_and_numbers_come_from_the_map():
    raw = {"title": "T", "days": [{"title": "D1", "stops": ["town", "atlantis", "lake"], "sleep": "town", "notes": "n",
                                   "km": 999}]}
    p = planner.validate(raw, STOPS, LEGS, (10000, 10000))
    d = p["days"][0]
    assert [s["slug"] for s in d["stops"]] == ["town", "lake"]
    assert d["km"] == 30.0 and d["travel_min"] == 60 and d["warnings"] == []
    assert p["choices"]["days"][0]["stops"] == ["town", "lake"]


def test_unconnected_stops_and_fast_ascent_are_flagged():
    raw = {"days": [{"stops": ["town"], "sleep": "town"},
                    {"stops": ["lake", "camp"], "sleep": "camp"},
                    {"stops": ["camp", "island"]}]}
    days = planner.validate(raw, STOPS, LEGS, (10000, 10000))["days"]
    assert any("1700 m higher" in w for w in days[1]["warnings"])          # 2400 -> 4100 in one night
    assert any("long day" in w for w in days[1]["warnings"])
    assert any("no road or path" in w for w in days[2]["warnings"])


def test_steep_roads_are_slow():
    assert planner.road_kmh(0.01) > planner.road_kmh(0.06) > planner.road_kmh(0.12)


def test_travel_time_adds_climbing_on_foot():
    assert planner._travel_min(7.0, "foot", 800) == round(7 / 3.5 * 60 + 800 / 400 * 60)
    assert planner._travel_min(30.0, "road", 800) == 60
