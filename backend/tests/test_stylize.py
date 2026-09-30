import numpy as np
from PIL import Image
from tinyatlas import stylize


def test_workflow_links_point_at_existing_nodes_and_outputs_exist():
    wf = stylize.build_workflow("b.png", "d.png", "l.png")
    for nid, node in wf.items():
        for v in node["inputs"].values():
            if isinstance(v, list):
                assert v[0] in wf, f"node {nid} links to missing node {v[0]}"
    assert wf["14"]["class_type"] == "SaveImage"
    assert wf["4"]["inputs"]["image"] == "b.png" and wf["5"]["inputs"]["image"] == "d.png"
    assert wf["12"]["inputs"]["denoise"] < 1.0          # img2img: the painted tile stays authoritative


def test_ramps_of_neighbours_sum_to_one():
    a = stylize._ramp(100, 0, 20)        # left tile: falls over its last 20 px
    b = stylize._ramp(100, 20, 0)        # right tile: rises over its first 20 px
    assert np.allclose(a[80:] + b[:20], 1.0)
    assert a[:80].min() == 1.0 and b[20:].min() == 1.0


def test_blend_of_identical_colour_tiles_has_no_seam_or_darkening():
    red = Image.new("RGB", (60, 40), (200, 30, 30))
    out = stylize.blend_mosaic([
        (red, (0, 0, 60, 40), (0, 0, 20, 0)),       # left tile, overlap with the right one is 20 px
        (red, (40, 0, 100, 40), (20, 0, 0, 0)),
    ], (100, 40))
    a = np.asarray(out)
    assert a.shape == (40, 100, 3) and np.abs(a.astype(int) - [200, 30, 30]).max() <= 1


def test_blend_crossfades_between_different_tiles():
    black, white = Image.new("RGB", (60, 10), 0), Image.new("RGB", (60, 10), 255)
    out = np.asarray(stylize.blend_mosaic([
        (black, (0, 0, 60, 10), (0, 0, 20, 0)), (white, (40, 0, 100, 10), (20, 0, 0, 0))], (100, 10)))[0, :, 0]
    assert out[10] == 0 and out[90] == 255 and (np.diff(out[40:60].astype(int)) >= 0).all() and 0 < out[50] < 255


def test_restore_water_only_changes_masked_pixels():
    styled = Image.new("RGB", (10, 10), (100, 100, 100))
    mask = Image.new("L", (10, 10), 0)
    mask.paste(255, (0, 0, 5, 10))
    a = np.asarray(stylize.restore_water(styled, mask, amount=1.0))
    assert (a[:, 5:] == 100).all()                              # untouched where there is no water
    assert tuple(a[0, 0]) == (74, 144, 196)                     # full water colour where the mask is 255
