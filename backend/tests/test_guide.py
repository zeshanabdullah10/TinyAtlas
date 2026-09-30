import json

import pytest
from tinyatlas import guide, llm

CHUNKS = [
    {"source": "Baltit Fort", "url": "https://w/Baltit", "text": "Baltit Fort is a palatial fort in Karimabad. It was restored in the 1990s."},
    {"source": "Attabad Lake", "url": "https://w/Attabad", "text": "Attabad Lake formed after a landslide in 2010 and blocked the Hunza River."},
    {"source": "Hunza Valley", "url": "https://w/Hunza", "text": "Apricots and cherries grow in the valley; the Karakoram Highway runs through it."},
]


@pytest.fixture(autouse=True)
def no_key(monkeypatch, tmp_path):
    monkeypatch.setattr(llm, "ROOT", tmp_path)      # no .env
    monkeypatch.setattr(llm, "CACHE", tmp_path / "llm")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)


def test_retrieve_ranks_relevant_chunk_first():
    hits = guide.retrieve("how did Attabad Lake form?", CHUNKS)
    assert hits[0]["source"] == "Attabad Lake"


def test_retrieve_returns_nothing_for_unsupported_question():
    assert guide.retrieve("best pizza restaurant with wifi", CHUNKS) == []


def test_answer_says_not_in_sources_when_nothing_retrieved():
    a = guide.answer("best pizza restaurant with wifi", CHUNKS)
    assert a["answer"] == guide.NOT_FOUND and a["sources"] == []


def test_extractive_fallback_cites_source():
    a = guide.answer("when was Baltit Fort restored?", CHUNKS)
    assert a["mode"] == "extractive" and "Baltit Fort is a palatial fort" in a["answer"]
    assert a["sources"][0]["url"] == "https://w/Baltit" and a["answer"].endswith("[1]")


def test_llm_path_uses_excerpts_and_caches(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    calls = []

    class R:
        def raise_for_status(self): pass
        def json(self): return {"choices": [{"message": {"content": "It formed in 2010 [1]."}}],
                                "usage": {"prompt_tokens": 100, "completion_tokens": 10}}

    class C:
        def post(self, url, **kw): calls.append(kw["json"]); return R()

    msgs = [{"role": "user", "content": "hi"}]
    assert llm.complete(msgs, client=C()) == "It formed in 2010 [1]."
    assert llm.complete(msgs, client=C()) == "It formed in 2010 [1]."   # second call served from cache
    assert len(calls) == 1
    assert llm.usage_totals() == {"calls": 1, "prompt_tokens": 100, "completion_tokens": 10}


def test_llm_failure_falls_back_to_extractive(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    class C:
        def post(self, *a, **k): raise RuntimeError("boom")

    monkeypatch.setattr(llm.httpx, "post", C().post)
    a = guide.answer("how did Attabad Lake form?", CHUNKS)
    assert a["mode"] == "extractive"


def test_itinerary_visits_all_and_starts_west():
    lms = [{"slug": "b", "name": "B", "u": 0.8, "v": 0.5}, {"slug": "a", "name": "A", "u": 0.1, "v": 0.5},
           {"slug": "c", "name": "C", "u": 0.4, "v": 0.5}]
    it = guide.itinerary(lms)
    assert [s["slug"] for s in it["stops"]] == ["a", "c", "b"] and len(it["route"]) == 3


def test_itinerary_skips_sights_far_from_any_road():
    road = [[(0.0, 0.0), (0.5, 0.0), (1.0, 0.0)]]
    lms = [{"slug": "a", "name": "A", "u": 0.0, "v": 0.001}, {"slug": "peak", "name": "Peak", "u": 0.5, "v": 0.9},
           {"slug": "b", "name": "B", "u": 1.0, "v": 0.001}]
    it = guide.itinerary(lms, road, (10000.0, 10000.0))
    assert [s["slug"] for s in it["stops"]] == ["a", "b"]      # the peak is 9 km from the road
    assert all(p[1] < 0.01 for p in it["route"])


def test_itinerary_uses_trails_only_when_roads_cannot_connect_two_stops():
    size = (10000.0, 10000.0)
    road = [[(0.0, 0.0), (0.05, 0.0)]]                         # a short road near neither hiking sight
    trail = [[(0.5, 0.5), (0.9, 0.5)], [(0.1, 0.5), (0.5, 0.5)]]
    hikes = [{"slug": "a", "name": "A", "u": 0.12, "v": 0.5}, {"slug": "b", "name": "B", "u": 0.88, "v": 0.5}]
    assert guide.itinerary(hikes, road, size)["stops"] == []                       # roads alone: nothing reachable
    it = guide.itinerary(hikes, road, size, trails=trail)
    assert [s["slug"] for s in it["stops"]] == ["a", "b"] and len(it["route"]) >= 3
    # with a real road connecting the sights, trails are ignored
    big_road = [[(0.1, 0.5), (0.9, 0.5)]]
    again = guide.itinerary(hikes, big_road, size, trails=trail)
    assert [s["slug"] for s in again["stops"]] == ["a", "b"]


def test_summits_are_only_route_stops_when_the_road_passes_right_by():
    road = [[(i / 20, 0.5) for i in range(21)]]                  # vertices every 500 m, like real OSM ways
    size = (10000.0, 10000.0)                                    # 1 unit = 10 km
    lms = [{"slug": "a", "name": "A", "kind": "fort", "u": 0.0, "v": 0.5},
           {"slug": "near", "name": "Near peak", "kind": "peak", "u": 0.5, "v": 0.505},        # 50 m from the road
           {"slug": "far", "name": "Far peak", "kind": "peak", "u": 0.6, "v": 0.6},            # 1 km away
           {"slug": "town", "name": "Town", "kind": "town", "u": 0.9, "v": 0.6}]               # 1 km away, but a town
    it = guide.itinerary(lms, road, size)
    assert {s["slug"] for s in it["stops"]} == {"a", "near", "town"}


def test_empty_model_answer_is_not_cached_or_served(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    replies = iter(["", "A real answer."])

    class R:
        def __init__(self, text): self.text = text
        def raise_for_status(self): pass
        def json(self): return {"choices": [{"message": {"content": self.text}}], "usage": {}}

    class C:
        def post(self, url, **kw): return R(next(replies))

    msgs = [{"role": "user", "content": "hi"}]
    with pytest.raises(llm.LLMUnavailable):
        llm.complete(msgs, client=C())                     # empty -> failure, nothing cached
    assert llm.complete(msgs, client=C()) == "A real answer."


def test_story_falls_back_when_the_model_is_empty(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(llm, "complete", lambda *a, **k: (_ for _ in ()).throw(llm.LLMUnavailable("empty")))
    s = guide.story({"name": "X", "summary": "X is a place. It is nice. Really.", "url": "u"}, [])
    assert s["mode"] == "extractive" and s["story"].startswith("X is a place.")


def test_itinerary_is_empty_when_the_only_leg_is_a_nonsense_detour():
    # a U-shaped road: two stops 2 km apart as the crow flies, about 100 km apart by road
    corners = [(0.0, 0.5), (0.0, 0.0), (0.02, 0.0), (0.02, 0.5)]
    road = []
    for a, b in zip(corners, corners[1:]):
        road += [(a[0] + (b[0] - a[0]) * i / 20, a[1] + (b[1] - a[1]) * i / 20) for i in range(21)]
    lms = [{"slug": "a", "name": "A", "kind": "fort", "u": 0.0, "v": 0.5}, {"slug": "b", "name": "B", "kind": "fort", "u": 0.02, "v": 0.5}]
    assert guide.itinerary(lms, [road], (100000.0, 100000.0)) == {"stops": [], "route": []}
