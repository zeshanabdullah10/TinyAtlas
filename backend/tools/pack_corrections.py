"""Apply the checked corrections in pack_corrections.json to an Atlas pack's places (text fixes and kind fixes).

    python backend/tools/pack_corrections.py swat swat-lower      # fix built packs in data/packs/<slug>/atlas/ in place

atlas_pack.py calls apply() on every build, so a correction survives a rebuild from the research files. A replacement
only happens when the old text is there (re-running is harmless); a field path is "summary", "access", "kind" or
"facts.<i>.text". Photos of other places are filtered elsewhere (collect_photos.wrong_photo).
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RULES = json.loads((Path(__file__).with_name("pack_corrections.json")).read_text(encoding="utf-8"))["places"]


def _get(pl, path):
    o = pl
    for k in path.split("."):
        o = o[int(k)] if isinstance(o, list) else o.get(k)
        if o is None:
            return None
    return o


def _set(pl, path, value):
    keys = path.split(".")
    o = pl
    for k in keys[:-1]:
        o = o[int(k)] if isinstance(o, list) else o[k]
    o[int(keys[-1]) if isinstance(o, list) else keys[-1]] = value


def apply(places):
    """Correct `places` (a pack's list) in place; returns the number of edits made."""
    n = 0
    for pl in places:
        rule = RULES.get(pl.get("slug"))
        if not rule:
            continue
        for path, old, new in rule.get("replace", []):
            cur = _get(pl, path)
            if isinstance(cur, str) and old in cur:
                _set(pl, path, cur.replace(old, new)); n += 1
        for path, value in rule.get("set", {}).items():
            if _get(pl, path) != value:
                _set(pl, path, value); n += 1
    return n


def fix_built_pack(slug):
    """Bring a built pack up to date without a full rebuild: text corrections, photos of other places dropped (their
    files deleted), and files.json re-measured so every entry matches the file on disk."""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from collect_photos import wrong_photo
    d = ROOT / "data" / "packs" / slug / "atlas"
    places = json.loads((d / "places.json").read_text(encoding="utf-8"))
    n, dropped = apply(places), 0
    for pl in places:
        keep = []
        for ph in pl.get("photos") or []:
            if wrong_photo(ph.get("url", ""), slug=pl["slug"]):
                (d / ph["file"]).unlink(missing_ok=True); dropped += 1
            else:
                keep.append(ph)
        if pl.get("photos"):
            pl["photos"] = keep
    (d / "places.json").write_text(json.dumps(places, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    files = json.loads((d / "files.json").read_text(encoding="utf-8"))
    files = [dict(f, bytes=(d / f["path"]).stat().st_size) for f in files if (d / f["path"]).is_file()]
    (d / "files.json").write_text(json.dumps(files, separators=(",", ":")), encoding="utf-8")
    print(f"{slug}: {n} text corrections, {dropped} photos dropped, files.json {len(files)} files")


if __name__ == "__main__":
    for s in sys.argv[1:]:
        fix_built_pack(s)
