// Buildings on their OSM footprints (meta.buildings, from the build). The footprint is mapped; the height (OSM
// levels where tagged, else one or two storeys, three for the big hotel blocks), roof and colours are illustrative,
// after visitors' photos of Kalam and Ushu: pale plaster or rubble-stone walls, flat tin roofs, red and blue roofs on
// the larger hotels.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { hash } from "./site.js";

const WALLS = [0xe8e2d4, 0xd9cfbd, 0x7d7468, 0x6b5a45].map((c) => new THREE.Color(c));
const TIN = [0x786e5f, 0x5a6b7a, 0x8a8478].map((c) => new THREE.Color(c));
const HOTEL = [0xb03a2e, 0x5a6b7a, 0x2f6e8c, 0x786e5f].map((c) => new THREE.Color(c));

function area(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; }

function prism(pts, y0, h, color) {
  const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); g.translate(0, y0, 0);
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set([color.r, color.g, color.b], i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return g.index ? g.toNonIndexed() : g;
}
/** The footprint pushed out by `d` metres from its centre (roof eaves). */
function grow(pts, d) {
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  return pts.map(([x, z]) => { const l = Math.hypot(x - cx, z - cz) || 1; return [x + ((x - cx) / l) * d, z + ((z - cz) / l) * d]; });
}

export function buildings(site) {
  const list = site.meta.buildings || [], geos = [];
  for (const b of list) {
    const pts = b.pts, A = Math.abs(area(pts));
    if (A < 8) continue;
    const r = hash(b.id % 100000, b.id >>> 17);
    const floors = b.levels || (A > 260 ? 3 : r < 0.55 ? 1 : 2);
    const ys = pts.map(([x, z]) => site.heightAt(x, z)), lo = Math.min(...ys), hi = Math.max(...ys);
    const top = hi + floors * 3.0;
    const big = A > 260 || floors >= 3;
    const wall = WALLS[Math.floor(hash(b.id, 7) * (big ? 2 : WALLS.length))];
    const roof = (big ? HOTEL : TIN)[Math.floor(hash(b.id, 11) * (big ? HOTEL.length : TIN.length))];
    geos.push(prism(pts, lo - 1.5, top - lo + 1.5, wall));
    geos.push(prism(grow(pts, 0.6), top, 0.35, roof));
  }
  const group = new THREE.Group();
  if (!geos.length) return group;
  const mesh = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  group.userData.count = geos.length / 2;
  return group;
}
