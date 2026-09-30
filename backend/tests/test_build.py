import time

import pytest
from fastapi.testclient import TestClient
from tinyatlas import api, builder, jobs, regions


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(regions, "DATA", tmp_path / "regions")
    monkeypatch.setattr(api.tiles, "OUT", tmp_path / "tiles")
    monkeypatch.setattr(api, "THUMBS", tmp_path / "thumbs")
    jobs.JOBS.clear()
    api._landmarks.cache_clear(); api._chunks.cache_clear()
    return tmp_path


def wait(job_id, client, timeout=5):
    t = time.time()
    while time.time() - t < timeout:
        j = client.get(f"/api/jobs/{job_id}").json()
        if j["status"] in ("done", "error"):
            return j
        time.sleep(0.02)
    raise AssertionError("job did not finish")


def fake_pipeline(monkeypatch, tmp_path, fail_at=None):
    calls = []
    place = {"name": "Zermatt", "subtitle": "Valais, Schweiz", "lat": 46.02, "lon": 7.75}
    monkeypatch.setattr(builder.geocode, "search", lambda q, **kw: [place] if q.lower().startswith("zer") else [])
    monkeypatch.setattr(api.geocode, "search", builder.geocode.search)
    monkeypatch.setattr(builder.discover, "discover", lambda bbox, **kw: calls.append("landmarks") or [{"title": "Matterhorn", "kind": "peak"}])
    monkeypatch.setattr(builder.discover, "guide_pages", lambda name, **kw: [("en.wikivoyage.org", "Zermatt")])
    monkeypatch.setattr(builder.terrain, "heightmap", lambda *a, **k: calls.append("terrain"))
    monkeypatch.setattr(builder.osm, "features", lambda *a, **k: calls.append("map") or {"road": []})

    def paint(slug, bbox):
        if fail_at == "paint":
            raise RuntimeError("disk full")
        calls.append("paint")
        d = tmp_path / "tiles" / slug
        d.mkdir(parents=True, exist_ok=True)
        from PIL import Image
        Image.new("RGB", (40, 30), (120, 160, 90)).save(d / "texture.png")
    monkeypatch.setattr(builder.paint, "paint_region", paint)
    monkeypatch.setattr(builder.sources, "chunks", lambda cfg, client=None: calls.append("guide") or [])
    return calls


def test_build_runs_all_steps_saves_region_and_serves_it(isolated, monkeypatch):
    calls = fake_pipeline(monkeypatch, isolated)
    c = TestClient(api.app)
    job = c.post("/api/build", json={"query": "Zermatt"}).json()
    done = wait(job["id"], c)
    assert done["status"] == "done" and done["result"] == "zermatt"
    assert calls == ["landmarks", "terrain", "map", "paint", "guide"]
    assert all(s["state"] == "done" for s in done["steps"])
    z = c.get("/api/regions").json()["zermatt"]
    assert z["ready"] is True and z["builtin"] is False and z["landmarks"] == 1 and z["subtitle"] == "Valais, Schweiz"
    assert c.get("/api/thumb/zermatt?w=200").headers["content-type"] == "image/jpeg"
    # building the same place again reuses it: no new job
    again = c.post("/api/build", json={"query": "Zermatt"}).json()
    assert again == {"status": "done", "result": "zermatt"}


def test_failed_build_reports_the_error_and_saves_nothing(isolated, monkeypatch):
    fake_pipeline(monkeypatch, isolated, fail_at="paint")
    c = TestClient(api.app)
    done = wait(c.post("/api/build", json={"query": "Zermatt"}).json()["id"], c)
    assert done["status"] == "error" and "disk full" in done["error"]
    assert [s["state"] for s in done["steps"]].count("error") == 1
    assert "zermatt" not in c.get("/api/regions").json()


def test_build_validates_input(isolated, monkeypatch):
    fake_pipeline(monkeypatch, isolated)
    c = TestClient(api.app)
    assert c.post("/api/build", json={"query": "   "}).status_code == 400
    assert c.post("/api/build", json={"query": "Nowhere-land"}).status_code == 404
    assert c.post("/api/build", json={"query": "x", "lat": 95, "lon": 0}).status_code == 400


def test_build_queue_is_capped(isolated, monkeypatch):
    fake_pipeline(monkeypatch, isolated)
    for i in range(api.MAX_QUEUED_BUILDS):
        j = jobs.Job(builder.STEPS)
        j.status = "running"
        jobs.JOBS[j.id] = j
    r = TestClient(api.app).post("/api/build", json={"query": "Zermatt"})
    assert r.status_code == 429


def test_delete_only_removes_user_regions(isolated):
    regions.save("zermatt", {"name": "Zermatt", "bbox": [7.5, 45.9, 8.0, 46.1]})
    c = TestClient(api.app)
    assert c.delete("/api/regions/hunza").status_code == 403
    assert c.delete("/api/regions/zermatt").json() == {"removed": "zermatt"}
    assert c.delete("/api/regions/zermatt").status_code == 404


def test_unknown_job_and_unbuilt_thumb(isolated):
    c = TestClient(api.app)
    assert c.get("/api/jobs/nope").status_code == 404
    assert c.get("/api/thumb/hunza").status_code == 404          # texture not present in the isolated dir
