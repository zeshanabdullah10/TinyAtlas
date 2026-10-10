// The landmark a site is about (meta.landmark, from backend/tools/diorama_sites/<site>.json): the White Palace keeps its
// own grounds (palace.js); any other landmark stands on the ground at (x, z) and is built from up to two parts:
//   model   a GLB next to the site data, in real metres (origin at the ground centre, +y up, front facing -z),
//           e.g. the Atlas maquettes of the stupas and the TRELLIS museum and mosque; credited in meta.sources;
//   module  web/js/diorama/landmarks/<module>.js, the site's own drawn geometry (a ruin, a rock relief, a waterfall,
//           the votive stupas round a main one ...), default export `build(ctx)`; see landmarks/kit.js for ctx.
// The front faces `heading_deg` (compass bearing, 0 north, 90 east) when given, else the end of the drive.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { palace } from "./palace.js";
import { context } from "./landmarks/kit.js";

/** Load a real-metre GLB into `g` (no rescale). TRELLIS exports carry no normals and read dark: the texture lifts them. */
function model(g, url, lm) {
  new GLTFLoader().load(url, (gltf) => {
    const m = gltf.scene;
    if (lm.model_scale) m.scale.setScalar(lm.model_scale);
    if (lm.model_y) m.position.y = lm.model_y;
    m.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
      for (const mt of [].concat(o.material)) {
        mt.metalness = 0; mt.side = THREE.DoubleSide;
        if (mt.map) { mt.emissive?.set(0xffffff); mt.emissiveMap = mt.map; mt.emissiveIntensity = 0.22; }
        mt.roughness = Math.min(0.95, Math.max(mt.roughness ?? 0.85, 0.6));
      }
    });
    g.add(m);
  }, undefined, (e) => console.warn(`landmark model ${url}: ${e.message || e}`));
}

/** Returns the landmark group at once; the model and module parts arrive when loaded. `update(dt, t)` animates them. */
export function landmark(site, lm, face, base) {
  if (lm.kind === "palace" && !lm.module) return palace(site, lm, face, lm.model ? base + lm.model : null);
  const g = new THREE.Group();
  const y = site.heightAt(lm.x, lm.z);
  g.position.set(lm.x, y + (lm.y_offset || 0), lm.z);
  g.rotation.y = lm.heading_deg != null ? -THREE.MathUtils.degToRad(lm.heading_deg)
    : Math.atan2(-(face.x - lm.x), -(face.z - lm.z));                 // front (-z) toward the end of the drive
  g.userData.top = y + (lm.top_m || 20);
  const updates = [];
  g.userData.update = (dt, t) => { for (const u of updates) u(dt, t); };
  if (lm.model) model(g, base + lm.model, lm);
  if (lm.module) {
    import(`./landmarks/${lm.module.replace(/[^a-z0-9-_]/g, "")}.js`).then((mod) => {
      const ctx = context(site, lm, g);
      const r = mod.default(ctx);
      if (r?.update) updates.push(r.update);
      g.updateMatrixWorld(true);
    }).catch((e) => console.warn(`landmark module ${lm.module}: ${e.message || e}`));
  }
  return g;
}
