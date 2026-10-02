"""Audio guide scripts: a short spoken story per landmark, grounded in that landmark's own sources, in English,
voiced locally by backend/tools/audio_local.py.

Scripts are cached in data/audio/<region>/<slug>.<lang>.txt so a re-run only pays for what is missing.
"""
import re
from pathlib import Path

from . import llm

ROOT = Path(__file__).resolve().parents[2] / "data" / "audio"

SCRIPT = (
    "You write one spoken audio-guide placard for a traveller standing at this place. You are given the place's "
    "sourced material: a summary, facts, a timeline and access notes. Rules:\n"
    "- Use ONLY what is in the material. Every name, number, date and claim must come from it. Never add anything "
    "from your own knowledge.\n"
    "- Order: first what the place is, then its story or history (timeline, in order) if there is any, then one "
    "practical note about getting there if the material has access information.\n"
    "- Length: at most {cap} words. If the material is thin, write fewer; stop when the facts run out. Never pad.\n"
    "- Say each fact once. No repetition, no imperatives (never 'look at', 'notice', 'think about', 'imagine', "
    "'enjoy', 'take in', 'let'), no generic tourism filler (breathtaking, stunning, must-visit, hidden gem), and "
    "no remarks about the view unless the material states a real feature. At most one sensory line, and only if "
    "tied to a feature named in the material.\n"
    "- Spoken style: short plain sentences, as read aloud by a guide. Write numbers as digits and spell units out "
    "(2,865 metres, 40 kilometres, 1835), never as symbols or abbreviations. No headings, lists, quotation marks "
    "or stage directions. Plain text only."
)
BANNED = re.compile(r"\b(look(?:ing)? (?:at|out)|notice|think about|imagine|picture this|enjoy|take in|take a moment|"
                    r"let the|let your|breathtaking|stunning|must-visit|hidden gem|nestled|tapestry|whether you)\b", re.I)


def items(place: dict) -> list[str]:
    """The distinct sourced statements a story may draw on: summary, facts, timeline entries (access is the practical note)."""
    out = [place.get("summary", "")] if place.get("summary") else []
    out += [f["text"] for f in place.get("facts") or []]
    out += [f"{t['date']}: {t['event']}" for t in place.get("timeline") or []]
    return out


def word_cap(n_items: int) -> int:
    return max(40, min(130, 25 * n_items))


def material(place: dict) -> str:
    lines = [f"Name: {place['name']}", f"Kind: {place.get('kind', 'place')}", f"Summary: {place.get('summary', '')}"]
    lines += [f"Fact: {f['text']}" for f in place.get("facts") or []]
    lines += [f"Timeline: {t['date']}: {t['event']}" for t in place.get("timeline") or []]
    if place.get("access"):
        lines.append(f"Access: {place['access']}")
    return "\n".join(lines)


def problems(story: str, place: dict, cap: int) -> list[str]:
    """Why a story must be rewritten: too long, filler, or a number/name that the material does not contain."""
    src = material(place)
    bad = []
    n = len(story.split())
    if n > cap + 8:
        bad.append(f"it has {n} words; the limit is {cap}")
    if m := BANNED.search(story):
        bad.append(f"it contains the banned phrase '{m.group(0)}'")
    have = {x.replace(",", "") for x in re.findall(r"\d[\d,.]*\d|\d", src)}
    for x in {x.replace(",", "") for x in re.findall(r"\d[\d,.]*\d|\d", story)} - have:
        bad.append(f"the number {x} is not in the material")
    known = {w.lower() for w in re.findall(r"[A-Za-z'-]+", src)}
    for sentence in re.split(r"(?<=[.!?])\s+", story):
        for w in re.findall(r"(?<!^)(?<=\s)[A-Z][A-Za-z'-]+", sentence):
            if w.lower() not in known:
                bad.append(f"the name '{w}' is not in the material")
    return bad


def path(region: str, slug: str, lang: str) -> Path:
    return ROOT / region / f"{slug}.{lang}.txt"


def script(place: dict) -> str:
    """The placard text for an Atlas place record (summary, facts, timeline, access), checked against that record."""
    cap = word_cap(len(items(place)))
    messages = [{"role": "system", "content": SCRIPT.format(cap=cap)}, {"role": "user", "content": material(place)}]
    for attempt in range(3):
        story = llm.complete(messages, max_tokens=400, temperature=0.3 + 0.1 * attempt, task="narration").strip()
        bad = problems(story, place, cap)
        if not bad:
            return story
        messages = messages[:2] + [{"role": "assistant", "content": story},
                                   {"role": "user", "content": "Rewrite it; " + "; ".join(bad) + ". Same rules."}]
    raise llm.LLMUnavailable(f"no clean story for {place['slug']}: {bad}")


def ensure(region: str, places: list[dict], workers: int = 6) -> dict:
    """Write any missing English scripts (several places at once); returns {slug: text}. A place whose model
    calls fail is left out and retried on the next run."""
    from concurrent.futures import ThreadPoolExecutor

    def one(place):
        p = path(region, place["slug"], "en")
        p.parent.mkdir(parents=True, exist_ok=True)
        if not p.exists():
            p.write_text(script(place), encoding="utf-8")
        return place["slug"], p.read_text(encoding="utf-8")

    out = {}
    with ThreadPoolExecutor(workers) as pool:
        for fut in [pool.submit(one, pl) for pl in places]:
            try:
                slug, text = fut.result()
                out[slug] = text
            except llm.LLMUnavailable as exc:
                print(f"  skipped a place in {region}: {exc}", flush=True)
    return out
