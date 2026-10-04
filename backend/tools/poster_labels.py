"""Overlay cartographic labels, title cartouche, compass rose and attribution on a render.

python backend/tools/poster_labels.py render.png labels.json --title "Swat Valley" \
    --subtitle "Kalam" --out poster.png [--heading 15]
Labels JSON: {"image":[w,h], "labels":[{name,kind,px:[x,y],visible,dem_elevation_m,
listed_elevation_m,distance_m}]} (a bare list also accepted). Optional top-level
heading/yaw. Missing kind is looked up in the gazetteer by name/slug.
"""
import argparse, json, math, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from shortname import short_name
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
FD = Path("C:/Windows/Fonts")
SS = 2
HERITAGE = {"fort_ruin", "stupa", "archaeological_site", "palace", "museum", "mosque", "rock_carving"}
ELEV_KINDS = {"peak", "lake", "pass"}
SKIP_KINDS = {"river_feature", "forest"}
CREAM = (243, 234, 214, 255)


def font(names, size):
    for n in names:
        for d in (ROOT / "web" / "fonts", FD):
            p = d / n
            if p.exists():
                return ImageFont.truetype(str(p), max(1, int(round(size))))
    return ImageFont.load_default()


def elev(l):
    e = l.get("label_elevation_m")
    if e is None:
        e = l.get("dem_elevation_m")
    if e is None:
        e = l.get("listed_elevation_m")
    return None if e is None else int(round(e))


MAJOR_LAKES = ("mahodand", "mahundand", "kundol", "spin khwar", "izmis", "kharkhari")


HERITAGE = {"stupa", "monastery", "rock_carving", "fort_ruin", "palace", "mosque", "museum", "archaeological_site", "ski_resort"}


def prio(l):
    k, e = l["kind"], elev(l) or 0
    n = l["name"].casefold()
    if k == "town" or (k == "lake" and any(m in n for m in MAJOR_LAKES)): return 1
    if k in HERITAGE: return 1.5      # after towns, before villages / peaks / minor lakes
    if k == "village": return 1.7
    if k == "peak" and e >= 5500: return 2
    if k == "lake": return 3
    return 4


def load_kinds():
    try:
        g = json.load(open(ROOT / "data/research/swat_gazetteer.json", encoding="utf-8"))
    except Exception:
        return {}
    m = {}
    for x in g:
        m[x["name"].casefold()] = x.get("kind")
        m[x.get("slug", "").casefold()] = x.get("kind")
    return m


def select(labels, H, maxn, must=()):
    kinds = load_kinds()
    for l in labels:
        if not l.get("kind"):
            n = l["name"].casefold()
            l["kind"] = kinds.get(n) or kinds.get(n.replace(" ", "-")) or "other"
    W_ = IMG_W[0]
    def edge_ok(l):
        x, y = l["px"]
        return 0.04 * W_ <= x <= 0.96 * W_ and 0.0 <= y <= 0.96 * H
    for l in labels:
        l["tier"] = prio(l)
    mset = {m.strip().casefold() for m in must if m.strip()}
    for l in labels:
        l["must"] = short_name(l["name"]).casefold() in mset
    cand = [l for l in labels if l["must"] or (edge_ok(l) and (l.get("visible") or l["tier"] == 1))]
    cand.sort(key=lambda l: (not l["must"], l["tier"], l.get("distance_m", 0)))   # --must labels are guaranteed first
    out = []
    for l in cand:
        if any(abs(o["px"][0] - l["px"][0]) < 8 and abs(o["px"][1] - l["px"][1]) < 8 for o in out):
            continue
        out.append(l)
    return out[:maxn]


IMG_W = [1536]


def overlap(a, b, pad):
    return not (a[2] + pad < b[0] or b[2] + pad < a[0] or a[3] + pad < b[1] or b[3] + pad < a[1])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image"); ap.add_argument("labels")
    ap.add_argument("--title", default=""); ap.add_argument("--subtitle", default="")
    ap.add_argument("--out", required=True)
    ap.add_argument("--heading", type=float, default=None)
    ap.add_argument("--max-labels", type=int, default=14)
    ap.add_argument("--must", default="", help='comma-separated short names that are always labelled, e.g. "Mingora,Elum Ghar"')
    ap.add_argument("--max-dist-km", type=float, default=0, help="drop labels farther than this from the camera")
    a = ap.parse_args()

    data = json.load(open(a.labels, encoding="utf-8"))
    labels = data["labels"] if isinstance(data, dict) else data
    img = Image.open(a.image).convert("RGB")
    W0, H0 = img.size
    iw, ih = (data.get("image") if isinstance(data, dict) and data.get("image") else (1536, 1024))
    sx, sy = W0 / iw, H0 / ih
    heading = a.heading
    if heading is None and isinstance(data, dict):
        for k in ("heading", "yaw", "heading_deg", "yaw_deg"):
            if data.get(k) is not None:
                heading = float(data[k]); break
    heading = heading or 0.0
    exag = float(data.get("exag", 1.6)) if isinstance(data, dict) else 1.6

    u = W0 / 1536.0 * SS
    W, H = W0 * SS, H0 * SS
    base = img.resize((W, H), Image.LANCZOS).convert("RGBA")
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d, sd = ImageDraw.Draw(ov), ImageDraw.Draw(shadow)

    F1 = font(["segoeuisb.ttf", "segoeui.ttf"], 13 * u)
    F2 = font(["segoeui.ttf"], 11 * u)
    FT = font(["georgia.ttf", "constan.ttf"], 46 * u)
    FTs = font(["georgia.ttf", "constan.ttf"], 36 * u)
    FS = font(["georgiai.ttf", "constani.ttf"], 24 * u)
    FA = font(["segoeui.ttf"], 10 * u)

    R = 0.09 * H / 2
    ccx, ccy = W - R * 2.0, H - R * 2.0
    reserved = [(0, 0, 520 * u, 125 * u), (ccx - R * 1.5, ccy - R * 1.5, W, H), (0, H - 24 * u, W, H)]

    items = []
    IMG_W[0] = iw
    if a.max_dist_km: labels = [l for l in labels if l.get("distance_m", 0) <= a.max_dist_km * 1000]
    for l in select(labels, ih, a.max_labels, a.must.split(",")):
        lines = [short_name(l["name"])]
        e = elev(l)
        if l["kind"] in ELEV_KINDS and e is not None:
            lines.append(f"{e:,} m")
        w1 = d.textlength(lines[0], font=F1)
        w2 = d.textlength(lines[1], font=F2) if len(lines) > 1 else 0
        cw = max(w1, w2) + 18 * u
        ch = 10 * u + 16 * u + (14 * u if len(lines) > 1 else 0)
        items.append(dict(l=l, x=l["px"][0] * sx * SS, y=l["px"][1] * sy * SS, lines=lines, cw=cw, ch=ch))

    dots = [(it["x"], it["y"]) for it in items]
    placed = []
    for it in items:
        x, y, cw, ch = it["x"], it["y"], it["cw"], it["ch"]
        cands = []
        for dist in (38, 56, 80):
            D = dist * u
            cands += [(0, -D), (-cw * .45, -D), (cw * .45, -D), (0, D), (-cw * .7 - 10 * u, -D * .5),
                      (cw * .7 + 10 * u, -D * .5), (-cw * .5, D), (cw * .5, D)]
        for ox, oy in cands:
            cx, cy = x + ox, y + oy
            box = (cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2)
            if box[0] < 8 * u or box[2] > W - 8 * u or box[1] < 8 * u or box[3] > H - 8 * u: continue
            if any(overlap(box, r, 4 * u) for r in reserved): continue
            if any(overlap(box, p["box"], 6 * u) for p in placed): continue
            if any(box[0] - 6 * u < dx < box[2] + 6 * u and box[1] - 6 * u < dy < box[3] + 6 * u for dx, dy in dots):
                continue
            it["box"] = box; placed.append(it); break
        else:
            if it["l"]["tier"] < 1.6 or it["l"].get("must"):   # never drop towns / heritage / --must: wider offsets, relaxed dot clearance
                done = False
                for dist in (100, 130, 165, 200):
                    D = dist * u
                    for ox, oy in [(0, -D), (0, D), (-D, 0), (D, 0), (-D, -D * .6), (D, -D * .6), (-D, D * .6), (D, D * .6)]:
                        cx, cy = x + ox, y + oy
                        box = (cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2)
                        if box[0] < 8 * u or box[2] > W - 8 * u or box[1] < 8 * u or box[3] > H - 8 * u: continue
                        if any(overlap(box, r, 4 * u) for r in reserved): continue
                        if any(overlap(box, p["box"], 4 * u) for p in placed): continue
                        it["box"] = box; placed.append(it); done = True; break
                    if done: break

    print("placed:", [it["l"]["name"] for it in placed])
    print("dropped:", [it["l"]["name"] for it in items if "box" not in it])
    r = 4 * u
    def dashed(draw, p0, p1, fill, width, dash, gap):
        L_ = math.hypot(p1[0] - p0[0], p1[1] - p0[1]) or 1.0
        ux, uy = (p1[0] - p0[0]) / L_, (p1[1] - p0[1]) / L_
        t = 0.0
        while t < L_:
            t2 = min(t + dash, L_)
            draw.line([(p0[0] + ux * t, p0[1] + uy * t), (p0[0] + ux * t2, p0[1] + uy * t2)], fill=fill, width=width)
            t += dash + gap

    for it in placed:
        b = it["box"]; x, y = it["x"], it["y"]
        hidden = it["l"].get("visible") is False      # behind a ridge from this camera: drawn honestly as hidden
        ex = min(max(x, b[0] + r), b[2] - r)
        ey = b[3] if y > b[3] else (b[1] if y < b[1] else (b[1] + b[3]) / 2)
        if b[1] <= y <= b[3]:
            ex = b[0] if x < b[0] else b[2]
        if hidden:
            dashed(d, (ex, ey), (x, y), (240, 235, 225, 200), max(1, int(1.2 * u)), 5 * u, 4 * u)
            sd.rounded_rectangle([b[0], b[1] + 2 * u, b[2], b[3] + 2 * u], r, fill=(0, 0, 0, 100))
            d.rounded_rectangle(b, r, fill=(21, 18, 15, 157), outline=(233, 226, 211, 70), width=max(1, int(u)))
        else:
            sd.line([(ex, ey), (x, y)], fill=(0, 0, 0, 150), width=int(3 * u))
            d.line([(ex, ey), (x, y)], fill=(240, 235, 225, 235), width=max(1, int(1.2 * u)))
            sd.rounded_rectangle([b[0], b[1] + 2 * u, b[2], b[3] + 2 * u], r, fill=(0, 0, 0, 150))
            d.rounded_rectangle(b, r, fill=(21, 18, 15, 224), outline=(233, 226, 211, 90), width=max(1, int(u)))
        cx = (b[0] + b[2]) / 2
        d.text((cx, b[1] + 4 * u), it["lines"][0], font=F1, fill=(255, 255, 255, 215 if hidden else 255), anchor="ma")
        if len(it["lines"]) > 1:
            d.text((cx, b[1] + 21 * u), it["lines"][1], font=F2, fill=(217, 210, 196, 255), anchor="ma")
        dr = 3.6 * u
        if hidden:
            d.ellipse([x - dr, y - dr, x + dr, y + dr], outline=(255, 255, 255, 235), width=max(1, int(1.4 * u)))
        else:
            d.ellipse([x - dr - u, y - dr - u, x + dr + u, y + dr + u], fill=(20, 17, 14, 230))
            d.ellipse([x - dr + .6 * u, y - dr + .6 * u, x + dr - .6 * u, y + dr - .6 * u], fill=(255, 255, 255, 255))

    # ---- title cartouche
    tx, ty = 38 * u, 28 * u
    title = a.title.upper()

    def title_draw(draw, fill, measure=False):
        x0 = tx
        for w in title.split(" "):
            for j, c in enumerate(w):
                f = FT if j == 0 else FTs
                if not measure:
                    draw.text((x0, ty + 46 * u), c, font=f, fill=fill, anchor="ls")
                x0 += d.textlength(c, font=f) + 6 * u
            x0 += 14 * u
        return x0 - 14 * u - 6 * u

    tw = title_draw(d, None, True) - tx
    sw = d.textlength(a.subtitle, font=FS) if a.subtitle else 0
    sy_ = ty + 46 * u + 28 * u
    rule_y = sy_ - 9 * u
    gap = 14 * u
    cw_ = max(tw, sw + 2 * (gap + 50 * u))
    sxs = tx + cw_ / 2 - sw / 2
    rules = [(tx, sxs - gap), (sxs + sw + gap, tx + cw_)] if a.subtitle else []

    def sub_draw(draw, fill, lw):
        if a.subtitle:
            draw.text((sxs, sy_), a.subtitle, font=FS, fill=fill, anchor="ls")
            for s0, s1 in rules:
                if s1 > s0:
                    draw.line([(s0, rule_y), (s1, rule_y)], fill=fill, width=lw)

    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
    title_draw(gd, (0, 0, 0, 255)); sub_draw(gd, (0, 0, 0, 255), int(3 * u))
    glow = glow.filter(ImageFilter.GaussianBlur(5 * u))
    glow.putalpha(glow.getchannel("A").point(lambda v: min(255, int(v * 1.8))))
    base = Image.alpha_composite(base, glow)
    title_draw(d, CREAM); sub_draw(d, (243, 234, 214, 215), max(1, int(1.1 * u)))

    # ---- compass rose (north follows camera heading)
    def P(rad, deg):
        t = math.radians(deg - heading)
        return (ccx + rad * math.sin(t), ccy - rad * math.cos(t))

    rose = Image.new("RGBA", (W, H), (0, 0, 0, 0)); rd = ImageDraw.Draw(rose)
    rd.ellipse([ccx - R * .82, ccy - R * .82, ccx + R * .82, ccy + R * .82], outline=CREAM, width=max(1, int(1.2 * u)))
    rd.ellipse([ccx - R * .74, ccy - R * .74, ccx + R * .74, ccy + R * .74], outline=(243, 234, 214, 150), width=max(1, int(.8 * u)))
    c = (ccx, ccy)
    for k in (1, 3, 5, 7, 0, 2, 4, 6):  # short points first, cardinals on top
        deg = k * 45
        long = k % 2 == 0
        tip = P(R * (.8 if long else .5), deg)
        wr = R * (.17 if long else .13)
        a1, a2 = P(wr, deg - 45), P(wr, deg + 45)
        rd.polygon([tip, a1, c], fill=(255, 250, 235, 255) if k == 0 else CREAM)
        rd.polygon([tip, a2, c], fill=(120, 105, 85, 255))
        rd.line([tip, a1, c, a2, tip], fill=(30, 24, 18, 255), width=max(1, int(.8 * u)))
    FL = font(["georgiab.ttf", "georgia.ttf"], 14 * u)
    for txt, deg in (("N", 0), ("E", 90), ("S", 180), ("W", 270)):
        px_, py_ = P(R * 1.14, deg)
        for ox in (-1, 0, 1):
            for oy in (-1, 0, 1):
                rd.text((px_ + ox * u, py_ + oy * u), txt, font=FL, fill=(25, 20, 15, 255), anchor="mm")
        rd.text((px_, py_), txt, font=FL, fill=CREAM, anchor="mm")
    rg = rose.filter(ImageFilter.GaussianBlur(3 * u))
    rg = Image.merge("RGBA", (Image.new("L", (W, H), 0),) * 3 + (rg.getchannel("A").point(lambda v: int(v * .8)),))
    base = Image.alpha_composite(base, rg)
    base = Image.alpha_composite(base, rose)

    # ---- attribution
    attrib = ("Terrain © Copernicus DEM GLO-30 · Land cover ESA WorldCover · Imagery s2cloudless 2016 by EOX "
              "(CC BY 4.0) · © OpenStreetMap contributors · Heights exaggerated ×" + f"{exag:g}")
    ax, ay = 14 * u, H - 10 * u
    t = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(t).text((ax, ay), attrib, font=FA, fill=(0, 0, 0, 255), anchor="ls")
    t = t.filter(ImageFilter.GaussianBlur(2 * u))
    t.putalpha(t.getchannel("A").point(lambda v: min(255, v * 2)))
    base = Image.alpha_composite(base, t)
    d.text((ax, ay), attrib, font=FA, fill=(240, 234, 220, 235), anchor="ls")

    shadow = shadow.filter(ImageFilter.GaussianBlur(3 * u))
    base = Image.alpha_composite(base, shadow)
    base = Image.alpha_composite(base, ov)
    base.convert("RGB").resize((W0, H0), Image.LANCZOS).save(a.out)
    print(f"wrote {a.out}; placed {len(placed)}, dropped {[it['l']['name'] for it in items if 'box' not in it]}; heading {heading}")


if __name__ == "__main__":
    main()
