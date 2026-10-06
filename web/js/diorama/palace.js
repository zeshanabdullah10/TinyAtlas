// The White Palace (Marghazar) and its grounds, illustrative, laid out after visitors' photos (not a survey; OSM maps
// no footprint): a white two-storey house, a gabled upper floor over a columned veranda with an arched door and front
// steps; long one-storey cream wings with verandas at the sides; a lawn in front with hedges, flower beds, marble
// table-and-bench sets on brick pads and a metal arch; tall pines and broadleaf trees around; the flag on the ridge.
import * as THREE from "three";

const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });
const white = M(0xf4f1ea, { roughness: 0.45 }), cream = M(0xeee4c8), dark = M(0x2e2a26, { roughness: 0.9 }),
  glass = M(0x5c6a70, { roughness: 0.3 }), roofY = M(0xd8c26a), roofG = M(0x9a9a92), lawnM = M(0x5d8c34, { roughness: 1 }),
  hedge = M(0x2f5a22, { roughness: 1 }), brick = M(0x9a5a44, { roughness: 1 }), bark = M(0x5a4030, { roughness: 1 }),
  pine = M(0x2b4a2a, { roughness: 1 }), leaf = M(0x4f7a32, { roughness: 1 }), metal = M(0xe8e8e8, { metalness: 0.4 }),
  flagG = M(0x0f5c2e, { side: THREE.DoubleSide }), flagW = M(0xffffff, { side: THREE.DoubleSide });
const flowers = [0xf08a24, 0xd9343a, 0xf2c335, 0xe5689c].map((c) => M(c, { roughness: 1 }));

function box(g, w, h, d, m, x, y, z, ry = 0) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y + h / 2, z); o.rotation.y = ry; o.castShadow = o.receiveShadow = true; g.add(o);
  return o;
}
function cyl(g, r, h, m, x, y, z, seg = 10) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);
  o.position.set(x, y + h / 2, z); o.castShadow = true; g.add(o);
  return o;
}
/** A gable: a triangular prism, ridge along z, `w` wide at the eaves, `h` high, `d` deep. */
function gable(g, w, h, d, m, x, y, z) {
  const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.closePath();
  const o = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }), m);
  o.position.set(x, y, z - d / 2); o.castShadow = o.receiveShadow = true; g.add(o);
  return o;
}

function house(g) {
  // ground floor: 22 x 14, its front a 3 m veranda with eight columns under a flat roof and a low pediment
  box(g, 22, 1.2, 15, white, 0, 0, 0);                           // marble base, front steps cut in below
  box(g, 22, 4.2, 11, white, 0, 1.2, -2);
  for (let i = 0; i < 8; i++) cyl(g, 0.28, 3.8, white, -10 + (20 * i) / 7, 1.2, 4.8);
  box(g, 22.6, 0.5, 15.2, white, 0, 5.0, 0);                     // veranda roof slab
  box(g, 23, 0.25, 15.6, roofY, 0, 5.5, 0);                     // the yellow eave seen in photos
  gable(g, 11, 1.6, 0.6, white, 0, 5.5, 7.4);                    // pediment over the door, crest on top
  box(g, 1.6, 1.1, 0.3, cream, 0, 5.8, 7.6);
  box(g, 2.6, 3.0, 0.2, dark, 0, 1.2, 3.0);                       // the arched door
  const a = new THREE.Mesh(new THREE.CircleGeometry(1.3, 16, 0, Math.PI), dark); a.position.set(0, 4.2, 3.12); g.add(a);
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) box(g, 1.6, 1.8, 0.2, glass, sx * (4 + i * 2.6), 2.2, 3.0);
  for (let i = 0; i < 5; i++) box(g, 4.6 - i * 0.1, 0.24, 0.6, white, 0, 1.2 - (i + 1) * 0.24, 7.5 + i * 0.6);   // steps
  for (const sx of [-1, 1]) box(g, 8, 0.9, 0.12, white, sx * 6.5, 1.2, 7.3);                      // veranda rail
  // upper floor: 16 wide, a low-pitched gable facing the lawn, a band of windows under it
  box(g, 16, 3.6, 10, white, 0, 5.75, -2.5);
  for (let i = -2; i <= 2; i++) box(g, 1.5, 1.6, 0.2, glass, i * 3, 6.7, 2.55);
  gable(g, 16.8, 3.2, 11, white, 0, 9.35, -2.5);
  const roof = new THREE.Group(); roof.position.set(0, 9.35, -2.5); g.add(roof);
  for (const sx of [-1, 1]) {
    const r = box(roof, 9.6, 0.25, 11.4, roofG, sx * 4.2, 1.45, 0); r.rotation.z = -sx * Math.atan2(3.2, 8.4);
  }
  box(g, 3.2, 1.0, 0.2, glass, 0, 10.0, 3.05);                    // the attic window
  cyl(g, 0.07, 6, metal, 0, 12.5, -2.5, 6);                        // flag on the ridge
  box(g, 2.2, 1.5, 0.04, flagG, 1.5, 16.9, -2.5); box(g, 0.6, 1.5, 0.05, flagW, 0.1, 16.9, -2.5);
}

function wing(g, len, x, z, ry) {                                  // one storey, cream, a veranda and railing on the lawn side
  const w = new THREE.Group(); w.position.set(x, 0, z); w.rotation.y = ry; g.add(w);
  box(w, 7, 3.8, len, cream, 0, 0.6, 0);
  box(w, 3, 0.6, len, white, 4.6, 0, 0);
  for (let i = 0; i <= len / 3; i++) cyl(w, 0.16, 3.2, white, 5.9, 0.6, -len / 2 + i * 3, 6);
  box(w, 0.1, 0.9, len, white, 6.0, 0.6, 0);
  box(w, 11, 0.3, len + 1, roofY, 1.2, 4.4, 0);
  for (let i = 0; i < len / 3 - 1; i++) box(w, 0.15, 1.6, 1.2, glass, 3.55, 1.6, -len / 2 + 2 + i * 3);
}

function tableSet(g, x, z, ry) {
  const s = new THREE.Group(); s.position.set(x, 0, z); s.rotation.y = ry; g.add(s);
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 0.08, 6), brick); pad.receiveShadow = true; pad.position.y = 0.04; s.add(pad);
  box(s, 2.6, 0.12, 1.4, white, 0, 0.82, 0);
  for (const [a, b] of [[-1.1, -0.5], [1.1, -0.5], [-1.1, 0.5], [1.1, 0.5]]) box(s, 0.18, 0.78, 0.18, white, a, 0.04, b);
  for (const zz of [-1.5, 1.5]) { box(s, 2.4, 0.1, 0.5, white, 0, 0.45, zz); for (const xx of [-1, 1]) box(s, 0.16, 0.4, 0.4, white, xx, 0.04, zz); }
  box(s, 1.6, 0.1, 0.6, white, 2.6, 0.48, 0.2, Math.PI / 2);      // the carved settee
  box(s, 0.12, 0.9, 1.6, white, 2.95, 0.5, 0.2);
}

function tree(g, x, z, h, kind, k) {
  const t = new THREE.Group(); t.position.set(x, 0, z); g.add(t);
  cyl(t, 0.25 + h * 0.012, h * 0.55, bark, 0, 0, 0, 6);
  if (kind === "pine") for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(h * (0.22 - i * 0.05), h * 0.4, 8), pine);
    c.position.y = h * (0.45 + i * 0.2); c.castShadow = true; t.add(c);
  } else for (let i = 0; i < 4; i++) {
    const c = new THREE.Mesh(new THREE.IcosahedronGeometry(h * (0.22 + 0.04 * Math.sin(k + i)), 0), leaf);
    c.position.set(Math.cos(k * 3 + i * 1.7) * h * 0.15, h * (0.6 + 0.1 * (i % 2)), Math.sin(k * 3 + i * 1.7) * h * 0.15);
    c.castShadow = true; t.add(c);
  }
}

export function palace(site, lm, face) {
  const y = site.heightAt(lm.x, lm.z);
  const g = new THREE.Group();
  g.position.set(lm.x, y - 0.05, lm.z);
  g.rotation.y = Math.atan2(face.x - lm.x, face.z - lm.z);        // the lawn and the front (+z) face the road
  const lawn = new THREE.Mesh(new THREE.BoxGeometry(76, 1.2, 74), lawnM);
  lawn.position.set(0, -0.6, 14); lawn.receiveShadow = true; g.add(lawn);
  house(g);
  wing(g, 34, 20, 22, Math.PI);                                    // the long wing on the right of the lawn
  wing(g, 18, -19, 10, 0);                                         // and a shorter one on the left
  // hedges, beds, the path from the steps
  box(g, 3, 0.03, 30, M(0xb9a88a, { roughness: 1 }), 0, 0, 25);
  for (const sx of [-1, 1]) {
    box(g, 12, 0.9, 1, hedge, sx * 8, 0, 11);
    for (let i = 0; i < 10; i++) box(g, 0.7, 0.5, 0.7, flowers[i % 4], sx * (3 + i * 1.1), 0.2, 12.2);
  }
  box(g, 70, 0.5, 0.5, hedge, 0, 0, 50.5);                         // the low hedge and stones along the front
  tableSet(g, -8, 32, 0.2); tableSet(g, 9, 34, -0.3); tableSet(g, 11, 18, 0.5);
  {                                                                // the white metal arch over the right walk
    const arch = new THREE.Group(); arch.position.set(13, 0, 20); g.add(arch);
    for (const sx of [-1.4, 1.4]) for (const sz of [-1, 1]) cyl(arch, 0.08, 3.2, metal, sx, 0, sz, 6);
    for (const sz of [-1, 1]) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.07, 6, 18, Math.PI), metal); t.position.set(0, 3.2, sz); arch.add(t);
    }
  }
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) cyl(g, 0.08, 2.4, metal, sx * (5 + i * 9), 0, 13 + i * 9, 6);   // lamps
  // trees around the grounds and on the slope behind
  const spots = [[-32, 0, 22, "pine"], [-30, 26, 16, "leaf"], [-34, 44, 14, "leaf"], [32, 46, 15, "leaf"], [-24, -14, 20, "pine"],
    [26, -12, 18, "leaf"], [8, -18, 24, "pine"], [-10, -20, 18, "leaf"], [-36, -24, 22, "pine"], [36, -26, 20, "pine"],
    [-12, 40, 9, "pine"], [30, 6, 13, "leaf"], [-28, 12, 12, "leaf"], [20, -30, 22, "leaf"], [-2, -32, 26, "pine"]];
  spots.forEach(([x, z, h, k], i) => tree(g, x, z, h, k, i));
  g.userData.top = y + 17;
  return g;
}
