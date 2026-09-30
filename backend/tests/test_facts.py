from tinyatlas import facts, llm

EXCERPTS = [
    {"source": "Hunza", "url": "https://v/Hunza", "section": "Get in",
     "text": "The Karakoram Highway links Gilgit and Karimabad. Buses leave Gilgit every morning."},
    {"source": "Hunza", "url": "https://v/Hunza", "section": "Stay safe", "text": "Landslides can close the road in summer."},
]


def test_facts_without_a_real_quote_are_dropped():
    got = facts.verified([
        {"topic": "getting_there", "text": "Buses run from Gilgit each morning.", "source": 1, "quote": "Buses leave Gilgit every morning"},
        {"topic": "safety", "text": "Landslides close the road.", "source": 2, "quote": "landslides  can close the ROAD"},  # spacing/case
        {"topic": "money", "text": "There are three ATMs.", "source": 1, "quote": "three ATMs in town"},                    # invented
        {"topic": "safety", "text": "Roads close.", "source": 9, "quote": "Landslides can close"},                         # bad source
        {"topic": "weather", "text": "Sunny.", "source": 1, "quote": "The Karakoram Highway"},                             # bad topic
    ], EXCERPTS)
    assert [f["topic"] for f in got] == ["getting_there", "safety"]
    assert got[0]["url"] == "https://v/Hunza"


def test_extract_caches_and_verifies(tmp_path, monkeypatch):
    monkeypatch.setattr(facts, "CACHE", tmp_path)
    calls = []

    def fake(messages, **kw):
        calls.append(1)
        return {"facts": [{"topic": "getting_there", "text": "Buses leave Gilgit daily.", "source": 1,
                           "quote": "Buses leave Gilgit every morning"},
                          {"topic": "permits", "text": "A permit costs $50.", "source": 2, "quote": "permit costs"}]}
    monkeypatch.setattr(llm, "complete_json", fake)
    first = facts.extract("hunza", EXCERPTS)
    assert [f["topic"] for f in first["facts"]] == ["getting_there"] and first["checked"]
    assert facts.extract("hunza", EXCERPTS) == first and len(calls) == 1          # second call served from cache


def test_parse_json_digs_out_of_prose():
    assert llm.parse_json('Sure! ```json\n{"a": 1}\n``` hope that helps') == {"a": 1}
    assert llm.parse_json("[1, 2]") == [1, 2]
