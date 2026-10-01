"""Runs ON THE POD (in /workspace/trellis): TRELLIS-image-large (MIT) image(s) -> textured GLB.

    ATTN_BACKEND=xformers SPCONV_ALGO=native /workspace/trellis/bin/python trellis_worker.py /workspace/b3d_job

Job layout: <job>/<slug>/<variant>/*.png (1-3 photos, already cropped; >1 = multi-image conditioning).
Output: <job>/<slug>/<variant>_s<seed>.glb (texture 1024, <= MAX_TRIS triangles). Seeds from env SEEDS="1,2".
"""
import os
import sys
from pathlib import Path

os.environ.setdefault("PYTORCH_ALLOC_CONF", "expandable_segments:True")
os.environ.setdefault("ATTN_BACKEND", "xformers")
os.environ.setdefault("SPCONV_ALGO", "native")
sys.path.insert(0, "/workspace/TRELLIS")
from unittest import mock  # noqa: E402

sys.modules.setdefault("open3d", mock.MagicMock())
for m in ("kaolin", "kaolin.utils", "kaolin.utils.testing"):  # flexicubes only imports kaolin's check_tensor (debug asserts)
    sys.modules.setdefault(m, mock.MagicMock())  # only the text pipeline uses it; the wheel needs libEGL
import torch  # noqa: E402
from PIL import Image  # noqa: E402
from trellis.pipelines import TrellisImageTo3DPipeline  # noqa: E402
from trellis.utils import postprocessing_utils  # noqa: E402

MAX_TRIS = 18000
job = Path(sys.argv[1])
seeds = [int(s) for s in os.environ.get("SEEDS", "1").split(",")]
only = os.environ.get("ONLY")  # optional "slug/variant" filter

pipe = TrellisImageTo3DPipeline.from_pretrained("JeffreyXiang/TRELLIS-image-large")
pipe.cuda()
_decode = pipe.decode_slat


def decode_low_vram(slat, formats):
    """Park the samplers and DINO on the CPU while the (memory hungry) mesh/gaussian decoders run; the GPU is shared."""
    park = ["sparse_structure_flow_model", "slat_flow_model", "image_cond_model", "sparse_structure_decoder"]
    for n in park:
        pipe.models[n].cpu()
    torch.cuda.empty_cache()
    try:
        return _decode(slat, formats)
    finally:
        for n in park:
            pipe.models[n].cuda()


pipe.decode_slat = decode_low_vram
for vdir in sorted(p for p in job.glob("*/*") if p.is_dir()):
    if only and only != f"{vdir.parent.name}/{vdir.name}":
        continue
    imgs = [Image.open(f).convert("RGB") for f in sorted(vdir.glob("*.png"))]
    imgs = [pipe.preprocess_image(i) for i in imgs]
    for seed in seeds:
        out = vdir.parent / f"{vdir.name}_s{seed}.glb"
        if out.exists():
            continue
        kw = dict(seed=seed, preprocess_image=False, formats=["gaussian", "mesh"],
                  sparse_structure_sampler_params={"steps": 12, "cfg_strength": 7.5},
                  slat_sampler_params={"steps": 12, "cfg_strength": 3})
        o = pipe.run_multi_image(imgs, **kw) if len(imgs) > 1 else pipe.run(imgs[0], **kw)
        nf = o["mesh"][0].faces.shape[0]
        pipe.cpu()                           # the baker needs the room: it renders ~100 views of the gaussians
        torch.cuda.empty_cache()
        try:
            glb = postprocessing_utils.to_glb(o["gaussian"][0], o["mesh"][0], simplify=min(0.995, 1 - MAX_TRIS / nf),
                                              texture_size=1024)
        except torch.OutOfMemoryError:       # the GPU is shared; skip this one, a rerun fills the gap
            print("OOM", out.name, flush=True)
            del o
            pipe.cuda()
            torch.cuda.empty_cache()
            continue
        del o
        torch.cuda.empty_cache()
        pipe.cuda()
        glb.export(out)
        print("modelled", out.name, "raw faces", nf, "->", len(glb.geometry[list(glb.geometry)[0]].faces) if hasattr(glb, "geometry") else len(glb.faces), flush=True)
        torch.cuda.empty_cache()
print("DONE", flush=True)
