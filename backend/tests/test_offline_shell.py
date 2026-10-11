"""Everything a saved Atlas needs for offline use is listed in web/js/atlas/offline.js (SHELL, CDN), so a file added to the code
cannot be forgotten: the test walks the import graph from the Atlas entry points and compares."""
import json
import re
from pathlib import Path

WEB = Path(__file__).resolve().parents[2] / "web"
OFFLINE = (WEB / "js" / "atlas" / "offline.js").read_text(encoding="utf-8")
IMPORT = [re.compile(p) for p in (r"""\b(?:import|export)\s*(?:[^'"();]*?\sfrom\s*)?["']([^"']+)["']""", r"""\bimport\(\s*["']([^"']+)["']\s*\)""",
                                  r"""new URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url""")]


def shell_list():
    block = re.search(r"export const SHELL = \[(.*?)\];\n", OFFLINE, re.S).group(1)
    out = set(re.findall(r'^\s*(?:"([^"]+)",?\s*)', block.split("...[")[0], re.M)) | set(re.findall(r'"([^"]+)"', block.split("...[")[0]))
    names = re.search(r"\.\.\.\[(.*?)\]\.map\(\(n\) => `([^`]*)`\)", block, re.S)
    out |= {names.group(2).replace("${n}", n) for n in re.findall(r'"([^"]+)"', names.group(1))}
    return out


def cdn_list():
    block = re.search(r"export const CDN = \[(.*?)\]\.map", OFFLINE, re.S).group(1)
    return set(re.findall(r'"([^"]+)"', block))


def graph(entry: Path, seen=None, bare=None):
    """Local files reachable from a module (as paths relative to web/), and the three/addons specifiers met on the way."""
    seen = set() if seen is None else seen
    bare = set() if bare is None else bare
    if entry in seen:
        return seen, bare
    seen.add(entry)
    text = entry.read_text(encoding="utf-8")
    for rx in IMPORT:
        for spec in rx.findall(text):
            if spec.startswith("three/addons/"):
                bare.add(spec[len("three/addons/"):])
            elif spec.startswith("."):
                nxt = (entry.parent / spec).resolve()
                if nxt.suffix == ".js":
                    assert nxt.exists(), f"{entry.relative_to(WEB)} imports {spec}, which does not exist"
                    graph(nxt, seen, bare)
                else:
                    seen.add(nxt)                                         # a data file named with new URL(..., import.meta.url)
    return seen, bare


def rel(paths):
    return {p.relative_to(WEB.resolve()).as_posix() for p in paths}


def test_every_file_in_the_atlas_import_graph_is_in_the_shell():
    files, _ = graph((WEB / "js" / "atlas" / "main.js").resolve())
    shell = shell_list()
    missing = sorted(rel(files) - shell)
    assert not missing, f"add to SHELL in web/js/atlas/offline.js: {missing}"


def test_trip_kit_page_and_its_inline_module_are_covered():
    html = (WEB / "tripkit.html").read_text(encoding="utf-8")
    shell = shell_list()
    assert "tripkit.html" in shell
    for m in re.finditer(r"<script type=\"module\">(.*?)</script>", html, re.S):
        for rx in IMPORT:
            for spec in rx.findall(m.group(1)):
                if spec.startswith("."):
                    files, _ = graph((WEB / spec).resolve())
                    assert not (rel(files) - shell), rel(files) - shell
    assert "data/emergency.json" in shell


def test_pages_styles_and_fonts_are_covered_and_exist():
    shell = shell_list()
    for name in sorted(shell):
        assert (WEB / name).exists(), f"SHELL lists {name}, which is not in web/"
    for page in ("atlas.html", "tripkit.html"):
        for href in re.findall(r'<link rel="stylesheet" href="([^"]+)"', (WEB / page).read_text(encoding="utf-8")):
            assert href in shell, f"{page} links {href}"
    css = (WEB / "fonts" / "fonts.css").read_text(encoding="utf-8")
    fonts = re.findall(r"url\(([^)]+)\)", css)
    assert fonts and all((WEB / "fonts" / f).exists() for f in fonts)       # crawl() saves them from fonts.css; they must exist
    assert "fonts/fonts.css" in shell


def test_three_addons_the_atlas_imports_are_in_the_cdn_list():
    _, bare = graph((WEB / "js" / "atlas" / "main.js").resolve())
    cdn = cdn_list()
    assert bare, "the atlas imports three/addons"
    for spec in bare:
        assert f"examples/jsm/{spec}" in cdn, spec
    assert "build/three.module.js" in cdn
    assert "examples/jsm/utils/BufferGeometryUtils.js" in cdn               # GLTFLoader imports it


def test_diorama_graph_and_landmark_modules_exist():
    files, bare = graph((WEB / "js" / "diorama" / "main.js").resolve())
    assert all(p.exists() for p in files if p.suffix == ".js")
    cdn = cdn_list()
    assert all(f"examples/jsm/{s}" in cdn for s in bare), bare - {c.split("jsm/")[-1] for c in cdn}
    for meta in sorted((WEB / "data" / "diorama").glob("*/meta.json")):
        lm = (json.loads(meta.read_text(encoding="utf-8")).get("landmark") or {})
        if lm.get("module"):
            mod = WEB / "js" / "diorama" / "landmarks" / (re.sub(r"[^a-z0-9-_]", "", lm["module"]) + ".js")
            assert mod.exists(), f"{meta.parent.name}: landmark module {lm['module']} is missing"
            graph(mod.resolve())
        if lm.get("model"):
            assert (meta.parent / lm["model"]).exists(), f"{meta.parent.name}: landmark model {lm['model']} is missing"
    dio = (WEB / "js" / "diorama" / "offline.js").read_text(encoding="utf-8")
    for p in re.findall(r'"([^"]+)"', re.search(r"const SHARED = \[(.*?)\];", dio, re.S).group(1)):
        assert (WEB / p).exists(), p


def test_service_worker_caches_exist_and_version_is_bumpable():
    sw = (WEB / "sw.js").read_text(encoding="utf-8")
    assert re.search(r'const SHELL = "tinyatlas-shell-v\d+"', sw) and 'const DATA = "tinyatlas-data-v1"' in sw
    core = re.search(r"const CORE = \[(.*?)\]\.map", sw, re.S).group(1)
    for p in re.findall(r'"([^"]*)"', core):
        assert p == "" or (WEB / p).exists(), p
