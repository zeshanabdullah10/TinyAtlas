// Buildings on their OSM footprints (meta.buildings, from the build). The footprint is mapped; the height (OSM
// levels where tagged, else one or two storeys, three for the big hotel blocks), roof and colours are illustrative,
// after visitors' photos of Kalam and Ushu: pale plaster or rubble-stone walls, flat tin roofs, red and blue roofs on
// the larger hotels.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { hash } from "./site.js";
import { town, houseMaterial } from "./town.js";

const WALLS = [0xe8e2d4, 0xd9cfbd, 0x8d8273, 0x86745c].map((c) => new THREE.Color(c));
const TIN = [0x786e5f, 0x5a6b7a, 0x8a8478].map((c) => new THREE.Color(c));
const HOTEL = [0xb03a2e, 0x5a6b7a, 0x2f6e8c, 0x786e5f].map((c) => new THREE.Color(c));

function area(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; }

/** The footprint extruded from y0 up by h. Walls carry uv = (metres along the wall, metres above `floor`) for the
 *  windows of houseMaterial(); floor = null draws none (roofs, eaves). */
function prism(pts, y0, h, color, floor = null) {
  const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  let g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); g.translate(0, y0, 0);
  g = g.index ? g.toNonIndexed() : g;
  const P = g.attributes.position, N = g.attributes.normal, n = P.count, c = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    c.set([color.r, color.g, color.b], i * 3);
    // along the wall: the horizontal coordinate the wall runs along (x for a wall facing z, z for one facing x)
    const side = Math.abs(N.getY(i)) < 0.5;
    uv[i * 2] = Math.abs(N.getX(i)) > Math.abs(N.getZ(i)) ? P.getZ(i) : P.getX(i);
    uv[i * 2 + 1] = side && floor != null ? P.getY(i) - floor : -1;
  }
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return g;
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
    geos.push(prism(pts, lo - 1.5, hi + 0.3 - lo + 1.5, wall.clone().multiplyScalar(0.78)));      // footing, darker
    geos.push(prism(pts, hi + 0.3, top - hi - 0.3, wall, hi + 0.3));
    geos.push(prism(grow(pts, 0.6), top, 0.35, roof));
  }
  const group = new THREE.Group();
  group.add(town(site));                            // illustrative houses on WorldCover built-up land without OSM buildings
  if (!geos.length) return group;
  const mesh = new THREE.Mesh(mergeGeometries(geos), houseMaterial());
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  group.userData.count = geos.length / 3;
  return group;
}
