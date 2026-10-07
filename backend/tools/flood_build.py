"""Validate web/data/floods.json and project any lon/lat extents into a pack's x,z frame.

Usage: python backend/tools/flood_build.py [--pack swat|swat-lower] [--write]
Extents in the file are {"source","licence","url","pack","lonlat_polys":[[[lon,lat],...]]}. Projection is UTM 43N
(EPSG:32643, the pack CRS) using the standard transverse-Mercator formulas, then shifted by the pack origin.
Output polys are [[x,z],...] clipped to the pack bbox. Nothing is downloaded here.
"""
import argparse
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FLOODS = ROOT / "web" / "data" / "floods.json"
PACKS = ROOT / "data" / "packs"
REQUIRED_FACT = ("text", "source", "url", "checked")


def validate(doc: dict) -> list[str]:
    errs = []
    for ev in doc.get("events", []):
        if ev.get("year") not in (2010, 2022):
            errs.append(f"bad year {ev.get('year')}")
        for f in ev.get("facts", []):
            for k in REQUIRED_FACT:
                if not str(f.get(k, "")).strip():
                    errs.append(f"{ev.get('year')}: fact missing {k}")
        ext = ev.get("extent")
        if ext is not None:
            for k in ("source", "licence", "url", "pack"):
                if not str(ext.get(k, "")).strip():
                    errs.append(f"{ev.get('year')}: extent missing {k}")
            if ext.get("pack") not in ("swat", "swat-lower"):
                errs.append(f"{ev.get('year')}: extent pack must be swat or swat-lower")
    return errs


def lonlat_to_utm43n(lon: float, lat: float) -> tuple[float, float]:
    a, f = 6378137.0, 1 / 298.257223563
    k0, lon0 = 0.9996, math.radians(75.0)
    e2 = f * (2 - f); ep2 = e2 / (1 - e2)
    phi, lam = math.radians(lat), math.radians(lon)
    N = a / math.sqrt(1 - e2 * math.sin(phi) ** 2)
    T, C, A = math.tan(phi) ** 2, ep2 * math.cos(phi) ** 2, (lam - lon0) * math.cos(phi)
    M = a * ((1 - e2 / 4 - 3 * e2 * e2 / 64) * phi - (3 * e2 / 8 + 3 * e2 * e2 / 32) * math.sin(2 * phi)
             + (15 * e2 * e2 / 256) * math.sin(4 * phi))
    E = 500000 + k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120)
    Nn = k0 * (M + N * math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24))
    return E, Nn


def project(slug: str, lonlat_polys: list) -> list:
    meta = json.loads((PACKS / slug / "atlas" / "meta.json").read_text(encoding="utf-8"))
    ox, oz = meta["origin_utm"]
    W, H = meta["cols"] * meta["res_m"], meta["rows"] * meta["res_m"]
    out = []
    for ring in lonlat_polys:
        pts = []
        for lon, lat in ring:
            E, N = lonlat_to_utm43n(lon, lat)
            x, z = E - ox, oz - N          # z grows south, UTM northing grows north
            pts.append([round(min(W, max(0.0, x)), 1), round(min(H, max(0.0, z)), 1)])
        if len(pts) >= 3:
            out.append(pts)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack", default="swat")
    ap.add_argument("--write", action="store_true", help="write projected polys back into floods.json")
    args = ap.parse_args()
    doc = json.loads(FLOODS.read_text(encoding="utf-8"))
    errs = validate(doc)
    if errs:
        raise SystemExit("\n".join(errs))
    for ev in doc["events"]:
        ext = ev.get("extent")
        if ext and ext.get("lonlat_polys"):
            ext["polys"] = project(args.pack, ext.pop("lonlat_polys"))
            print(ev["year"], "projected", len(ext["polys"]), "polys")
        else:
            print(ev["year"], "extent: none")
    if args.write:
        FLOODS.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
