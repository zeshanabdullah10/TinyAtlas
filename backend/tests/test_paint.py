import numpy as np
from tinyatlas import paint, tiles

BBOX = (10.0, 20.0, 13.0, 23.0)


def test_blur_preserves_constant_and_smooths_spike():
    assert np.allclose(paint.blur(np.full((9, 9), 7.0), 1.2), 7.0)
    spike = np.zeros((15, 15)); spike[7, 7] = 1.0
    out = paint.blur(spike, 1.5)
    assert out.shape == spike.shape and out[7, 7] < 0.5 and abs(out.sum() - 1.0) < 1e-6


def test_flat_ground_shade_equals_sin_altitude():
    hm = np.zeros((8, 8))
    slope, shade = paint.slope_and_shade(hm, 30, 30, alt_deg=42)
    assert np.allclose(slope, 0) and np.allclose(shade, np.sin(np.radians(42)))


def test_slope_facing_light_is_brighter_than_facing_away():
    # Height rises toward the east: west-facing... NW light (az 315) lights west/north slopes.
    ramp_east = np.tile(np.linspace(0, 100, 16), (16, 1))       # rises eastward -> slope faces west
    _, lit = paint.slope_and_shade(ramp_east, 30, 30)
    _, dark = paint.slope_and_shade(ramp_east[:, ::-1], 30, 30)  # rises westward -> slope faces east
    assert lit.mean() > dark.mean()


def test_colorize_snow_rock_and_valley():
    hm = np.array([[1500.0, 6500.0, 6500.0]])
    slope = np.radians(np.array([[5.0, 5.0, 70.0]]))
    rgb = paint.colorize(hm, slope, np.ones_like(hm))
    valley, snow, cliff = rgb[0]
    assert snow.min() > 230                     # gentle high ground is snow
    assert cliff.max() < 200                    # a very steep face stays rock
    assert valley[1] > valley[2]                # valley is green-ish, not blue


def test_core_boxes_tile_the_mosaic():
    size = 1000
    for t in tiles.tile_grid(BBOX, 3, 3, 0.125):
        l, tp, r, b = paint.core_box(t, BBOX, 3, 3, size)
        assert 0 <= l < r <= size and 0 <= tp < b <= size
        tw, ts, te, tn = t.bbox                       # every core spans exactly 1 deg x 1 deg here
        assert abs((r - l) / size * (te - tw) - 1.0) < 0.01
        assert abs((b - tp) / size * (tn - ts) - 1.0) < 0.01
