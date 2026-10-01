"""Blender: render a textured GLB from two angles -> <out>_a.png / <out>_b.png.
    blender.exe -b -P glb_compare.py -- model.glb out_prefix
Camera looks at the model's centre from the glTF +Z side (TRELLIS's front), once straight on and once turned ~35 deg."""
import math
import sys

import bpy
from mathutils import Vector

glb, prefix = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
ctr, size = (lo + hi) / 2, max(hi - lo)

sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE"
sc.render.resolution_x, sc.render.resolution_y = 960, 720
w = bpy.data.worlds.new("w"); w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.85, 0.88, 0.92, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
sc.world = w
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sun.data.energy = 3
sun.rotation_euler = (math.radians(50), 0, math.radians(30)); sc.collection.objects.link(sun)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); cam.data.lens = 40; sc.collection.objects.link(cam); sc.camera = cam

# glTF +Z (front) is Blender -Y
for tag, az in (("a", 0), ("b", 35)):
    a = math.radians(az)
    d = size * 2.0
    cam.location = ctr + Vector((math.sin(a) * d, -math.cos(a) * d, size * 0.2))
    cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = f"{prefix}_{tag}.png"
    bpy.ops.render.render(write_still=True)
