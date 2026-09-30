import numpy as np
from tinyatlas import terrain


def test_decode_terrarium_known_value():
    # 8848 m -> 8848+32768 = 41616 = 162*256 + 144
    px = np.array([[[162, 144, 0]]])
    assert abs(terrain.decode_terrarium(px)[0, 0] - 8848) < 1e-6


def test_tile_math_origin():
    x, y = terrain.lonlat_to_tile(0.0, 0.0, 1)
    assert (x, y) == (1.0, 1.0)


def test_grid_mesh_counts_and_bounds():
    hm = np.arange(16, dtype=float).reshape(4, 4)
    v, f = terrain.grid_mesh(hm, 100, 100)
    assert v.shape == (16, 3) and f.shape == (18, 3)
    assert f.max() == 15 and v[:, 1].min() == 0


def test_resample_shape():
    assert terrain.resample(np.random.rand(10, 7), 32).shape == (32, 32)
