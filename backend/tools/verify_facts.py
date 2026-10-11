"""Check that every fact's quote appears word for word on its source page.

    python backend/tools/verify_facts.py [<pack> ...]             # facts on the built packs' place cards
    python backend/tools/verify_facts.py --file <proposals.json>   # {"<slug>": {"facts": [{text, quote, source}]}}

Pages are fetched once with curl (Wikimedia refuses other clients from this machine; one request every 2 s, a
minute's wait on 429) and cached under data/cache/wiki/html/. A quote passes when it is in the page's visible text
after HTML entities, tags, footnote marks ([1]), quote marks, dashes and whitespace are normalised. Every number in
a fact's text must also appear in its quote (a fact says no more than its source). Exit code 1 when anything fails.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pack_photos import PACKS, get, places  # noqa: E402
import html as htmllib  # noqa: E402


def norm(s):
    s = htmllib.unescape(s)
    s = re.sub(r"\[(?:\d+|[a-z]|note \d+|citation needed)\]", "", s)
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = re.sub(r"[‐-―−]", "-", s)
    s = s.replace(" ", " ").replace(" ", " ")
    return re.sub(r"\s+", " ", s).strip().lower()


_pages = {}


def page_text(url):
    if url not in _pages:
        b = get(url, cache=True) or b""
        s = b.decode("utf-8", "replace")
        s = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", s)
        s = re.sub(r"(?is)<sup[^>]*class=\"[^\"]*reference[^\"]*\"[^>]*>.*?</sup>", "", s)
        _pages[url] = norm(re.sub(r"<[^>]+>", " ", s))
    return _pages[url]


def numbers(s):
    return set(re.findall(r"\d[\d,.]*\d|\d", s.replace(",", "")))


def check(slug, f):
    """Problems with one fact, as text ("" when it passes)."""
    q, src = f.get("quote", ""), f.get("source", "")
    if not q or not src.startswith("http"):
        return "no quote or source"
    text = page_text(src)
    if not text:
        return f"could not fetch {src}"
    if norm(q) not in text:
        return f"quote not on page: {q[:80]!r}"
    extra = numbers(f.get("text", "")) - numbers(q)
    if extra:
        return f"numbers not in quote: {sorted(extra)}"
    return ""


def main(argv):
    bad = n = 0
    if argv[:1] == ["--file"]:
        items = [(s, f) for s, r in json.loads(Path(argv[1]).read_text(encoding="utf-8")).items() for f in r.get("facts", [])]
    else:
        packs = argv or sorted(x.name for x in PACKS.iterdir() if (x / "atlas" / "places.json").exists())
        items = [(p["slug"], f) for pk in packs for p in places(pk)[1] for f in p.get("facts", [])]
    for slug, f in items:
        n += 1
        why = check(slug, f)
        if why:
            bad += 1
            print(f"FAIL {slug}: {why}  [{f.get('source', '')}]")
    print(f"{n - bad}/{n} facts verified")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
