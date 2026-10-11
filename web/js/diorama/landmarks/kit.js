// Shared kit for landmark modules (web/js/diorama/landmarks/<module>.js). A module's default export is
// `build(ctx)`; it adds meshes to ctx.group and may return { update(dt, t) } for animation (water, flags, a lift).
//
// ctx.group      THREE.Group at the landmark point on the ground, already turned so its front faces -z
//                (toward lm.heading_deg or the end of the drive). Work in its local metres: x right, -z front, y up.
// ctx.ground(x, z)   ground height under the local point (x, z), relative to the group origin. Use it to seat every
//                piece on the real slope (the terrain is the DEM; only a declared terrace is level).
// ctx.world(x, z)    the local point in world (site) coordinates, {x, z}.
// ctx.lm         meta.landmark (any extra keys from the site file come through, e.g. lm.params).
// ctx.site       the loaded site (heightAt, coverAt, toLocal(lat, lon) -> [x, z] world ...).
// ctx.local(wx, wz)  world -> group-local {x, z} (e.g. to place something at a lat/lon via site.toLocal).
// ctx.M          shared materials (stone, schist, plaster, brick, wood, darkWood, mud, grass, water, white, rust).
// ctx.box / cyl / lathe / rocks / batch   helpers below. Every mesh casts and receives shadows.
// ctx.masonry(base, opts)  a stone material whose courses, blocks, joints and weathering are drawn from world position
//                (no UVs, so it survives ctx.batch): Gandharan diaper masonry by default (big blocks with thin slab
//                courses between), `{ slabs: true }` for coursed slab walls, `{ rubble: true }` for random rubble.
// Keep the draw calls low: build static parts, then `ctx.batch(ctx.group)` merges them per material (call it once,
// at the end, and keep animated meshes out of the group until after it).
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { hash } from "../site.js";

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...o });
export const M = {
  stone: mat(0x9c9486), schist: mat(0x6f6a5f), plaster: mat(0xd9cfbb), brick: mat(0x9a5a44), wood: mat(0x8a6240),
  darkWood: mat(0x4a3424), mud: mat(0xa88866), grass: mat(0x5d7a34, { roughness: 1 }), white: mat(0xf2efe8, { roughness: 0.5 }),
  rust: mat(0x8c4a2a), metal: mat(0x9aa0a6, { metalness: 0.5, roughness: 0.4 }), dark: mat(0x3d3833),   // never black: shade does the rest
  water: new THREE.MeshStandardMaterial({ color: 0xdfeef2, roughness: 0.15, transparent: true, opacity: 0.85 }),
};
export { mat };

/** Stone drawn from world position: per-block tone, mortar joints, a darker damp foot and lichen-pale tops.
 *  base/alt: the two stone colours mixed per block; opts: { block (m), course (m), slabs, rubble, joint (0-1), damp }. */
export function masonry(base, opts = {}) {
  const o = { alt: base, block: 0.7, course: 0.42, joint: 0.35, damp: 0.25, ...opts };
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
  const c1 = new THREE.Color(base), c2 = new THREE.Color(o.alt);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uC1 = { value: c1 }; sh.uniforms.uC2 = { value: c2 };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vWP;
varying vec3 vWN;
uniform vec3 uC1;
uniform vec3 uC2;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }`)
      .replace("#include <color_fragment>", `#include <color_fragment>
      {
        vec3 n = normalize(vWN);
        float along = abs(n.x) > abs(n.z) ? vWP.z : vWP.x;
        vec2 q; float jt;
        if (abs(n.y) > 0.75) {                      // tops: irregular flat stones
          q = vWP.xz / ${(o.block * 0.9).toFixed(3)};
          q.x += 0.5 * floor(q.y);
          jt = min(min(fract(q.x), 1.0 - fract(q.x)), min(fract(q.y), 1.0 - fract(q.y)));
        } else {
          float y = vWP.y;
          ${o.rubble ? `q = vec2(along / ${o.block.toFixed(3)}, y / ${(o.block * 0.6).toFixed(3)});
          q += 0.35 * vec2(vn(q * 1.7), vn(q.yx * 1.9 + 3.1));
          q.x += 0.5 * floor(q.y);` : o.slabs ? `q = vec2(along / ${(o.block * 1.6).toFixed(3)}, y / ${(o.course * 0.3).toFixed(3)});
          q.x += h21(vec2(floor(q.y), 7.0));` : `// diaper: a band of big blocks, then two thin slab courses
          float band = y / ${o.course.toFixed(3)}, fb = fract(band);
          if (fb < 0.72) { q = vec2(along / ${o.block.toFixed(3)}, floor(band) + fb / 0.72 * 0.999); q.x += 0.5 * mod(floor(band), 2.0); }
          else { float s = (fb - 0.72) / 0.14; q = vec2(along / ${(o.block * 1.7).toFixed(3)} + 0.37 * floor(s), floor(band) * 3.0 + 7.0 + floor(s) + fract(s) * 0.999); q.x += h21(vec2(floor(q.y), 3.0)); }`}
          jt = min(min(fract(q.x), 1.0 - fract(q.x)) * ${o.block.toFixed(3)}, min(fract(q.y), 1.0 - fract(q.y)) * 0.35) * 6.0;
        }
        vec2 id = floor(q);
        float t = h21(id), t2 = h21(id + 17.0);
        vec3 stone = mix(uC1, uC2, t) * (0.9 + 0.16 * t2);
        stone *= 0.9 + 0.2 * vn(vWP.xz * 0.7 + vWP.y * 0.9);                     // broad weathering
        float joint = smoothstep(0.0, ${o.joint.toFixed(3)}, jt);
        float fw = clamp(1.0 - 1.5 * fwidth(q.y), 0.0, 1.0);                   // joints fade where they are under a pixel
        stone *= mix(1.0, 0.5 + 0.5 * joint, fw);
        if (abs(n.y) > 0.75) stone *= 1.06;                                      // sun-bleached tops
        diffuseColor.rgb *= stone;
      }`);
  };
  m.customProgramCacheKey = () => `masonry-${o.block}-${o.course}-${o.slabs ? 1 : 0}-${o.rubble ? 1 : 0}`;
  return m;
}

export function box(g, w, h, d, m, x = 0, y = 0, z = 0, ry = 0) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y + h / 2, z); o.rotation.y = ry; o.castShadow = o.receiveShadow = true; g.add(o);
  return o;
}
export function cyl(g, rTop, rBot, h, m, x = 0, y = 0, z = 0, seg = 16) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), m);
  o.position.set(x, y + h / 2, z); o.castShadow = o.receiveShadow = true; g.add(o);
  return o;
}
/** A solid of revolution from [[radius, height], ...] bottom to top (stupa drums, domes, umbrellas). */
export function lathe(g, profile, m, x = 0, y = 0, z = 0, seg = 32) {
  const o = new THREE.Mesh(new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), seg), m);
  o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; g.add(o);
  return o;
}
/** `n` boulders (deterministic) within radius `r` of (x, z), seated on the ground; size `s` metres. */
export function rocks(ctx, n, x, z, r, s = 1, m = M.schist, seed = 1) {
  for (let i = 0; i < n; i++) {
    const a = hash(i, seed, 7) * Math.PI * 2, d = Math.sqrt(hash(i, seed, 11)) * r, k = s * (0.5 + hash(i, seed, 13));
    const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    const o = new THREE.Mesh(new THREE.DodecahedronGeometry(k, 0), m);
    o.scale.set(1, 0.6 + hash(i, seed, 17) * 0.4, 1 + hash(i, seed, 19) * 0.5);
    o.rotation.set(hash(i, seed, 23) * 3, hash(i, seed, 29) * 3, 0);
    o.position.set(px, ctx.ground(px, pz) + k * 0.3, pz); o.castShadow = o.receiveShadow = true; ctx.group.add(o);
  }
}
/** Merge every mesh under `g` into one mesh per material (fewer draw calls). Call once, after the static parts. */
export function batch(g) {
  g.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert(), byMat = new Map(), drop = [];
  g.traverse((o) => {
    if (!o.isMesh || o.userData.keep || Array.isArray(o.material)) return;
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(geo.attributes)) if (k !== "position" && k !== "normal") geo.deleteAttribute(k);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    (byMat.get(o.material) || byMat.set(o.material, []).get(o.material)).push(geo);
    drop.push(o);
  });
  for (const o of drop) o.removeFromParent();
  for (const [m, list] of byMat) {
    const mesh = new THREE.Mesh(mergeGeometries(list), m);
    mesh.castShadow = mesh.receiveShadow = true; g.add(mesh);
  }
  return g;
}

export function context(site, lm, group) {
  group.updateMatrixWorld(true);
  const c = Math.cos(group.rotation.y), s = Math.sin(group.rotation.y);
  const world = (x, z) => ({ x: group.position.x + x * c + z * s, z: group.position.z - x * s + z * c });
  const local = (wx, wz) => { const dx = wx - group.position.x, dz = wz - group.position.z; return { x: dx * c - dz * s, z: dx * s + dz * c }; };
  const ground = (x, z) => { const w = world(x, z); return site.heightAt(w.x, w.z) - group.position.y; };
  const ctx = { THREE, site, lm, group, world, local, ground, M, mat, masonry, hash, box, cyl, lathe, batch };
  ctx.rocks = (...a) => rocks(ctx, ...a);
  return ctx;
}
