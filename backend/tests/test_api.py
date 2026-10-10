import warnings

import pytest

# starlette's TestClient module touches an anyio alias that anyio 4.15 deprecates; ignore just that warning here so
# `pytest -W error::DeprecationWarning` can still collect the suite. Remove once starlette stops using the alias.
warnings.filterwarnings("ignore", message="The anyio.abc.BlockingPortal alias", category=DeprecationWarning)
from fastapi.testclient import TestClient  # noqa: E402
from tinyatlas import api, llm  # noqa: E402


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(llm, "ROOT", tmp_path); monkeypatch.setattr(llm, "CACHE", tmp_path / "llm")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.setattr(api, "AUDIO", tmp_path / "audio")
    return TestClient(api.app)


def test_only_the_two_swat_regions_exist(client):
    r = client.get("/api/regions").json()
    assert set(r) == {"swat", "swat-lower"} and r["swat"]["atlas"] == "swat"
    assert client.get("/api/region/hunza").status_code == 404
    assert client.get("/api/region/swat").json()["name"] == "Swat Valley"


def test_removed_endpoints_are_gone(client):
    for path in ("/api/geocode?q=x", "/api/views/swat", "/api/terrain/swat", "/api/guide/swat", "/api/story/swat/kalam"):
        assert client.get(path).status_code in (404, 405)
    assert client.post("/api/build", json={"query": "x"}).status_code in (404, 405)


def test_planner_needs_a_model(client):
    assert client.post("/api/plan/swat", json={"request": "2 days"}).status_code == 503
    assert client.post("/api/plan/atlantis", json={"request": "2 days"}).status_code == 404


def test_planner_is_rate_limited_per_visitor(client, monkeypatch):
    monkeypatch.setattr(api, "LIMITS", {"plan": (2, 3600)})
    monkeypatch.setattr(api, "_calls", {})
    monkeypatch.setattr(llm, "available", lambda: True)
    monkeypatch.setattr(api.planner, "plan", lambda *a, **k: {"days": []})
    monkeypatch.setattr(api, "region_landmarks", lambda r: [])
    monkeypatch.setattr(api, "region_facts", lambda r: {"facts": []})
    codes = [client.post("/api/plan/swat", json={"request": "a day"}).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


def test_audio_is_empty_until_clips_exist_and_filenames_are_checked(client, tmp_path):
    assert client.get("/api/audio/swat").json() == {}
    assert client.get("/api/audio-file/swat/../../x.en.m4a").status_code in (400, 404)
    assert client.get("/api/audio-file/swat/kalam.en.m4a").status_code == 404
    (tmp_path / "audio" / "swat").mkdir(parents=True)
    (tmp_path / "audio" / "swat" / "kalam.en.m4a").write_bytes(b"x")
    assert client.get("/api/audio-file/swat/kalam.en.m4a").status_code == 200


def test_status_reports_no_model(client):
    assert client.get("/api/status").json()["llm"] is False
