import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("road_classes", Path(__file__).resolve().parents[1] / "tools" / "road_classes.py")
rc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rc)
C = lambda *a, **k: rc.classify(*a, **k)[0]


def test_sealed_surface_on_main_roads_is_paved_on_local_roads_minor():
    for s in ("asphalt", "paved", "concrete", "concrete:plates", "paving_stones", "sett", "chipseal"):
        assert C("tertiary", s) == "paved"
        assert C("residential", s) == "minor" and C("service", s) == "minor"
    assert C("tertiary", "asphalt", smoothness="bad") == "minor"


def test_unsealed_surface():
    for s in ("unpaved", "ground", "dirt", "gravel", "sand"):
        assert C("tertiary", s) == "jeep" and C("unclassified", s) == "jeep"
        assert C("residential", s) == "minor"
    assert C("track", "ground") == "track"


def test_track_and_paths():
    assert C("track", tracktype="grade1") == "minor" and C("track", tracktype="grade3") == "track"
    assert C("footway", "asphalt") == "path" and C("steps") == "path"


def test_smoothness_alone():
    assert C("tertiary", smoothness="good") == "paved"
    assert C("unclassified", smoothness="good") == "minor"
    assert C("residential", smoothness="very_bad") == "jeep" and C("track", smoothness="horrible") == "track"


def test_no_evidence_falls_back_to_highway_tag():
    assert rc.classify("tertiary") == ("jeep", "highway tag only")
    assert C("secondary") == "paved" and C("unclassified") == "minor" and C("tertiary_link") == "jeep"
