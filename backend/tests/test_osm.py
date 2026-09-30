from tinyatlas import osm

BBOX = (10.0, 20.0, 12.0, 22.0)


def test_classify():
    assert osm.classify({"building": "yes"}) == "building"
    assert osm.classify({"waterway": "river"}) == "river"
    assert osm.classify({"natural": "water"}) == "lake"
    assert osm.classify({"highway": "residential"}) == "road"
    assert osm.classify({"highway": "footway"}) is None


def test_normalise_maps_corners():
    raw = {"elements": [
        {"type": "way", "tags": {"highway": "track"},
         "geometry": [{"lon": 10.0, "lat": 22.0}, {"lon": 12.0, "lat": 20.0}]},
        {"type": "way", "tags": {"shop": "x"}, "geometry": [{"lon": 10, "lat": 20}, {"lon": 11, "lat": 21}]},
    ]}
    out = osm.normalise(raw, BBOX)
    assert out["road"] == [[(0.0, 0.0), (1.0, 1.0)]]
    assert out["building"] == [] and out["river"] == []
