import numpy as np
from tinyatlas import tiles

BBOX = (10.0, 20.0, 13.0, 23.0)


def test_grid_count_and_coverage():
    ts = tiles.tile_grid(BBOX, 3, 3, overlap=0.0)
    assert len(ts) == 9
    assert min(t.bbox[0] for t in ts) == 10.0 and max(t.bbox[2] for t in ts) == 13.0
    assert min(t.bbox[1] for t in ts) == 20.0 and max(t.bbox[3] for t in ts) == 23.0
    # iy=0 is the north row
    assert next(t for t in ts if (t.ix, t.iy) == (0, 0)).bbox == (10.0, 22.0, 11.0, 23.0)


def test_overlap_grows_interior_tiles_and_clamps_edges():
    ts = {(t.ix, t.iy): t for t in tiles.tile_grid(BBOX, 3, 3, overlap=0.25)}
    mid, corner = ts[(1, 1)], ts[(0, 0)]
    assert mid.bbox == (10.75, 20.75, 12.25, 22.25)
    assert corner.bbox[0] == 10.0 and corner.bbox[3] == 23.0  # clamped to region
    assert corner.bbox[2] == 11.25 and corner.bbox[1] == 21.75


def test_line_image_places_pixels_in_tile_space():
    t = tiles.Tile(0, 0, BBOX)
    # diagonal road NW -> SE across the whole region
    img = np.asarray(tiles.line_image(t, {"road": [[(0.0, 0.0), (1.0, 1.0)]]}, BBOX, size=64))
    assert img[0, 0] == 255 and img[63, 63] == 255 and img[0, 63] == 0 and img[63, 0] == 0


def test_line_image_maps_subtile_correctly():
    # Tile = NE quarter of the region; a vertical line at u=0.75 is mid-tile.
    sub = tiles.Tile(1, 0, (11.5, 21.5, 13.0, 23.0))
    img = np.asarray(tiles.line_image(sub, {"river": [[(0.75, 0.0), (0.75, 0.5)]]}, BBOX, size=64))
    cols = np.where(img.any(axis=0))[0]
    assert abs(cols.mean() - 31.5) < 4
