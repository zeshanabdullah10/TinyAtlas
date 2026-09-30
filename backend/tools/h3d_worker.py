"""Runs ON THE POD (in /workspace/h3d): turn every <slug>.png picture in a folder into <slug>.glb.

    /workspace/h3d/bin/python h3d_worker.py /workspace/models_job

Hunyuan3D-2 shape generation only (no texture): the app paints every model in one plaster white. Clean-up is done
with trimesh (the pymeshlab build on the pod can't read the meshes Hunyuan's own post-processors hand it).
"""
import sys
from pathlib import Path

import fast_simplification
import numpy as np
import torch
import trimesh
from PIL import Image
from hy3dgen.rembg import BackgroundRemover
from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline

MAX_FACES = 12000


def clean(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    parts = mesh.split(only_watertight=False)
    if len(parts) > 1:                                   # drop floating crumbs: keep pieces with real surface area
        areas = np.array([p.area for p in parts])
        mesh = trimesh.util.concatenate([p for p, a in zip(parts, areas) if a >= 0.02 * areas.max()])
    if len(mesh.faces) > MAX_FACES:
        v, f = fast_simplification.simplify(mesh.vertices, mesh.faces, target_reduction=1 - MAX_FACES / len(mesh.faces))
        mesh = trimesh.Trimesh(v, f)
    mesh.remove_unreferenced_vertices()
    return mesh


job = Path(sys.argv[1])
todo = sorted(p for p in job.glob("*.png") if not p.with_suffix(".glb").exists())
if todo:
    pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained("tencent/Hunyuan3D-2", subfolder="hunyuan3d-dit-v2-0")
    rembg = BackgroundRemover()
    for p in todo:
        image = rembg(Image.open(p).convert("RGB"))
        mesh = pipe(image=image, num_inference_steps=30, octree_resolution=320, num_chunks=20000,
                    generator=torch.manual_seed(7), output_type="trimesh")[0]
        mesh = clean(mesh)
        mesh.export(p.with_suffix(".glb"))
        print("modelled", p.name, len(mesh.faces), "faces", flush=True)
print("DONE", flush=True)
