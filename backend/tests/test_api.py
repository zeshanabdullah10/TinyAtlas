import pytest
from fastapi.testclient import TestClient
from tinyatlas import api, llm

LMS = [
    {"slug": "baltit-fort", "name": "Baltit Fort", "kind": "fort", "u": 0.34, "v": 0.64,
     "summary": "Baltit Fort is a palatial fort in the Hunza Valley.", "url": "https://w/Baltit"},
    {"slug": "attabad-lake", "name": "Attabad Lake", "kind": "lake", "u": 0.73, "v": 0.6,
     "summary": "Attabad Lake formed after a 2010 landslide.", "url": "https://w/Attabad"},
]
CHUNKS = [{"source": "Attabad Lake", "url": "https://w/Attabad", "text": "Attabad Lake formed after a landslide in 2010."}]


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(api.sources, "landmarks", lambda region: LMS)
    monkeypatch.setattr(api.sources, "chunks", lambda region: CHUNKS)
    api._landmarks.cache_clear(); api._chunks.cache_clear()
    monkeypatch.setattr(llm, "ROOT", tmp_path); monkeypatch.setattr(llm, "CACHE", tmp_path / "llm")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    return TestClient(api.app)


def test_landmarks_and_unknown_region(client):
    assert [l["slug"] for l in client.get("/api/landmarks/hunza").json()] == ["baltit-fort", "attabad-lake"]
    assert client.get("/api/landmarks/atlantis").status_code == 404


def test_story_extractive_and_404(client):
    r = client.get("/api/story/hunza/baltit-fort").json()
    assert r["name"] == "Baltit Fort" and "palatial fort" in r["story"] and r["mode"] == "extractive"
    assert client.get("/api/story/hunza/nope").status_code == 404


def test_guide_grounded_and_refuses_unsupported(client):
    ok = client.post("/api/guide/hunza", json={"question": "how did Attabad Lake form?"}).json()
    assert ok["sources"][0]["url"] == "https://w/Attabad" and "landslide" in ok["answer"]
    no = client.post("/api/guide/hunza", json={"question": "best pizza restaurant?"}).json()
    assert no["answer"] == "That isn't in my sources for this region." and no["sources"] == []
    assert client.post("/api/guide/hunza", json={"question": "  "}).status_code == 400


def test_itinerary_and_status(client):
    it = client.get("/api/itinerary/hunza").json()
    assert [s["slug"] for s in it["stops"]] == ["baltit-fort", "attabad-lake"]
    assert client.get("/api/status").json()["llm"] is False
