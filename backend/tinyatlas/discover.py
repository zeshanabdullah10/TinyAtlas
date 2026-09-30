"""Find a region's landmarks automatically from Wikipedia geosearch (real pages, real coordinates).

Pipeline: geosearch around a few points of the bbox -> details (description, length, photo) for the candidates ->
classify from the Wikidata description -> drop noise (stations, hotels, ski areas, admin areas) -> score
(page length as a popularity proxy, a photo, an iconic kind, closeness to the centre) -> greedy pick with a minimum
spacing so the sights spread across the map instead of clumping in one town.
"""
import json
import math
import re
from pathlib import Path

import httpx

API = "https://en.wikipedia.org/w/api.php"
HEADERS = {"User-Agent": "TinyAtlas/0.1 (https://github.com/zeshanabdullah10/tinyatlas; open-source map project) httpx"}
CACHE = Path(__file__).resolve().parents[2] / "data" / "wiki"

# Checked in order against "<Wikidata description>. <first sentence>"; the first match wins.
NOISE = re.compile(r"\b(railway station|train station|metro station|bus stop|halt|airport|heliport|hotel|hostel|"
                   r"restaurant|school|hospital|clinic|company|business|cemetery|ski area|ski resort|stadium|"
                   r"disambiguation|municipality|district|canton|county|province|list of|neighbou?rhood|"
                   r"summit hut|hut|guesthouse|campsite|bank|shop|supermarket|grand prix|motor race|race|"
                   r"accident|crash|disaster|battle|massacre|festival|film|album|song|episode|season|"
                   r"championship|tournament|election|radar|weather station|transmitter|antenna|species|genus|"
                   r"constituency|electoral|road|highway|expressway|census-designated place|unincorporated|"
                   r"amusement park|theme park|water park|zoo|golf|diocese|archdiocese|parish|bishopric|"
                   r"ship|shipwreck|wreck|steamship|liner|submarine|warship)\b", re.I)
# The first sentence often mentions districts and cantons for perfectly good landmarks, so only hard noise counts there.
NOISE_SENT = re.compile(r"\b(railway station|train station|metro station|airport|heliport|hotel|hostel|hospital|"
                        r"school|ski area|ski resort|stadium|list of|disambiguation|speedway|race ?track|"
                        r"racing circuit|radar|weather station|amusement park|theme park|shipwreck|"
                        r"ship (?:that|which)|diocese)\b", re.I)
KINDS = [
    ("waterfall", r"\b(waterfall|falls)\b"),
    ("bridge", r"\b(bridge|viaduct|aqueduct)\b"),
    ("rail", r"\b(funicular|cog railway|rack railway|mountain railway|cable car|gondola|tramway|railway line|railway)\b"),
    ("lake", r"\b(lake|reservoir|lagoon|tarn|pond)\b"),
    ("glacier", r"\b(glacier|icefield|ice field)\b"),
    ("peak", r"\b(mountain|peak|summit|volcano|ridge|massif|crag|pinnacle|spire|dome|horn|pass|hill|cliff|"
             r"rock formation|monolith|buttress|granite|tor|bluff|escarpment)\b"),
    ("fort", r"\b(fort|castle|fortress|citadel|palace|chateau|château|kasbah)\b"),
    ("temple", r"\b(temple|shrine|monastery|mosque|pagoda|cathedral|church|basilica|chapel|abbey|stupa|gurdwara|synagogue)\b"),
    ("museum", r"\b(museum|gallery|library|observatory)\b"),
    ("tower", r"\b(tower|lighthouse|belltower|minaret)\b"),
    ("ruins", r"\b(ruins?|archaeological|archeological|ancient city|excavation|citadel)\b"),
    ("monument", r"\b(monument|memorial|statue|sculpture|arch|mausoleum|tomb|obelisk)\b"),
    ("park", r"\b(national park|nature reserve|park|garden|forest|valley|canyon|gorge|beach|island)\b"),
    ("town", r"\b(village|town|hamlet|city|resort|place in|settlement|locality|commune)\b"),
]
KIND_BONUS = {"peak": 0.6, "glacier": 0.3, "fort": 0.5, "temple": 0.4, "lake": 0.4, "waterfall": 0.5, "bridge": 0.35, "ruins": 0.4,
              "monument": 0.3, "tower": 0.3, "museum": 0.25, "rail": 0.15, "park": 0.1, "town": -0.4, "pin": -0.2}
MAX_PER_KIND = {"town": 1, "museum": 1, "rail": 1, "park": 2, "glacier": 1, "pin": 1}


CUT = re.compile(r"\s+(?:in|of|on|at|near|by|from|with|within|along|beside|between|above|below|that|which|"
                 r"located|situated|overlooking)\b|,", re.I)
SUBJECT = re.compile(r"\b(?:is|was|are|were)\s+(?:a|an|the|one of the)\s+([^.;]{0,90})", re.I)


def _subject(first: str) -> str:
    """'Lost Arrow Spire is a granite pinnacle in Yosemite Valley near Yosemite Falls.' -> 'granite pinnacle in
    Yosemite Valley near'. What the page IS, not everything the sentence mentions."""
    m = SUBJECT.search(first)
    if not m:
        return first[:100]
    return CUT.split(m.group(1), maxsplit=1)[0]        # stop at the first preposition or comma


def classify(description: str, extract: str = "") -> str | None:
    """Kind for a page, or None when it is noise. Uses the short description first, then what the first sentence
    says the page is; 'pin' when no kind is recognised."""
    first = re.split(r"(?<=[.!?])\s", (extract or "").strip())[0] if extract else ""
    text = f"{description or ''}. {first}"
    if NOISE.search(description or "") or NOISE_SENT.search(first[:120]):
        return None
    for kind, pat in KINDS:
        if re.search(pat, description or "", re.I):
            return kind
    subject = _subject(first)
    for kind, pat in KINDS:
        if re.search(pat, subject, re.I):
            return kind
    return "pin" if text.strip(". ") else None


def geosearch(lat: float, lon: float, radius_m: int = 10000, limit: int = 100, client=None) -> list[dict]:
    c = client or httpx
    r = c.get(API, headers=HEADERS, timeout=30, params={
        "action": "query", "list": "geosearch", "gscoord": f"{lat}|{lon}", "gsradius": radius_m,
        "gslimit": limit, "format": "json", "formatversion": 2})
    r.raise_for_status()
    return r.json()["query"]["geosearch"]


def details(titles: list[str], client=None) -> dict[str, dict]:
    """{title: {length, description, extract, thumb}} for up to ~20 titles per request."""
    c, out = client or httpx, {}
    for i in range(0, len(titles), 20):
        r = c.get(API, headers=HEADERS, timeout=30, params={
            "action": "query", "prop": "info|pageimages|extracts|description", "exintro": 1, "explaintext": 1,
            "exlimit": "max", "piprop": "thumbnail", "pithumbsize": 640, "redirects": 1,
            "titles": "|".join(titles[i:i + 20]), "format": "json", "formatversion": 2})
        r.raise_for_status()
        for p in r.json()["query"]["pages"]:
            if p.get("missing"):
                continue
            out[p["title"]] = {"length": p.get("length", 0), "description": p.get("description", ""),
                               "extract": p.get("extract", ""), "thumb": (p.get("thumbnail") or {}).get("source")}
    return out


def _km(lat1, lon1, lat2, lon2) -> float:
    dx = (lon2 - lon1) * 111.32 * math.cos(math.radians((lat1 + lat2) / 2))
    dy = (lat2 - lat1) * 110.54
    return math.hypot(dx, dy)


def candidates(bbox, client=None) -> list[dict]:
    """Geosearch hits inside bbox, deduplicated. Samples a 3x3 grid because one query reaches only 10 km."""
    w, s, e, n = bbox
    seen = {}
    for fy in (0.2, 0.5, 0.8):
        for fx in (0.2, 0.5, 0.8):
            lat, lon = s + (n - s) * fy, w + (e - w) * fx
            for g in geosearch(lat, lon, client=client):
                if w <= g["lon"] <= e and s <= g["lat"] <= n:
                    seen[g["title"]] = g
    return list(seen.values())


def pick(cands: list[dict], info: dict[str, dict], bbox, n: int = 8, min_sep_km: float | None = None) -> list[dict]:
    """Score, then greedily choose n well-spread landmarks -> [{title, kind}]."""
    w, s, e, nn = bbox
    clat, clon = (s + nn) / 2, (w + e) / 2
    max_d = max(_km(clat, clon, s, w), 1e-6)
    sep = min_sep_km if min_sep_km is not None else 0.11 * _km(clat, w, clat, e)
    scored = []
    for g in cands:
        d = info.get(g["title"])
        if not d:
            continue
        kind = classify(d["description"], d["extract"])
        if kind is None or d["length"] < 400:
            continue
        score = (math.log10(d["length"]) + (0.6 if d["thumb"] else 0) + KIND_BONUS.get(kind, 0)
                 + 0.3 * (1 - _km(clat, clon, g["lat"], g["lon"]) / max_d))
        scored.append((score, g, kind))
    scored.sort(key=lambda t: -t[0])
    chosen, per_kind = [], {}
    for score, g, kind in scored:
        if len(chosen) >= n:
            break
        if per_kind.get(kind, 0) >= MAX_PER_KIND.get(kind, 99):
            continue
        if any(_km(g["lat"], g["lon"], c["lat"], c["lon"]) < sep for c in chosen):
            continue
        chosen.append({"title": g["title"], "kind": kind, "lat": g["lat"], "lon": g["lon"]})
        per_kind[kind] = per_kind.get(kind, 0) + 1
    return [{"title": c["title"], "kind": c["kind"]} for c in chosen]


def discover(bbox, n: int = 8, client=None) -> list[dict]:
    cands = candidates(bbox, client)
    info = details([c["title"] for c in cands][:120], client)
    return pick(cands, info, bbox, n)


def guide_pages(place: str, client=None) -> list[tuple[str, str]]:
    """Pages to ground the guide on: the place's own Wikipedia article and its Wikivoyage travel guide."""
    out, c = [], client or httpx
    for host in ("en.wikipedia.org", "en.wikivoyage.org"):
        try:
            r = c.get(f"https://{host}/w/api.php", headers=HEADERS, timeout=30,
                      params={"action": "opensearch", "search": place, "limit": 1, "format": "json"})
            r.raise_for_status()
            titles = r.json()[1]
            if titles:
                out.append((host, titles[0]))
        except Exception:
            continue       # the guide just has less to draw on
    return out
