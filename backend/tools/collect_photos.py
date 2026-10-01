"""Collect openly licensed Commons photos for Swat/Kumrat landmarks (via en.wikipedia API proxy).
Usage: python backend/tools/collect_photos.py [slug ...]"""
import json, re, sys, time, math, hashlib, html
from pathlib import Path
from urllib.parse import unquote
import httpx
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
GAZ = ROOT / "data/research/swat_gazetteer.json"
CACHE = ROOT / "data/cache/wiki"
OUT = ROOT / "data/photos"
API = "https://en.wikipedia.org/w/api.php"
UA = {"User-Agent": "TinyAtlas/0.1 (https://github.com/zeshanabdullah10/tinyatlas; open-source travel map research)"}
KINDS = {"stupa", "monastery", "rock_carving", "fort_ruin", "palace", "mosque", "museum",
         "archaeological_site", "bridge", "ski_resort", "lake", "waterfall", "meadow"}
LANDSCAPE = {"lake", "waterfall", "meadow", "ski_resort"}
MAXC = 15
# extra (query, must-match-regex) variants per slug-substring
VARIANTS = {
    "butkara-i-stupa": [("Butkara", r"but+kara"), ("Butkara stupa", r"but+kara"), ("Buthkara", r"buth?kara")],
    "butkara-iii": [("Butkara III", r"but+kara"), ("Butkara stupa", r"but+kara")],
    "saidu": [("Saidu Sharif stupa", r"saidu"), ("Saidu Sharif Buddhist", r"saidu")],
    "swat-museum": [("Swat Museum", r"swat.?museum|museum.*swat|swat.*museum")],
    "bazira": [("Barikot", r"barikot|bazira"), ("Bazira Barikot Ghundai", r"barikot|bazira")],
    "gumbat": [("Gumbat stupa Balo Kale", r"gumbat|balo.?kale")],
    "amluk": [("Amluk Dara", r"amluk")],
    "shingardar": [("Shingardar", r"shingardar")],
    "ghalegay": [("Ghalegay Buddha", r"ghalegay"), ("Ghaligay Buddha", r"ghali")],
    "raja-gira": [("Raja Gira", r"raja.?gira"), ("Udegram castle", r"udegram|odigram"), ("Raja Gira castle Udegram", r"gira")],
    "mahmud": [("Mahmud Ghaznavi mosque Udegram", r"ghazn|udegram|odigram"), ("Udegram mosque", r"udegram|odigram")],
    "gogdara": [("Gogdara rock carvings", r"gogdara"), ("Gogdara", r"gogdara")],
    "nimogram": [("Nimogram stupa", r"nimogram")],
    "chakdara": [("Chakdara Fort", r"chakdara")],
    "white-palace": [("White Palace Marghazar", r"marghazar|white.?palace"), ("Marghazar", r"marghazar")],
    "jahanabad": [("Jahanabad Buddha", r"jahanabad"), ("Manglawar Buddha", r"manglawar|manglor|jahanabad")],
    "malam": [("Malam Jabba", r"malam")],
    "gabin": [("Gabin Jabba", r"gabin|gabeen")],
    "mahodand": [("Mahodand", r"mahodand"), ("Mahodand Lake Kalam", r"mahodand")],
    "thal": [("Thal mosque Kumrat", r"thal|kumrat")],
    "kumrat-waterfall": [("Kumrat waterfall", r"kumrat")],
    "jamia": [("Thal mosque Kumrat", r"thal|kumrat"), ("Kumrat wooden mosque", r"kumrat|thal")],
    "matiltan": [("Ushu bridge Matiltan", r"matiltan|ushu"), ("Matiltan", r"matiltan")],
    "jahaz": [("Jahaz Banda", r"jahaz")],
    "katora": [("Katora Lake", r"katora")],
    "kundol": [("Kundol Lake", r"kundol")],
}
ARTEFACT = re.compile(r"sculpture|relief|coin|statue|fragment|panel|frieze|gallery|exhibit|display|artefact|artifact|"
                      r"schist|head of|bodhisattva|reliquary|stele|stela|figurine|jewel|pottery|manuscript|inscription|"
                      r"in the museum|museum collection|showcase|vitrine|pedestal|capital|scene of|buddha statue", re.I)
last = [0.0]


def throttle():
    d = time.time() - last[0]
    if d < 0.55:
        time.sleep(0.55 - d)
    last[0] = time.time()


def get_json(params):
    key = hashlib.md5(json.dumps(params, sort_keys=True).encode()).hexdigest()
    f = CACHE / f"{key}.json"
    if f.exists():
        return json.loads(f.read_text(encoding="utf-8"))
    for i in range(4):
        throttle()
        try:
            r = httpx.get(API, params=params, headers=UA, timeout=40)
            if r.status_code == 403:
                print("403:", r.text[:500]); sys.exit(1)
            if r.status_code in (429, 503):
                time.sleep(min(int(r.headers.get("Retry-After", 10)), 60)); continue
            if r.status_code == 200:
                j = r.json()
                if "error" in j and j["error"].get("code") == "maxlag":
                    time.sleep(5); continue
                f.write_text(json.dumps(j), encoding="utf-8")
                return j
        except Exception as e:
            print("  err", e)
        time.sleep(3 * (i + 1))
    return {}


def search(q):
    j = get_json({"action": "query", "list": "search", "srnamespace": 6, "srsearch": q, "srlimit": 50, "format": "json", "maxlag": 5})
    return ["File:" + h["title"].split(":", 1)[1] for h in j.get("query", {}).get("search", [])]


def imageinfo(titles):
    res = {}
    for i in range(0, len(titles), 50):
        b = titles[i:i + 50]
        j = get_json({"action": "query", "titles": "|".join(b), "prop": "imageinfo",
                      "iiprop": "url|size|extmetadata|mime", "iiurlwidth": 1600,
                      "iiextmetadatafilter": "LicenseShortName|LicenseUrl|Artist|Credit|ImageDescription|DateTimeOriginal|GPSLatitude|GPSLongitude",
                      "format": "json", "maxlag": 5})
        q = j.get("query", {})
        norm = {n["from"]: n["to"] for n in q.get("normalized", [])}
        inv = {}
        for p in q.get("pages", {}).values():
            if "imageinfo" in p:
                inv[p["title"]] = p["imageinfo"][0]
        for t in b:
            res[t] = inv.get(norm.get(t, t))
    return res


def strip(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


def lic_ok(s):
    s = (s or "").strip()
    if re.search(r"\b(NC|ND)\b|fair use|non-?commercial", s, re.I):
        return False
    return bool(re.match(r"^(CC0|CC[- ]BY(-SA)?\b|CC[- ]Zero|Public domain|PD\b)", s, re.I))


def hav(a, b, c, d):
    p = math.pi / 180
    x = math.sin((c - a) * p / 2) ** 2 + math.cos(a * p) * math.cos(c * p) * math.sin((d - b) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(x))


def queries(e):
    name = re.sub(r"\(.*?\)", "", e["name"]).strip()
    paren = re.findall(r"\((.*?)\)", e["name"])
    key = re.sub(r"\b(stupa|lake|waterfall|falls|meadows?|bridge|mosque|fort|castle|palace|ski resort|i|ii|iii|rock|carvings?|buddha|sar|over|the|at)\b", "", name, flags=re.I)
    key = re.sub(r"[^\w ]", " ", key).split()
    kw = key[0].lower() if key else name.split()[0].lower()
    qs = [(name, re.escape(kw))]
    for p in paren:
        if re.search(r"relief|site|wooden", p):
            continue
        w = p.strip()
        if len(w) > 3:
            qs.append((w, re.escape(w.split()[0].lower())))
    for k, v in VARIANTS.items():
        if k in e["slug"]:
            qs += v
    return qs


def role_of(e, title, desc):
    if e["kind"] in LANDSCAPE:
        return "landscape"
    if e["kind"] == "rock_carving":
        return "structure"
    txt = title + " " + desc
    if ARTEFACT.search(title) or (ARTEFACT.search(desc) and not re.search(r"stupa|fort|castle|palace|mosque|ruin|view|bridge|exterior|building", txt, re.I)):
        return "artefact"
    return "structure"


def sheet(folder, items):
    n = len(items)
    if not n:
        return
    cols = 5
    w = 240
    h = 200
    rows = (n + cols - 1) // cols
    S = Image.new("RGB", (cols * w, rows * h), "white")
    d = ImageDraw.Draw(S)
    try:
        fnt = ImageFont.truetype("arialbd.ttf", 22)
    except Exception:
        fnt = ImageFont.load_default()
    for i, it in enumerate(items):
        x, y = (i % cols) * w + 3, (i // cols) * h + 3
        try:
            im = Image.open(folder / it["file"]).convert("RGB")
            im.thumbnail((w - 6, h - 6))
            S.paste(im, (x, y))
        except Exception:
            pass
        d.rectangle([x, y, x + 62, y + 26], fill="black")
        d.text((x + 4, y + 1), f"{i+1:02d}{it['role'][0]}", fill="yellow", font=fnt)
    S.save(folder / "_sheet.jpg", quality=80)


def main():
    L = json.load(open(GAZ, encoding="utf-8"))
    only = set(sys.argv[1:])
    targets = [e for e in L if e["kind"] in KINDS and (not only or e["slug"] in only)]
    CACHE.mkdir(parents=True, exist_ok=True)
    summary = {}
    for e in targets:
        slug = e["slug"]
        mf = OUT / slug / "manifest.json"
        if mf.exists() and not only:
            ph = json.loads(mf.read_text(encoding="utf-8"))["photos"]
            summary[slug] = (e["kind"], len(ph), sum(k["role"] == "artefact" for k in ph))
            print(slug, "skip (done)", flush=True)
            continue
        print(slug, flush=True)
        cands = {}
        for p in e.get("photos") or []:
            m = re.search(r"/wiki/(File:.+)$", p["file_page"])
            if m:
                cands[unquote(m.group(1)).replace("_", " ")] = "seed"
        for q, rx in queries(e):
            for t in search(q):
                if t not in cands and re.search(rx, t, re.I):
                    cands[t] = "search"
        titles = list(cands)
        info = imageinfo(titles)
        kept = []
        for t in titles:
            ii = info.get(t)
            if not ii or not ii.get("mime", "").startswith("image/") or "svg" in ii["mime"] or "tiff" in ii["mime"]:
                continue
            md = ii.get("extmetadata") or {}
            md = md if isinstance(md, dict) else {}
            g = lambda k: md.get(k, {}).get("value", "")
            lic = g("LicenseShortName")
            if not lic_ok(lic) or ii.get("width", 0) < 600:
                continue
            desc = strip(g("ImageDescription"))
            lat = lon = dist = None
            try:
                lat, lon = float(g("GPSLatitude")), float(g("GPSLongitude"))
                dist = round(hav(e["lat"], e["lon"], lat, lon), 2)
            except Exception:
                pass
            artist = strip(g("Artist")) or strip(g("Credit")) or "Unknown"
            kept.append(dict(title=t, source=cands[t], url=ii.get("thumburl", ii["url"]), page=ii["descriptionurl"], licence=lic,
                             licence_url=g("LicenseUrl"), artist=artist,
                             attribution=f"Photo: {artist}, {lic}, via Wikimedia Commons",
                             gps=[lat, lon] if lat is not None else None, dist_km=dist, gps_flag=bool(dist and dist > 2),
                             orig_width=ii["width"], orig_height=ii["height"], role=role_of(e, t, desc), description=desc[:300]))
        kept = [k for k in kept if not (k["dist_km"] and k["dist_km"] > 50)]
        kept.sort(key=lambda k: (k["source"] != "seed", k["role"] == "artefact", k["gps_flag"]))
        kept = kept[:MAXC]
        folder = OUT / slug
        folder.mkdir(parents=True, exist_ok=True)
        for old in folder.glob("*.jpg"):
            old.unlink()
        final = []
        for k in kept:
            fn = f"{len(final)+1:02d}.jpg"
            try:
                throttle()
                r = httpx.get(k["url"], headers=UA, timeout=60, follow_redirects=True)
                if r.status_code == 429:
                    time.sleep(8)
                    r = httpx.get(k["url"], headers=UA, timeout=60, follow_redirects=True)
                r.raise_for_status()
                (folder / fn).write_bytes(r.content)
                im = Image.open(folder / fn)
                k["width"], k["height"] = im.size
                im.convert("RGB").save(folder / fn, quality=90)
            except Exception as ex:
                print("  dl fail", k["title"], ex)
                continue
            k["file"] = fn
            k["index"] = len(final) + 1
            final.append(k)
        (folder / "manifest.json").write_text(json.dumps(dict(slug=slug, name=e["name"], kind=e["kind"], photos=final), indent=1, ensure_ascii=False), encoding="utf-8")
        sheet(folder, final)
        summary[slug] = (e["kind"], len(final), sum(k["role"] == "artefact" for k in final))
        print("  kept", len(final), "of", len(titles), flush=True)
    (OUT / "_summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
