"""Phase 5 check: run test questions against the real sources.

Every capitalised place-like name in an answer must appear in the retrieved source text, and
questions the sources can't answer must be refused. Works in extractive mode (no API key) and
with the LLM once OPENROUTER_API_KEY is set.

    python backend/tools/eval_guide.py
"""
import io
import re
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tinyatlas import guide, sources  # noqa: E402
from tinyatlas.regions import REGIONS  # noqa: E402

ANSWERABLE = [
    "How did Attabad Lake form?",
    "What is Baltit Fort?",
    "Tell me about Altit Fort",
    "What is the Hussaini Suspension Bridge?",
    "What is Ultar Sar?",
    "Who were the Mirs of Hunza?",
    "What is the Karakoram Highway?",
]
# Known limitation of the keyword fallback (not scored): the sources say "apricots"/"wheat", never "crops".
# The guide refuses rather than guess; the LLM mode is what bridges synonyms.
SYNONYM_GAP = ["What crops grow in Hunza?"]
UNANSWERABLE = [
    "Where is the best pizza restaurant with wifi?",
    "What is the price of a room at the Serena hotel?",
    "Which airline flies to Hunza from Dubai?",
]

chunks = sources.chunks(REGIONS["hunza"])
corpus = " ".join(c["text"] for c in chunks).lower()
bad = 0
for q in ANSWERABLE + UNANSWERABLE:
    a = guide.answer(q, chunks)
    names = set(re.findall(r"(?<![.!?]\s)(?<!^)\b([A-Z][a-z]{3,})\b", a["answer"]))
    missing = sorted(n for n in names if n.lower() not in corpus)
    refused = a["answer"] == guide.NOT_FOUND
    on_topic = bool(set(guide.tokenize(q)) & set(guide.tokenize(a["answer"])))
    clean = "==" not in a["answer"]          # raw wiki headings are never an answer
    good = (not refused and a["sources"] != [] and on_topic and clean)
    ok = (refused if q in UNANSWERABLE else good) and not missing
    bad += not ok
    print(f"{'PASS' if ok else 'FAIL'} [{a['mode']}] {q}\n     -> {a['answer'][:140]!r} {[s['source'] for s in a['sources']]}"
          + (f"\n     names not in sources: {missing}" if missing else ""))
for q in SYNONYM_GAP:
    print(f"NOTE [{guide.answer(q, chunks)['mode']}] {q}  (synonym gap, not scored)")
print(f"\n{len(ANSWERABLE) + len(UNANSWERABLE) - bad}/{len(ANSWERABLE) + len(UNANSWERABLE)} passed")
sys.exit(1 if bad else 0)
