"""Release-time size pass over built Atlas packs (data/packs/<slug>/atlas/), and the diorama file manifest.

    python backend/tools/pack_optimize.py                      # every pack under data/packs/
    python backend/tools/pack_optimize.py swat-lower --dry-run # numbers only, writes nothing
    python backend/tools/pack_optimize.py --packs-dir /tmp/copy/packs
    python backend/tools/pack_optimize.py --dioramas           # web/data/diorama/files.json: {site: [{path, bytes, hash}]}

Photos: photos/**/*.jpg become WebP (quality 80, long edge at most 1280 px, never enlarged, EXIF rotation applied). The JPEG is
deleted only after its WebP has been written and re-read. places.json keeps its text and every photo's attribution/url; only the
`"file": "photos/...jpg"` strings change. files.json is rewritten from what is on disk (sorted, same skips as atlas_pack.list_files)
and every entry gets a short `hash` (sha256) next to `bytes`: the service worker compares them to refresh a saved pack whose files
changed. Running it again changes nothing. Run it last, after pack_photos.py apply (which adds .jpg files) and before pack.py.
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[2]
SKIP = {"_check.png", "files.json"}
JPG = {".jpg", ".jpeg"}


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


def list_files(atlas: Path) -> list[dict]:
    """Like atlas_pack.list_files, plus a hash per file."""
    return [{"path": p.relative_to(atlas).as_posix(), "bytes": p.stat().st_size, "hash": sha(p)} for p in sorted(atlas.rglob("*"))
            if p.is_file() and p.name not in SKIP and "_bake" not in p.relative_to(atlas).parts]


def to_webp(src: Path, quality: int, max_edge: int) -> Path:
    dst = src.with_suffix(".webp")
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        if max(im.size) > max_edge:
            im.thumbnail((max_edge, max_edge), Image.LANCZOS)         # keeps the aspect ratio, only ever shrinks
        tmp = dst.with_name(dst.name + ".part")
        im.save(tmp, "WEBP", quality=quality, method=6)
    with Image.open(tmp) as chk:                                       # the WebP must read back before the JPEG may go
        chk.load()
    tmp.replace(dst)
    return dst


def optimize_pack(atlas: Path, quality=80, max_edge=1280, dry=False, log=print) -> dict:
    photos = sorted(p for p in (atlas / "photos").rglob("*") if p.suffix.lower() in JPG) if (atlas / "photos").exists() else []
    before = sum(p.stat().st_size for p in (atlas / "photos").rglob("*") if p.is_file()) if (atlas / "photos").exists() else 0
    total_before = sum(p.stat().st_size for p in atlas.rglob("*") if p.is_file())
    made: set[str] = set()
    for src in photos:
        dst = src.with_suffix(".webp")
        if dry:
            made.add(src.relative_to(atlas).as_posix())
            continue
        if not dst.exists():
            to_webp(src, quality, max_edge)
        made.add(src.relative_to(atlas).as_posix())
        src.unlink()                                                   # only reached once the WebP exists
    if not dry and made:
        pj = atlas / "places.json"
        text = pj.read_text(encoding="utf-8")
        new = re.sub(r'("file":\s*")(photos/[^"]*?)(\.jpe?g)"', lambda m: f'{m.group(1)}{m.group(2)}.webp"', text, flags=re.I)
        for entry in json.loads(new):                                  # every photo `file` must now exist
            for ph in entry.get("photos", []):
                if ph.get("file") and not (atlas / ph["file"]).exists():
                    raise SystemExit(f"{atlas}: {ph['file']} listed in places.json but missing on disk")
        if new != text:
            pj.write_text(new, encoding="utf-8")
    after = sum(p.stat().st_size for p in (atlas / "photos").rglob("*") if p.is_file()) if (atlas / "photos").exists() else 0
    if not dry:
        files = list_files(atlas)
        (atlas / "files.json").write_text(json.dumps(files, separators=(",", ":")), encoding="utf-8")
    total_after = sum(p.stat().st_size for p in atlas.rglob("*") if p.is_file())
    out = {"converted": len(made), "photos_before": before, "photos_after": after, "pack_before": total_before, "pack_after": total_after}
    log(f"{atlas.parent.name}: {len(made)} photos converted; photos {before / 1e6:.1f} -> {after / 1e6:.1f} MB; pack {total_before / 1e6:.1f} -> {total_after / 1e6:.1f} MB"
        + (" (dry run: counts only, nothing written)" if dry else ""))
    return out


def diorama_manifest(root: Path = ROOT / "web" / "data" / "diorama") -> dict:
    return {d.name: [{"path": p.relative_to(d).as_posix(), "bytes": p.stat().st_size, "hash": sha(p)} for p in sorted(d.rglob("*")) if p.is_file()]
            for d in sorted(root.iterdir()) if d.is_dir()}


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("slugs", nargs="*", help="packs to process (default: every pack with an atlas/ folder)")
    ap.add_argument("--packs-dir", default=str(ROOT / "data" / "packs"))
    ap.add_argument("--quality", type=int, default=80)
    ap.add_argument("--max-edge", type=int, default=1280)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--dioramas", action="store_true", help="write web/data/diorama/files.json (sizes and hashes of each diorama's files) and exit")
    a = ap.parse_args()
    if a.dioramas:
        m = diorama_manifest()
        out = ROOT / "web" / "data" / "diorama" / "files.json"
        out.write_text(json.dumps(m, separators=(",", ":")), encoding="utf-8")
        print(f"{out}: {len(m)} dioramas, {sum(f['bytes'] for fs in m.values() for f in fs) / 1e6:.1f} MB")
        sys.exit(0)
    packs = Path(a.packs_dir)
    slugs = a.slugs or sorted(p.name for p in packs.iterdir() if (p / "atlas").is_dir())
    for s in slugs:
        optimize_pack(packs / s / "atlas", a.quality, a.max_edge, a.dry_run)
