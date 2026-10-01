"""Build a co-registered raster bundle (DEM, landcover, satellite, OSM) for a bbox on one UTM grid.

  python backend/tools/geo_bundle.py swat --bbox 72.10 35.30 72.90 35.85 --res 30

Output: data/bundles/<name>/{height.tif,height16.png,landcover.png,landcover_hi.png,
satellite.jpg,osm.json,meta.json,preview.png}.  All layers share one north-up UTM grid.
"""
import argparse
import json
import math
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
import numpy as np
import rasterio
from PIL import Image, ImageDraw
from pyproj import CRS, Transformer
from rasterio.crs import CRS as RCRS
from rasterio.enums import Resampling
from rasterio.transform import Affine, from_bounds
from rasterio.warp import reproject

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "data" / "cache"
UA = {"User-Agent": "TinyAtlas/0.1 (open-source hobby project)"}
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]

DEM_URL = ("https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM/"
           "Copernicus_DSM_COG_10_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM.tif")
WC_URL = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{t}_Map.tif"
EOX_URL = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg"  # unsuffixed id = 2016, CC BY 4.0
EOX_Z = 13


# ---------------------------------------------------------------- grid
def make_grid(bbox, res):
    w, s, e, n = bbox
    lonc = (w + e) / 2
    zone = int((lonc + 180) // 6) + 1
    epsg = (32600 if (s + n) / 2 >= 0 else 32700) + zone
    tr = Transformer.from_crs(4326, epsg, always_xy=True)
    xs, ys = [], []
    for t in np.linspace(0, 1, 21):  # sample edges so curved edges are covered
        for lon, lat in ((w + t * (e - w), s), (w + t * (e - w), n), (w, s + t * (n - s)), (e, s + t * (n - s))):
            x, y = tr.transform(lon, lat)
            xs.append(x), ys.append(y)
    x0, x1 = math.floor(min(xs) / res) * res, math.ceil(max(xs) / res) * res
    y0, y1 = math.floor(min(ys) / res) * res, math.ceil(max(ys) / res) * res
    W, H = int(round((x1 - x0) / res)), int(round((y1 - y0) / res))
    return epsg, Affine(res, 0, x0, 0, -res, y1), W, H


# ---------------------------------------------------------------- DEM
def dem_tiles(bbox):
    w, s, e, n = bbox
    for la in range(math.floor(s), math.ceil(n)):
        for lo in range(math.floor(w), math.ceil(e)):
            yield DEM_URL.format(ns="N" if la >= 0 else "S", lat=abs(la), ew="E" if lo >= 0 else "W", lon=abs(lo))


def get_dem(bbox, crs, tf, W, H):
    out = np.full((H, W), np.nan, np.float32)
    used = []
    for url in dem_tiles(bbox):
        tmp = np.full((H, W), np.nan, np.float32)
        try:
            with rasterio.Env(GDAL_HTTP_USERAGENT="TinyAtlas/0.1", GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
                              CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", GDAL_HTTP_MAX_RETRY="4"):
                with rasterio.open("/vsicurl/" + url) as src:
                    reproject(rasterio.band(src, 1), tmp, dst_transform=tf, dst_crs=crs, src_nodata=src.nodata,
                              dst_nodata=np.nan, resampling=Resampling.bilinear)
            used.append(url)
        except rasterio.errors.RasterioIOError as ex:
            print("  DEM tile skipped (missing?):", url.rsplit("/", 1)[-1], str(ex)[:80])
            continue
        m = np.isnan(out) & ~np.isnan(tmp)
        out[m] = tmp[m]
    if not used:
        raise SystemExit("no DEM tiles found for bbox")
    if np.isnan(out).any():  # ocean / gaps -> 0 m
        out = np.nan_to_num(out, nan=0.0)
    return out, used


# ---------------------------------------------------------------- landcover
def get_landcover(bbox, crs, tf, W, H, res):
    w, s, e, n = bbox
    hi_tf = tf * Affine.scale(0.5, 0.5)
    lo = np.zeros((H, W), np.uint8)
    hi = np.zeros((H * 2, W * 2), np.uint8)
    used = []
    for la in range(math.floor(s / 3) * 3, math.ceil(n), 3):
        for lo_ in range(math.floor(w / 3) * 3, math.ceil(e), 3):
            t = f"{'N' if la >= 0 else 'S'}{abs(la):02d}{'E' if lo_ >= 0 else 'W'}{abs(lo_):03d}"
            url = WC_URL.format(t=t)
            try:
                with rasterio.Env(GDAL_HTTP_USERAGENT="TinyAtlas/0.1", GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
                                  CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", GDAL_HTTP_MAX_RETRY="4",
                                  VSI_CACHE="TRUE", VSI_CACHE_SIZE="268435456"):
                    with rasterio.open("/vsicurl/" + url) as src:
                        for dst, dtf, shape in ((lo, tf, (H, W)), (hi, hi_tf, (H * 2, W * 2))):
                            tmp = np.zeros(shape, np.uint8)
                            reproject(rasterio.band(src, 1), tmp, dst_transform=dtf, dst_crs=crs, src_nodata=0,
                                      dst_nodata=0, resampling=Resampling.mode)
                            m = (dst == 0) & (tmp != 0)
                            dst[m] = tmp[m]
                used.append(url)
            except rasterio.errors.RasterioIOError as ex:
                print("  WorldCover tile skipped:", t, str(ex)[:80])
    return lo, hi, used


# ---------------------------------------------------------------- satellite
def merc(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def fetch_tile(args):
    z, x, y = args
    p = CACHE / "eox" / str(z) / str(x) / f"{y}.jpg"
    if p.exists() and p.stat().st_size > 0:
        return args, p
    p.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(4):
        try:
            r = httpx.get(EOX_URL.format(z=z, x=x, y=y), headers=UA, timeout=30)
            if r.status_code == 200:
                p.write_bytes(r.content)
                return args, p
        except httpx.HTTPError:
            pass
        time.sleep(1 + attempt)
    return args, None


def get_satellite(bbox, crs, tf, W, H, res, sat_res=10.0):
    w, s, e, n = bbox
    # tiles covering the bbox with a margin (UTM grid corners can poke outside the lon/lat bbox)
    tr = Transformer.from_crs(crs, 4326, always_xy=True)
    corners = [tr.transform(*(tf * (c, r))) for c in (0, W) for r in (0, H)]
    lons = [c[0] for c in corners] + [w, e]
    lats = [c[1] for c in corners] + [s, n]
    x0, y1 = merc(min(lons), min(lats), EOX_Z)
    x1, y0 = merc(max(lons), max(lats), EOX_Z)
    tx0, tx1, ty0, ty1 = int(x0), int(x1), int(y0), int(y1)
    jobs = [(EOX_Z, x, y) for x in range(tx0, tx1 + 1) for y in range(ty0, ty1 + 1)]
    print(f"  satellite: {len(jobs)} tiles")
    mosaic = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256, 3), np.uint8)
    missing = 0
    with ThreadPoolExecutor(8) as ex:
        for (z, x, y), p in ex.map(fetch_tile, jobs):
            if p is None:
                missing += 1
                continue
            im = np.asarray(Image.open(p).convert("RGB"))
            mosaic[(y - ty0) * 256:(y - ty0 + 1) * 256, (x - tx0) * 256:(x - tx0 + 1) * 256] = im
    if missing:
        print(f"  WARNING: {missing} satellite tiles missing")
    R = 20037508.342789244
    ts = 2 * R / 2 ** EOX_Z
    src_tf = Affine(ts / 256, 0, -R + tx0 * ts, 0, -ts / 256, R - ty0 * ts)
    f = res / sat_res
    sw, sh = int(round(W * f)), int(round(H * f))
    dst_tf = tf * Affine.scale(1 / f, 1 / f)
    out = np.zeros((3, sh, sw), np.uint8)
    for b in range(3):
        reproject(mosaic[:, :, b], out[b], src_transform=src_tf, src_crs=RCRS.from_epsg(3857),
                  dst_transform=dst_tf, dst_crs=crs, resampling=Resampling.bilinear)
    return np.moveaxis(out, 0, -1)


# ---------------------------------------------------------------- OSM
def _bb(b):
    w, s, e, n = b
    return f"{s},{w},{n},{e}"


def overpass(query, tag):
    p = CACHE / "osm" / f"{tag}.json"
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    last = None
    for attempt in range(3):
        for url in OVERPASS:
            try:
                r = httpx.post(url, data={"data": query}, headers=UA, timeout=240)
                r.raise_for_status()
                d = r.json()
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(json.dumps(d), encoding="utf-8")
                return d
            except Exception as ex:
                last = ex
        time.sleep(5)
    print("  Overpass failed:", tag, last)
    return {"elements": []}


HWY = "motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|track|path|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|living_street"


def stitch_rings(ways, rid=None):
    """Join OSM outer member ways (which split a ring across several ways) into closed rings."""
    ways = [list(w) for w in ways]
    rings = []
    while ways:
        cur = ways.pop(0)
        grew = True
        while cur[0] != cur[-1] and grew:
            grew = False
            for i, w in enumerate(ways):
                if w[0] == cur[-1]: cur += w[1:]
                elif w[-1] == cur[-1]: cur += w[::-1][1:]
                elif w[-1] == cur[0]: cur = w[:-1] + cur
                elif w[0] == cur[0]: cur = w[::-1][:-1] + cur
                else: continue
                ways.pop(i); grew = True; break
        if cur[0] == cur[-1] and len(cur) >= 4:
            rings.append(cur)
        else:
            print(f"  WARNING: unclosable outer ring dropped (relation {rid}, {len(cur)} pts)")
    return rings


def get_osm(bbox, crs, tf, name):
    b = _bb(bbox)
    qs = {
        "roads": f'[out:json][timeout:180];way["highway"~"^({HWY})$"]({b});out geom;',
        "water": f'[out:json][timeout:180];(way["waterway"~"^(river|stream)$"]({b});way["natural"="water"]({b});'
                 f'rel["natural"="water"]({b}););out geom;',
        "points": f'[out:json][timeout:180];(nwr["natural"~"^(peak|volcano|saddle)$"]({b});nwr["mountain_pass"="yes"]({b});'
                  f'nwr["place"~"^(town|village|hamlet)$"]({b});nwr["tourism"]["name"]({b});nwr["historic"]["name"]({b});'
                  f'nwr["amenity"="place_of_worship"]["name"]({b}););out center tags;',
    }
    key = f"{bbox[0]}_{bbox[1]}_{bbox[2]}_{bbox[3]}"
    raw = {k: overpass(q, f"{key}_{k}") for k, q in qs.items()}
    tr = Transformer.from_crs(4326, crs, always_xy=True)
    inv = ~tf

    def px(lon, lat):
        x, y = tr.transform(lon, lat)
        c, r = inv * (x, y)
        return [round(lon, 6), round(lat, 6), round(c, 2), round(r, 2)]

    def line(el):
        return [px(g["lon"], g["lat"]) for g in el.get("geometry", [])]

    out = {"roads": [], "waterways": [], "water": [], "peaks": [], "passes": [], "places": [], "pois": [], "bridges": []}
    for el in raw["roads"]["elements"]:
        t = el.get("tags", {})
        out["roads"].append({"id": el["id"], "highway": t.get("highway"), "name": t.get("name"),
                             "bridge": t.get("bridge"), "pts": line(el)})
    for el in raw["water"]["elements"]:
        t = el.get("tags", {})
        if el["type"] == "way" and "waterway" in t:
            out["waterways"].append({"id": el["id"], "waterway": t["waterway"], "name": t.get("name"), "pts": line(el)})
        elif el["type"] == "way":
            if len(el.get("geometry", [])) >= 4:
                out["water"].append({"id": el["id"], "name": t.get("name"), "pts": line(el)})
        elif el["type"] == "relation":
            ways = [[(g["lon"], g["lat"]) for g in m["geometry"]] for m in el.get("members", [])
                    if m.get("role") == "outer" and m.get("geometry") and len(m["geometry"]) >= 2]
            for ring in stitch_rings(ways, el["id"]):
                out["water"].append({"id": el["id"], "name": t.get("name"), "pts": [px(lo, la) for lo, la in ring]})
    for el in raw["points"]["elements"]:
        t = el.get("tags", {})
        lat, lon = el.get("lat", el.get("center", {}).get("lat")), el.get("lon", el.get("center", {}).get("lon"))
        if lat is None:
            continue
        rec = {"id": el["id"], "name": t.get("name:en") or t.get("name"), "name_local": t.get("name"),
               "pt": px(lon, lat)}
        nat = t.get("natural")
        if nat in ("peak", "volcano", "saddle"):
            try:
                rec["ele"] = float(str(t.get("ele", "")).replace("m", "").strip())
            except ValueError:
                rec["ele"] = None
            rec["kind"] = nat
            out["peaks"].append(rec)
        elif t.get("mountain_pass") == "yes":
            rec["ele"] = t.get("ele")
            out["passes"].append(rec)
        elif t.get("place") in ("town", "village", "hamlet"):
            rec["kind"] = t["place"]
            out["places"].append(rec)
        elif rec["name"]:
            rec["kind"] = t.get("tourism") or t.get("historic") or t.get("amenity")
            out["pois"].append(rec)
    # bridges: derived from the highway ways tagged bridge=* (a separate Overpass query timed out repeatedly)
    out["bridges"] = [r for r in out["roads"] if r.get("bridge") and r["bridge"] != "no"]
    return out


# ---------------------------------------------------------------- preview
def hillshade(h, res, az=315, alt=45):
    gy, gx = np.gradient(h, res)
    slope = np.pi / 2 - np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    a, z = np.radians(360 - az + 90), np.radians(alt)
    hs = np.sin(z) * np.sin(slope) + np.cos(z) * np.cos(slope) * np.cos(a - aspect)
    return np.clip(hs, 0, 1)


def make_preview(path, sat, height, res, osm, W, H):
    pw = 1200
    ph = int(round(pw * H / W))
    sat_im = Image.fromarray(sat).resize((pw, ph), Image.LANCZOS)
    hs = hillshade(height, res)
    hs_im = np.asarray(Image.fromarray((hs * 255).astype(np.uint8)).resize((pw, ph), Image.BILINEAR)) / 255.0
    arr = np.asarray(sat_im).astype(np.float32) * (0.45 + 0.75 * hs_im[..., None])
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    k = pw / W

    def P(pts):
        return [(p[2] * k, p[3] * k) for p in pts]

    for r in osm["roads"]:
        if len(r["pts"]) > 1:
            d.line(P(r["pts"]), fill=(255, 40, 40), width=1)
    for r in osm["waterways"]:
        if len(r["pts"]) > 1:
            d.line(P(r["pts"]), fill=(40, 120, 255), width=2 if r["waterway"] == "river" else 1)
    for p in osm["water"]:
        d.line(P(p["pts"]), fill=(0, 200, 255), width=1)
    for p in sorted([p for p in osm["peaks"] if p.get("ele")], key=lambda p: -p["ele"])[:40]:
        x, y = p["pt"][2] * k, p["pt"][3] * k
        d.ellipse((x - 3, y - 3, x + 3, y + 3), fill=(255, 255, 0), outline=(0, 0, 0))
        if p.get("name"):
            d.text((x + 5, y - 5), p["name"], fill=(255, 255, 255))
    im.save(path)


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("name")
    ap.add_argument("--bbox", nargs=4, type=float, required=True, metavar=("W", "S", "E", "N"))
    ap.add_argument("--res", type=float, default=30)
    ap.add_argument("--sat-res", type=float, default=10, help="satellite m/px (default 10)")
    ap.add_argument("--no-osm", action="store_true", help="skip OSM (empty osm.json)")
    ap.add_argument("--osm-only", action="store_true", help="rebuild only osm.json (uses cached Overpass responses) from the existing meta.json")
    a = ap.parse_args()
    bbox, res = a.bbox, a.res
    out = ROOT / "data" / "bundles" / a.name
    out.mkdir(parents=True, exist_ok=True)

    epsg, tf, W, H = make_grid(bbox, res)
    crs = RCRS.from_epsg(epsg)
    if a.osm_only:
        osm = get_osm(bbox, crs, tf, a.name)
        osm_meta = {"bbox": bbox, "grid": {"crs": f"EPSG:{epsg}", "transform": list(tf)[:6], "width": W, "height": H},
                    "note": "pts are [lon, lat, px_x, px_y] with px in the common grid (float, pixel-corner origin)"}
        (out / "osm.json").write_text(json.dumps({**osm_meta, **osm}), encoding="utf-8")
        print("osm.json rebuilt:", len(osm["water"]), "water rings")
        return
    print(f"grid EPSG:{epsg} {W}x{H} @ {res} m")

    print("DEM...")
    h, dem_used = get_dem(bbox, crs, tf, W, H)
    hmin, hmax = float(h.min()), float(h.max())
    with rasterio.open(out / "height.tif", "w", driver="GTiff", height=H, width=W, count=1, dtype="float32",
                       crs=crs, transform=tf, compress="deflate", predictor=3) as dst:
        dst.write(h, 1)
    Image.fromarray(np.round((h - hmin) / (hmax - hmin) * 65535).astype(np.uint16)).save(out / "height16.png")

    print("landcover...")
    lc, lc_hi, wc_used = get_landcover(bbox, crs, tf, W, H, res)
    Image.fromarray(lc).save(out / "landcover.png")
    Image.fromarray(lc_hi).save(out / "landcover_hi.png")

    print("satellite...")
    sat = get_satellite(bbox, crs, tf, W, H, res, a.sat_res)
    Image.fromarray(sat).save(out / "satellite.jpg", quality=92)

    print("OSM...")
    if a.no_osm:
        osm = {k: [] for k in ("roads", "waterways", "water", "peaks", "passes", "places", "pois", "bridges")}
    else:
        osm = get_osm(bbox, crs, tf, a.name)
    osm_meta = {"bbox": bbox, "grid": {"crs": f"EPSG:{epsg}", "transform": list(tf)[:6], "width": W, "height": H},
                "note": "pts are [lon, lat, px_x, px_y] with px in the common grid (float, pixel-corner origin)"}
    (out / "osm.json").write_text(json.dumps({**osm_meta, **osm}), encoding="utf-8")

    meta = {
        "name": a.name, "bbox": bbox, "crs": f"EPSG:{epsg}", "res": res, "width": W, "height": H,
        "transform": list(tf)[:6], "hmin": hmin, "hmax": hmax, "px_per_m": 1.0 / res,
        "satellite_px_per_m": 1.0 / a.sat_res, "satellite_size": [sat.shape[1], sat.shape[0]],
        "landcover_hi_size": [W * 2, H * 2],
        "layers": {
            "height": {"source": dem_used, "licence": "Copernicus DEM GLO-30 (free, attribution required)",
                       "attribution": "Contains modified Copernicus DEM GLO-30 data, (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA; all rights reserved."},
            "landcover": {"source": wc_used, "licence": "CC BY 4.0",
                          "attribution": "(c) ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium"},
            "satellite": {"source": EOX_URL + " (EOX layer s2cloudless = 2016)", "licence": "CC BY 4.0",
                          "attribution": "Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016)"},
            "osm": {"source": OVERPASS[0], "licence": "ODbL 1.0", "attribution": "(c) OpenStreetMap contributors"},
        },
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    print("preview...")
    make_preview(out / "preview.png", sat, h, res, osm, W, H)
    print("done ->", out)


if __name__ == "__main__":
    main()
