"""Build the landing page's static data and pictures from the packs and research (all committed under web/).

    python backend/tools/home_data.py

web/data/home.json   per-pack stats read from the Atlas packs + six timeline eras from data/research/swat_timeline.json
web/img/hero-1600.webp, hero-800.webp (portrait crop), og.jpg   from the unlabelled overview render, so the page sets its own type
Every number on the page comes from here; nothing is typed into the HTML by hand.
"""
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "web"
HERITAGE = {"stupa", "fort_ruin", "archaeological_site", "museum", "palace", "mosque", "rock_carving"}   # as in atlas_pack.py
PACKS = [("swat", "Swat Valley", "Kalam · Utror · Ushu · Mahodand"), ("swat-lower", "Lower Swat", "Mingora · Udegram · Malam Jabba")]
# Timeline: the six eras of the design canvas, each with the research events it shows (matched by exact date text).
ERAS = [
    ("Ancient Swat", "c. 1400 BCE to 327 BCE", ["c. 1400-800 BCE", "327 BCE"]),
    ("Uddiyana", "1st to 7th century", ["1st-3rd century CE", "629-645 CE (journey; Swat visit year not given)"]),
    ("Shahis to Sultanate", "8th to 16th century", ["from 8th century", "12th-16th century"]),
    ("Yusufzai & the Akhund", "1519 to 1849", ["1519", "1849"]),
    ("State of Swat", "1926 to 1969", ["3 May 1926", "28 July 1969"]),
    ("Recent years", "2007 to 2025", ["late 2007 - mid 2009", "June 2025 (beyond requested list)"]),
]
SHORT_DATE = {"1519": "1519", "1849": "1849", "c. 1400-800 BCE": "c. 1400-800 BCE", "327 BCE": "327 BCE", "1st-3rd century CE": "1st-3rd c. CE",
              "629-645 CE (journey; Swat visit year not given)": "629-645 CE", "from 8th century": "From the 8th c.",
              "12th-16th century": "12th-16th c.", "3 May 1926": "1926", "28 July 1969": "1969",
              "late 2007 - mid 2009": "2007-2009", "June 2025 (beyond requested list)": "2025"}


def stats(slug, title, subtitle):
    d = ROOT / "data" / "packs" / slug / "atlas"
    meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
    places = json.loads((d / "places.json").read_text(encoding="utf-8"))
    gaz = {g["slug"]: g for g in json.loads((ROOT / "data/research/swat_gazetteer.json").read_text(encoding="utf-8"))}
    peaks = sorted((p for p in places if p["kind"] == "peak" and p.get("label_elevation_m")), key=lambda p: -p["label_elevation_m"])
    top = peaks[0] if peaks else None
    note = (gaz.get(top["slug"], {}).get("elevation_note") or "") if top else ""
    return {"slug": slug, "title": title, "subtitle": subtitle, "cover": f"packs/{slug}/atlas/cover.webp",
            "size_km": [round(meta["size_m"][0] / 1000), round(meta["size_m"][1] / 1000)], "places": len(places),
            "heritage": sum(p["kind"] in HERITAGE for p in places), "lakes": sum(p["kind"] == "lake" for p in places),
            "peak": {"name": top["name"], "m": round(top["label_elevation_m"]), "source": "Wikipedia" if note.startswith("Wikipedia") else "OpenStreetMap" if "OSM" in note else "the sources"} if top else None}


def brief(text):
    """The first sentence, without editorial brackets, so it fits the strip."""
    return text.replace(" (neutral summary)", "").split(". ")[0].rstrip(".")


def timeline():
    ev = {e["date"]: e for e in json.loads((ROOT / "data/research/swat_timeline.json").read_text(encoding="utf-8"))}
    return [{"era": era, "years": years,
             "events": [{"date": SHORT_DATE[k], "text": brief(ev[k]["event"]), "source": ev[k]["source"]} for k in keys]}
            for era, years, keys in ERAS]


def images():
    src = Image.open(ROOT / "data/renders/swat/overview.png").convert("RGB")
    (WEB / "img").mkdir(exist_ok=True)
    src.resize((1600, 1067), Image.LANCZOS).save(WEB / "img/hero-1600.webp", quality=80, method=6)
    w, h = src.size
    crop = src.crop((int(w * 0.30), int(h * 0.20), int(w * 0.30) + 960, int(h * 0.20) + 1200)).resize((720, 900), Image.LANCZOS)
    crop.save(WEB / "img/hero-800.webp", quality=78, method=6)
    og = src.crop((0, int(h * 0.12), w, int(h * 0.12) + round(w * 630 / 1200))).resize((1200, 630), Image.LANCZOS)
    og.save(WEB / "img/og.jpg", quality=80, optimize=True)


if __name__ == "__main__":
    (WEB / "data").mkdir(exist_ok=True)
    out = {"regions": [stats(*p) for p in PACKS], "timeline": timeline()}
    (WEB / "data/home.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    images()
    for f in ("data/home.json", "img/hero-1600.webp", "img/hero-800.webp", "img/og.jpg"):
        print(f, (WEB / f).stat().st_size // 1024, "KB")
