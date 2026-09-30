"""Paint the procedural illustrated texture for a region.

    python backend/tools/make_texture.py hunza [nx] [ny]
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tinyatlas import paint  # noqa: E402
from tinyatlas.regions import REGIONS  # noqa: E402

name = sys.argv[1] if len(sys.argv) > 1 else "hunza"
nx = int(sys.argv[2]) if len(sys.argv) > 2 else 3
ny = int(sys.argv[3]) if len(sys.argv) > 3 else 3
print("wrote", paint.paint_region(name, REGIONS[name]["bbox"], nx, ny))
