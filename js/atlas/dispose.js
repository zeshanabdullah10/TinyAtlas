// Free everything a scene holds on the GPU: geometries, materials, every texture they reference, shadow maps.
import { shared } from "./material.js";

function disposeTextures(obj, seen) {
  for (const v of Object.values(obj)) {
    if (v?.isTexture && !seen.has(v)) { seen.add(v); v.image?.close?.(); v.dispose(); }
    else if (v && typeof v === "object" && v.value?.isTexture && !seen.has(v.value)) { seen.add(v.value); v.value.image?.close?.(); v.value.dispose(); }
  }
}

export function disposeScene(scene, renderer) {
  const seen = new Set(), mats = new Set();
  scene.traverse((o) => {
    o.geometry?.dispose();
    if (o.isInstancedMesh) o.dispose();
    for (const m of [].concat(o.material ?? [])) mats.add(m);
    if (o.isLight && o.shadow?.map) { o.shadow.map.dispose(); o.shadow.map = null; }
  });
  for (const m of mats) { disposeTextures(m, seen); if (m.uniforms) disposeTextures(m.uniforms, seen); m.dispose(); }
  if (scene.background?.isTexture) { scene.background.dispose(); scene.background = null; }
  for (const k of ["uGrad", "uShadow", "uOv"]) { shared[k].value?.dispose(); shared[k].value = null; }
  scene.clear();
  renderer.renderLists.dispose();
}
