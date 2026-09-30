import numpy as np
from tinyatlas import viewshed

SIZE = (40_000.0, 40_000.0)                  # a 40 km square, 201 x 201 cells of 200 m


def cone(hm, r, c, height, radius_cells):
    R, C = hm.shape
    rr, cc = np.mgrid[0:R, 0:C]
    return np.maximum(hm, height * np.clip(1 - np.hypot(rr - r, cc - c) / radius_cells, 0, None))


def test_a_lone_peak_is_seen_in_the_right_direction():
    hm = cone(np.full((201, 201), 1000.0), 50, 100, 5000, 20)          # 10 km due north of the centre
    p = viewshed.panorama(hm, SIZE, (100, 100), peaks=[{"name": "North", "row": 50, "col": 100, "ele": None}])
    assert [s["name"] for s in p["peaks"]] == ["North"]
    s = p["peaks"][0]
    assert abs(s["az"]) < 0.5 or abs(s["az"] - 360) < 0.5
    assert abs(s["dist"] - 10_000) < 50 and s["alt"] > 20              # 4 km higher, 10 km away: about 22 degrees
    east = p["bands"][-1][int(90 / p["az_step"])]
    north = p["bands"][-1][0]
    assert north > 20 > east                                           # the skyline rises only towards the peak


def test_a_nearer_wall_hides_a_lower_peak_behind_it():
    hm = np.full((201, 201), 1000.0)
    hm[80:84, :] = 3000.0                                              # an east-west ridge 3.6 km north
    hm = cone(hm, 30, 100, 2500, 6)                                    # a smaller peak 14 km north, behind it
    hm = cone(hm, 100, 170, 2500, 6)                                   # the same peak due east, in the open
    peaks = [{"name": "Hidden", "row": 30, "col": 100, "ele": None}, {"name": "Open", "row": 100, "col": 170, "ele": None}]
    names = [s["name"] for s in viewshed.panorama(hm, SIZE, (100, 100), peaks=peaks)["peaks"]]
    assert names == ["Open"]


def test_curvature_sinks_distant_summits():
    assert abs(viewshed.drop(100_000) - 682) < 10                      # about 680 m at 100 km with refraction
    assert viewshed.drop(1_000) < 0.1


def test_bands_only_grow_with_distance():
    hm = cone(np.full((201, 201), 1000.0), 20, 20, 6000, 30)
    bands = viewshed.panorama(hm, SIZE, (150, 150))["bands"]
    for near, far in zip(bands, bands[1:]):
        assert all(f >= n - 1e-9 for n, f in zip(near, far))
