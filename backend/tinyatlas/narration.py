"""Audio guide scripts: a short spoken story per landmark, grounded in that landmark's own sources, in English,
then translated into Urdu and Simplified Chinese. Voiced on a GPU pod by backend/tools/audio.py.

Scripts are cached in data/audio/<region>/<slug>.<lang>.txt so a re-run only pays for what is missing.
"""
from pathlib import Path

from . import llm

ROOT = Path(__file__).resolve().parents[2] / "data" / "audio"
LANGS = {"en": "English", "ur": "Urdu", "zh": "Simplified Chinese"}

SCRIPT = (
    "Write a spoken audio-guide narration of 120 to 170 words for a traveller who has just arrived at this place. "
    "Use ONLY the facts in the text given; do not add names, dates, numbers or stories that are not there. Speak "
    "directly to the listener, point out what they can look at, and keep sentences short and easy to follow when "
    "heard aloud. No headings, no lists, no stage directions, no quotation marks. Plain text only."
)
TRANSLATE = (
    "Translate this audio-guide narration into natural spoken {lang} for native listeners. Keep every fact exactly; "
    "add nothing. {extra}Return only the translation, plain text."
)
EXTRA = {"ur": "Use Urdu script (Nastaliq), not Roman Urdu. Keep place names as locals say them. ",
         "zh": "Use Simplified Chinese characters. "}


def path(region: str, slug: str, lang: str) -> Path:
    return ROOT / region / f"{slug}.{lang}.txt"


def script(landmark: dict, chunks: list[dict]) -> str:
    own = [c for c in chunks if c["url"] == landmark["url"]][:4]
    text = "\n".join(c["text"] for c in own) or landmark.get("summary", "")
    return llm.complete([{"role": "system", "content": SCRIPT},
                         {"role": "user", "content": f"{landmark['name']}:\n{text[:5000]}"}],
                        max_tokens=600, temperature=0.4, task="narration").strip()


def translate(text: str, lang: str) -> str:
    return llm.complete([{"role": "system", "content": TRANSLATE.format(lang=LANGS[lang], extra=EXTRA.get(lang, ""))},
                         {"role": "user", "content": text}], max_tokens=900, temperature=0.2, task="narration").strip()


def _one(region: str, lm: dict, chunks: list[dict], langs) -> tuple[str, dict]:
    en = path(region, lm["slug"], "en")
    en.parent.mkdir(parents=True, exist_ok=True)
    if not en.exists():
        en.write_text(script(lm, chunks), encoding="utf-8")
    texts = {"en": en.read_text(encoding="utf-8")}
    for lang in langs:
        if lang == "en":
            continue
        p = path(region, lm["slug"], lang)
        if not p.exists():
            p.write_text(translate(texts["en"], lang), encoding="utf-8")
        texts[lang] = p.read_text(encoding="utf-8")
    return lm["slug"], texts


def ensure(region: str, landmarks: list[dict], chunks: list[dict], langs=tuple(LANGS), workers: int = 6) -> dict:
    """Write any missing scripts (several landmarks at once); returns {slug: {lang: text}}. A landmark whose
    model calls fail is left out and retried on the next run."""
    from concurrent.futures import ThreadPoolExecutor
    out = {}
    with ThreadPoolExecutor(workers) as pool:
        for fut in [pool.submit(_one, region, lm, chunks, langs) for lm in landmarks]:
            try:
                slug, texts = fut.result()
                out[slug] = texts
            except llm.LLMUnavailable as exc:
                print(f"  skipped a landmark in {region}: {exc}", flush=True)
    return out
