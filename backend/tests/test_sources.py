from tinyatlas import sources

REGION = {
    "bbox": (74.5, 36.2, 75.0, 36.55),
    "landmarks": [{"title": "Baltit Fort", "kind": "fort"}, {"title": "Hopper Glacier", "kind": "peak"},
                  {"title": "Nowhere", "kind": "peak"}],
    "guide_pages": [("en.wikivoyage.org", "Hunza")],
}


class FakeClient:
    """Returns canned MediaWiki responses so tests never touch the network."""
    PAGES = {
        "Baltit Fort": {"title": "Baltit Fort", "fullurl": "https://x/Baltit", "extract": "Intro para.\n\nSecond para.",
                        "coordinates": [{"lat": 36.3255, "lon": 74.6697}]},
        "Hopper Glacier": {"title": "Hopper Glacier", "fullurl": "https://x/Hopper", "extract": "Montana.",
                           "coordinates": [{"lat": 45.08, "lon": -109.6}]},
        "Nowhere": {"title": "Nowhere", "missing": True},
        "Hunza": {"title": "Hunza Valley", "fullurl": "https://v/Hunza", "extract": ("A" * 500 + "\n\n") * 5},
    }

    def get(self, url, headers=None, timeout=None, params=None):
        page = self.PAGES[params["titles"]]

        class R:
            def raise_for_status(self): pass
            def json(self_): return {"query": {"pages": [page]}}
        return R()


def test_to_uv_inside_and_outside():
    assert sources.to_uv(36.375, 74.75, REGION["bbox"]) == (0.5, 0.5)
    assert sources.to_uv(45.0, -109.0, REGION["bbox"]) is None


def test_landmarks_filters_out_of_bbox_and_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(sources, "CACHE", tmp_path)
    lms = sources.landmarks(REGION, FakeClient())
    assert [l["slug"] for l in lms] == ["baltit-fort"]
    assert lms[0]["summary"] == "Intro para." and 0 < lms[0]["u"] < 0.5 and 0 < lms[0]["v"] < 1


def test_chunks_strip_headings_and_skip_non_content_sections(tmp_path, monkeypatch):
    monkeypatch.setattr(sources, "CACHE", tmp_path)
    fake = FakeClient()
    fake.PAGES = {**FakeClient.PAGES, "Baltit Fort": {
        "title": "Baltit Fort", "fullurl": "https://x/Baltit", "coordinates": [{"lat": 36.3255, "lon": 74.6697}],
        "extract": "Baltit is a fort.\n\n== History ==\nBuilt long ago.\n\n== See also ==\nSome other lake\n\n== Awards ==\nA prize"}}
    cs = [c for c in sources.chunks({**REGION, "guide_pages": []}, fake) if c["source"] == "Baltit Fort"]
    assert all("==" not in c["text"] for c in cs)
    assert [c["section"] for c in cs] == ["", "History"]
    assert not any("other lake" in c["text"] or "prize" in c["text"] for c in cs)


def test_chunks_keep_source_and_respect_size(tmp_path, monkeypatch):
    monkeypatch.setattr(sources, "CACHE", tmp_path)
    cs = sources.chunks(REGION, FakeClient(), size=900)
    assert {c["source"] for c in cs} == {"Baltit Fort", "Hunza Valley"}
    assert all(c["url"].startswith("https://") for c in cs)
    assert max(len(c["text"]) for c in cs if c["source"] == "Hunza Valley") <= 1010
