"""Know before you go: practical facts pulled out of the region's Wikivoyage and Wikipedia text.

A cheap model reads the guide text and returns facts by topic. Every fact must carry a short verbatim quote from the
excerpt it came from; a fact whose quote is not actually in the source is dropped, so the model cannot add
anything the sources don't say. Results are cached per region in data/facts/<region>.json with the date they were
checked, which the app shows.
"""
import json
import re
import time
from pathlib import Path

from . import llm

CACHE = Path(__file__).resolve().parents[2] / "data" / "facts"
TOPICS = {
    "getting_there": "Getting there",
    "getting_around": "Getting around",
    "when_to_go": "When to go",
    "permits": "Permits and fees",
    "health": "Altitude and health",
    "money": "Money and connectivity",
    "safety": "Staying safe",
    "respect": "Local customs",
}
SYSTEM = (
    "You extract practical travel facts for tourists from numbered excerpts. Return JSON only: "
    '{"facts": [{"topic": one of ' + json.dumps(list(TOPICS)) + ', "text": "one or two plain sentences", '
    '"source": excerpt number, "quote": "a short phrase copied EXACTLY, character for character, from that excerpt"}]}. '
    "Only state what the excerpts say. No prices unless an excerpt gives one. At most 3 facts per topic, skip topics "
    "the excerpts don't cover. Prefer concrete, useful facts (road conditions, closures by season, permits, altitude, "
    "ATMs, mobile signal, fuel)."
)
PRACTICAL = re.compile(r"get in|get around|by (road|bus|car|plane|air)|understand|climate|stay safe|stay healthy|"
                       r"cope|connect|buy|money|respect|permit|see|do", re.I)


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.lower()).strip(" .,;:\"'")


def verified(facts: list[dict], excerpts: list[dict]) -> list[dict]:
    """Keep facts whose quote really appears in the excerpt they cite; attach that excerpt's source."""
    out, seen = [], set()
    for f in facts:
        try:
            src = excerpts[int(f["source"]) - 1]
        except (KeyError, ValueError, IndexError, TypeError):
            continue
        quote = _norm(str(f.get("quote", "")))
        if len(quote) < 8 or quote not in _norm(src["text"]) or f.get("topic") not in TOPICS:
            continue
        text = str(f.get("text", "")).strip()
        if not text or _norm(text) in seen:
            continue
        seen.add(_norm(text))
        out.append({"topic": f["topic"], "text": text, "quote": f["quote"].strip(), "source": src["source"], "url": src["url"]})
    return out


def excerpts_for(chunks: list[dict], limit: int = 14) -> list[dict]:
    """The chunks most likely to hold practical facts: Wikivoyage first, practical sections first."""
    def rank(c):
        voyage = "wikivoyage" in c["url"]
        return (not voyage, not PRACTICAL.search(c.get("section", "") or ""), not c.get("first"))
    return sorted(chunks, key=rank)[:limit]


def extract(region: str, chunks: list[dict], refresh: bool = False) -> dict:
    """{checked: 'YYYY-MM-DD', facts: [...]} for a region, cached."""
    path = CACHE / f"{region}.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text(encoding="utf-8"))
    ex = excerpts_for(chunks)
    if not ex:
        return {"checked": None, "facts": []}
    body = "\n\n".join(f"[{i + 1}] ({c['source']}, {c.get('section') or 'intro'}) {c['text']}" for i, c in enumerate(ex))
    data = llm.complete_json([{"role": "system", "content": SYSTEM}, {"role": "user", "content": body}],
                             max_tokens=2500, task="extract")
    facts = verified(data.get("facts", []) if isinstance(data, dict) else [], ex)
    order = list(TOPICS)
    facts.sort(key=lambda f: order.index(f["topic"]))
    result = {"checked": time.strftime("%Y-%m-%d"), "facts": facts}
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    return result
