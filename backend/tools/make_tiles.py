"""Render depth + line passes for a region.

    python backend/tools/make_tiles.py hunza [nx] [ny] [size]
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tinyatlas import tiles  # noqa: E402
from tinyatlas.regions import REGIONS  # noqa: E402

name = sys.argv[1] if len(sys.argv) > 1 else "hunza"
nx = int(sys.argv[2]) if len(sys.argv) > 2 else 3
ny = int(sys.argv[3]) if len(sys.argv) > 3 else 3
size = int(sys.argv[4]) if len(sys.argv) > 4 else 1024

paths = tiles.render_region(name, REGIONS[name]["bbox"], nx, ny, size)
print(f"wrote {len(paths)} images to {paths[0].parent}")
