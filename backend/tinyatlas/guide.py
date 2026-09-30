"""Grounded guide: retrieval over the fetched Wikipedia/Wikivoyage text, then (optionally) an LLM.

Rules the guide follows: answer only from the retrieved excerpts, cite them as [1], [2]...,
and say it isn't in the sources when retrieval finds nothing relevant. With no API key it
falls back to returning the best excerpt verbatim with its citation (mode = "extractive").
"""
import math
import re
from collections import Counter

from . import llm, routing, sources

STOP = set("a an and are as at be but by can did do does for from how i if in is it its me my of on or so than that the "
           "their there this to was we what when where which who why will with you your about tell".split())
NOT_FOUND = "That isn't in my sources for this region."
SYSTEM = (
    "You are a friendly local guide for a miniature map. Answer ONLY using the numbered excerpts provided. "
    "Cite the excerpts you use as [1], [2]. Never mention a place, business, price or fact that is not in the "
    f"excerpts. If the excerpts do not answer the question, reply exactly: {NOT_FOUND} Keep answers under 120 words."
)


INTRO_Q = re.compile(r"\s*(what|who)\s+(is|are|was|were)\b|\s*tell me about\b|\s*about\b", re.I)


def stem(w: str) -> str:
    for suf in ("ing", "ed", "es", "s"):
        if len(w) > len(suf) + 3 and w.endswith(suf):
            return w[: -len(suf)]
    return w


def tokenize(text: str) -> list[str]:
    return [stem(w) for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in STOP and len(w) > 1]


def retrieve(query: str, chunks: list[dict], k: int = 4, min_coverage: float = 0.5, strict: bool = True) -> list[dict]:
    """BM25 ranking, but a chunk only counts as relevant if it contains at least `min_coverage`
    of the query's meaningful terms. That is what lets the guide say "not in my sources".
    strict=True also refuses when a third or more of the terms occur nowhere in the sources; the LLM path turns
    that off (synonyms like crops/apricots) and relies on the prompt to refuse when excerpts don't answer."""
    q = set(tokenize(query))
    if not q or not chunks:
        return []
    docs = [tokenize(f"{c['text']} {c['source']} {c.get('section', '')}") for c in chunks]
    avg = sum(map(len, docs)) / len(docs)
    df = Counter(t for d in docs for t in set(d))
    n = len(docs)
    if strict and sum(1 for t in q if df[t] == 0) / len(q) >= 1 / 3:
        return []      # too much of the question is about things the sources never mention
    scored = []
    for c, d in zip(chunks, docs):
        tf = Counter(d)
        matched = [t for t in q if t in tf]
        if len(matched) / len(q) < min_coverage:
            continue
        s = sum(math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5)) * tf[t] * 2.2
                / (tf[t] + 1.2 * (0.25 + 0.75 * len(d) / avg)) for t in matched)
        if INTRO_Q.match(query) and c.get("first"):
            s *= 1.6   # "what is X" -> the page's opening chunk defines it
        scored.append((s, c))
    scored.sort(key=lambda x: -x[0])
    return [c for _, c in scored[:k]]


def _first_sentences(text: str, n: int = 2) -> str:
    return " ".join(re.split(r"(?<=[.!?])\s+", text.strip())[:n])


def _best_sentences(question: str, text: str, n: int = 2) -> str:
    """The n sentences sharing the most terms with the question, in original order (ties -> earlier)."""
    q = set(tokenize(question))
    sents = [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n", text) if len(s.strip()) > 20]
    if not sents:
        return _first_sentences(text, n)
    ranked = sorted(range(len(sents)), key=lambda i: (-len(q & set(tokenize(sents[i]))), i))[:n]
    return " ".join(sents[i] for i in sorted(ranked))


def answer(question: str, chunks: list[dict], history: list[dict] | None = None) -> dict:
    hits = retrieve(question, chunks, strict=not llm.available())
    if not hits:
        return {"answer": NOT_FOUND, "sources": [], "mode": "none"}
    cites = [{"n": i + 1, "source": c["source"], "url": c["url"]} for i, c in enumerate(hits)]
    if llm.available():
        excerpts = "\n\n".join(f"[{i + 1}] ({c['source']}) {c['text']}" for i, c in enumerate(hits))
        msgs = [{"role": "system", "content": SYSTEM}, *(history or [])[-4:],
                {"role": "user", "content": f"Excerpts:\n{excerpts}\n\nQuestion: {question}"}]
        try:
            return {"answer": llm.complete(msgs, max_tokens=350), "sources": cites, "mode": "llm"}
        except llm.LLMUnavailable:
            pass
    return {"answer": f"{_best_sentences(question, hits[0]['text'])} [1]", "sources": cites[:1], "mode": "extractive"}


def story(landmark: dict, chunks: list[dict]) -> dict:
    """A short, friendly story for a landmark, grounded in its own page text."""
    own = [c for c in chunks if c["url"] == landmark["url"]][:3]
    text = "\n".join(c["text"] for c in own) or landmark["summary"]
    if llm.available():
        msgs = [{"role": "system", "content": "Write a warm 3-4 sentence story about this place for a traveller, "
                 "using ONLY the facts in the text. Do not add facts, names or dates that are not present."},
                {"role": "user", "content": f"{landmark['name']}:\n{text[:3500]}"}]
        try:
            return {"story": llm.complete(msgs, max_tokens=250, temperature=0.5), "mode": "llm"}
        except llm.LLMUnavailable:
            pass
    return {"story": _first_sentences(landmark["summary"], 3), "mode": "extractive"}


MAX_ROAD_SNAP_M = 2000     # a sight farther than this from any road is a viewpoint, not a route stop
VIEWPOINT_SNAP_M = 800     # summits and glaciers must have the road or path right beside them
VIEWPOINT_KINDS = {"peak", "glacier"}


def itinerary(lms: list[dict], roads=None, size_m=None, trails=None) -> dict:
    """Order the landmarks by shortest road distance (exhaustive for <= 8), starting at the westernmost one.
    Returns ordered stops plus a polyline of (u, v) points for the dotted route; with `roads`
    (OSM polylines) and `size_m` the polyline follows the road network between stops."""
    if roads and size_m:
        def near(net):
            graph = routing.build_graph(net, size_m)
            limit = lambda l: VIEWPOINT_SNAP_M if l.get("kind") in VIEWPOINT_KINDS else MAX_ROAD_SNAP_M
            return [l for l in lms if routing.snap_distance_m(graph, (l["u"], l["v"]), size_m) <= limit(l)]
        stops = near(roads)
        if len(stops) < 2 and trails:            # car-free or hiking country: walk the footpaths instead
            roads = roads + trails
            stops = near(roads)
        lms = stops
    if not lms:
        return {"stops": [], "route": []}
    west = min(range(len(lms)), key=lambda i: lms[i]["u"])
    pts = [(l["u"], l["v"]) for l in lms]
    size = size_m or (1.0, 1.0)
    idx = routing.best_order(pts, roads or [], size, start=west)
    order = [lms[i] for i in idx]
    pts = [(l["u"], l["v"]) for l in order]
    route = routing.route_through(pts, roads, size_m) if roads and size_m else [list(p) for p in pts]
    return {"stops": [{"slug": l["slug"], "name": l["name"]} for l in order], "route": route}
