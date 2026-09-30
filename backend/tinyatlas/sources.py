"""Real-world text for landmarks and the guide: Wikipedia + Wikivoyage, cached on disk.

Nothing here is generated; landmark coordinates and all guide text come from these pages.
Wikipedia text is CC BY-SA - keep the `url` with every chunk so answers can cite it.
"""
import json
import re
from pathlib import Path

import httpx

HEADERS = {"User-Agent": "TinyAtlas/0.1 (https://github.com/zeshanabdullah10/tinyatlas; open-source map project) httpx"}
CACHE = Path(__file__).resolve().parents[2] / "data" / "wiki"
MAX_CHARS = 20000
HEADING = re.compile(r"^=+\s*(.+?)\s*=+$")
SKIP_SECTIONS = {"see also", "references", "external links", "bibliography", "gallery", "notes", "further reading",
                 "awards", "sources", "footnotes", "citations"}


def slugify(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")


def _cached(key: str, fetch):
    path = CACHE / f"{key}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    data = fetch()
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return data


def fetch_page(host: str, title: str, client: httpx.Client | None = None) -> dict:
    """{title, url, text, lat, lon, image, description} for a wiki page (None where the page has none)."""
    def go():
        c = client or httpx
        r = c.get(f"https://{host}/w/api.php", headers=HEADERS, timeout=30, params={
            "action": "query", "prop": "extracts|coordinates|info|pageimages|description", "inprop": "url",
            "explaintext": 1, "exlimit": 1, "colimit": 1, "piprop": "thumbnail", "pithumbsize": 720,
            "redirects": 1, "titles": title, "format": "json", "formatversion": 2,
        })
        r.raise_for_status()
        pages = r.json()["query"]["pages"]
        p = pages[0] if pages else {}
        coord = (p.get("coordinates") or [{}])[0]
        return {
            "title": p.get("title", title),
            "url": p.get("fullurl", f"https://{host}/wiki/{title.replace(' ', '_')}"),
            "text": (p.get("extract") or "")[:MAX_CHARS],
            "lat": coord.get("lat"),
            "lon": coord.get("lon"),
            "image": (p.get("thumbnail") or {}).get("source"),
            "description": p.get("description", ""),
            "missing": bool(p.get("missing")),
        }
    return _cached(f"{host.split('.')[1]}_{slugify(title)}_v2", go)


PAREN = re.compile(r"\s*\([^()]*\)")
SPACE_BEFORE_PUNCT = re.compile(r"\s+([,.;:])")


def clean_lead(text: str) -> str:
    """Display version of a lead paragraph: parentheses hold pronunciations, native names and dates that read as
    noise in a caption ("Zermatt (German: [tsɛrˈmat]; ...) is a municipality"). Retrieval keeps the full text."""
    for _ in range(3):                       # nested groups
        text = PAREN.sub("", text)
    text = re.sub(r"\s{2,}", " ", text)
    return SPACE_BEFORE_PUNCT.sub(r"\1", text).strip()


def to_uv(lat: float, lon: float, bbox) -> tuple[float, float] | None:
    """(u east, v south) in [0,1], or None if outside the bbox."""
    w, s, e, n = bbox
    if not (w <= lon <= e and s <= lat <= n):
        return None
    return (lon - w) / (e - w), (n - lat) / (n - s)


def _landmark_pages(region: dict, client: httpx.Client | None = None):
    """(landmark cfg, page, (u, v)) for pages that exist and sit inside the region's bbox.
    Drops same-named pages elsewhere in the world and sights outside this map."""
    for lm in region["landmarks"]:
        page = fetch_page("en.wikipedia.org", lm["title"], client)
        if page["missing"] or page["lat"] is None:
            continue
        uv = to_uv(page["lat"], page["lon"], region["bbox"])
        if uv is not None:
            yield lm, page, uv


def landmarks(region: dict, client: httpx.Client | None = None) -> list[dict]:
    out = []
    for lm, page, uv in _landmark_pages(region, client):
        text = page["text"]
        out.append({
            "slug": slugify(lm["title"]), "name": page["title"], "kind": lm["kind"],
            "lat": page["lat"], "lon": page["lon"], "u": uv[0], "v": uv[1],
            "summary": text.split("\n\n")[0][:600], "url": page["url"],
            "image": page.get("image"), "description": page.get("description", ""),
        })
    return out


def chunks(region: dict, client: httpx.Client | None = None, size: int = 900) -> list[dict]:
    """Paragraph-packed text chunks from landmark pages + guide pages, each with its source."""
    pages = [page for _, page, _ in _landmark_pages(region, client)]
    pages +=[fetch_page(h, t, client) for h, t in region.get("guide_pages", [])]
    out = []
    for p in pages:
        if p["missing"] or not p["text"]:
            continue
        section, buf, first = "", "", True

        def flush():
            nonlocal buf, first
            if buf:
                out.append({"source": p["title"], "url": p["url"], "section": section, "text": buf, "first": first})
                first = False
            buf = ""

        for line in p["text"].splitlines():
            line = line.strip()
            m = HEADING.match(line)
            if m:                      # headings become chunk context, never chunk text
                flush()
                section = m.group(1)
                continue
            if not line or section.lower() in SKIP_SECTIONS:
                continue
            if buf and len(buf) + len(line) > size:
                flush()
            buf = f"{buf}\n{line}".strip()
        flush()
    return out
