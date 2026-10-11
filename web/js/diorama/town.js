// Illustrative village houses (web/data/diorama/<site>/town.json, from backend/tools/diorama_town.py): at most one per
// ESA WorldCover 2021 built-up cell where OSM maps no building, kept off roads, rivers, the landmark and steep slopes.
// Their places follow the data; their size, storeys, walls and roofs are illustrative, after visitors' photos of Swat:
// above ~1,250 m dry-stone and timber-banded houses with flat mud roofs, some whitewashed under painted tin; lower
// down plastered or brick houses with flat concrete roofs and a stair room on top. The page lists this in meta.edits.
// houseMaterial() is shared with buildings.js: walls get windows from the uv (u along the wall, v above the floor).
import * as THREE from "three";
import { hash } from "./site.js";

const C = (h) => new THREE.Color(h);
// [walls, plinth, roof, band] per style (see diorama_town.py); arrays are picked per house
const STYLE = [
  { wall: [0x8d8273, 0x857a6b, 0x968a79], plinth: 0x857c6f, roof: [0x7a6a58, 0x6e6252], band: 0x5a4330, flat: true },   // stone, timber bands, mud roof
  { wall: [0xb39a78, 0xa78f70, 0xbba585], plinth: 0x8a8073, roof: [0x8a7a66, 0x7d705e], flat: true },                     // mud plaster
  { wall: [0x958a7b, 0x8b8172], plinth: 0x857c6f, roof: [0x7d8288, 0x8a8e92, 0x6f757c], flat: false },                    // stone, galvanised tin
  { wall: [0xe3ddd0, 0xd8d1c2], plinth: 0x958d80, roof: [0x9e3b2e, 0x3f6e8a, 0x4f7a4a, 0x7d8288], flat: false },           // whitewash, painted tin
  { wall: [0xe8e0cf, 0xd9cdb6, 0xe3d3c4, 0xd2d6c4, 0xe6dcc0], plinth: 0x9a9286, roof: [0xa8a39a, 0x9f9a91], flat: true, room: true }, // plaster
  { wall: [0xa4664c, 0x9a5f47, 0xae7258], plinth: 0x958d80, roof: [0x9e9a92], flat: true, room: true },                    // brick
  { wall: [0xb9b5ad, 0xaeaaa2], plinth: 0x958d80, roof: [0x99958d], flat: true, room: true },                               // concrete
].map((s) => ({ ...s, wall: s.wall.map(C), plinth: C(s.plinth), roof: s.roof.map(C), band: s.band != null ? C(s.band) : null }));

let _mat = null;
/** Vertex-coloured walls with windows drawn from the uv: u (m) along a wall, v (m) above the ground floor; v < 0 has none. */
export function houseMaterial() {
  if (_mat) return _mat;
  _mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 });
  _mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vWin;\nvarying float vUp;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWin = uv;\nvUp = normal.y;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vWin;\nvarying float vUp;")
      .replace("#include <color_fragment>", `#include <color_fragment>
      if (abs(vUp) < 0.5 && vWin.y > 0.0) {
        vec2 c = vec2(vWin.x / 3.4, vWin.y / 2.9), f = fract(c);
        float bay = fract(sin(dot(floor(c), vec2(12.9898, 78.233))) * 43758.5453);   // not every bay has a window
        float win = step(0.36, f.x) * step(f.x, 0.62) * step(0.38, f.y) * step(f.y, 0.74) * step(0.35, bay);
        float fw = clamp(1.0 - 2.5 * max(fwidth(c.x), fwidth(c.y)), 0.0, 1.0);   // fade out where a window is under a pixel
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.045, 0.05, 0.055) + diffuseColor.rgb * 0.12, win * fw * 0.9);
        diffuseColor.rgb *= 1.0 - 0.12 * smoothstep(0.25, 0.0, vWin.y) * fw;     // a little grime at the foot
      }`);
  };
  return _mat;
}

/** Collects quads into flat arrays (non-indexed): position, normal, color, uv. */
class Geo {
  constructor() { this.p = []; this.n = []; this.c = []; this.u = []; }
  quad(a, b, c, d, col, ua, ub, uc, ud) {   // corners counter-clockwise seen from outside
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const [v, uv] of [[a, ua], [b, ub], [c, uc], [a, ua], [c, uc], [d, ud]]) {
      this.p.push(v[0], v[1], v[2]); this.n.push(nx, ny, nz); this.c.push(col.r, col.g, col.b); this.u.push(uv[0], uv[1]);
    }
  }
  tri(a, b, c, col) { this.quad(a, b, c, c, col, [0, -1], [0, -1], [0, -1], [0, -1]); }
  /** A box on the rotated footprint centred at (x, z): half sizes hw (along), hd (across), from y0 to y1.
   *  `floor`: the y of the ground floor for the windows (null = none on this box). */
  box(x, z, cs, sn, hw, hd, y0, y1, col, floor = null, top = col, u0 = 0) {
    const P = (lx, lz, y) => [x + lx * cs - lz * sn, y, z + lx * sn + lz * cs];
    const v = (y) => (floor == null ? -1 : y - floor);
    const sides = [[[-hw, hd], [hw, hd]], [[hw, hd], [hw, -hd]], [[hw, -hd], [-hw, -hd]], [[-hw, -hd], [-hw, hd]]];
    for (const [[ax, az], [bx, bz]] of sides) {
      const L = Math.hypot(bx - ax, bz - az);
      this.quad(P(ax, az, y0), P(bx, bz, y0), P(bx, bz, y1), P(ax, az, y1), col, [u0, v(y0)], [u0 + L, v(y0)], [u0 + L, v(y1)], [u0, v(y1)]);
    }
    const n = [0, -1];
    this.quad(P(-hw, hd, y1), P(hw, hd, y1), P(hw, -hd, y1), P(-hw, -hd, y1), top, n, n, n, n);
  }
  /** A gable roof along the long side: eaves at y0, ridge `rise` higher, overhang included in hw/hd. */
  gable(x, z, cs, sn, hw, hd, y0, rise, col, endCol) {
    const P = (lx, lz, y) => [x + lx * cs - lz * sn, y, z + lx * sn + lz * cs];
    const n = [0, -1];
    this.quad(P(-hw, hd, y0), P(hw, hd, y0), P(hw, 0, y0 + rise), P(-hw, 0, y0 + rise), col, n, n, n, n);
    this.quad(P(hw, -hd, y0), P(-hw, -hd, y0), P(-hw, 0, y0 + rise), P(hw, 0, y0 + rise), col, n, n, n, n);
    this.tri(P(hw, hd, y0), P(hw, -hd, y0), P(hw, 0, y0 + rise), endCol);
    this.tri(P(-hw, -hd, y0), P(-hw, hd, y0), P(-hw, 0, y0 + rise), endCol);
  }
  mesh(mat) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.u, 2));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = m.receiveShadow = true;
    return m;
  }
}

const tint = (c, k) => c.clone().multiplyScalar(k);

/** One house. h = [x, z, w, d, rot_deg, storeys, style]; `i` seeds the variation. */
function house(G, site, h, i) {
  const [x, z, w, d, rot, storeys, style] = h, S = STYLE[style] || STYLE[0];
  const a = THREE.MathUtils.degToRad(rot), cs = Math.cos(a), sn = Math.sin(a), hw = w / 2, hd = d / 2;
  let lo = Infinity, hi = -Infinity;
  for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd], [0, 0]]) {
    const y = site.heightAt(x + lx * cs - lz * sn, z + lx * sn + lz * cs); lo = Math.min(lo, y); hi = Math.max(hi, y);
  }
  const k = 0.92 + 0.16 * hash(i, 3), wall = tint(S.wall[Math.floor(hash(i, 4) * S.wall.length)], k);
  const roof = tint(S.roof[Math.floor(hash(i, 5) * S.roof.length)], 0.94 + 0.12 * hash(i, 6));
  // built into the slope, as hillside houses are: at most 2 m of the back wall below the uphill ground
  const floor = Math.max(lo + 0.35, hi - 2.0), top = floor + storeys * 2.9;
  G.box(x, z, cs, sn, hw + 0.12, hd + 0.12, lo - 0.6, floor, tint(S.plinth, k), null);        // dry-stone footing
  G.box(x, z, cs, sn, hw, hd, floor, top, wall, floor, wall, hash(i, 10) * 40);
  if (S.band) for (let s = 1; s <= storeys; s++) {                                             // timber bands in the stone (upper Swat)
    const y = floor + s * 2.9 - 0.45;
    G.box(x, z, cs, sn, hw + 0.06, hd + 0.06, y, y + 0.22, S.band, null);
  }
  if (S.flat || d > 12) {                                                                     // a wide block has a flat roof
    G.box(x, z, cs, sn, hw + 0.35, hd + 0.35, top, top + 0.3, tint(roof, 0.85), null, roof);   // flat roof, eaves proud of the wall
    if (S.room && hash(i, 7) < 0.45) {                                                           // stair room on the roof (lower Swat)
      const rx = (hash(i, 8) - 0.5) * (w - 3), rz = (hash(i, 9) - 0.5) * (d - 3);
      G.box(x + rx * cs - rz * sn, z + rx * sn + rz * cs, cs, sn, 1.3, 1.2, top + 0.3, top + 2.6, wall, null, roof);
    }
  } else {
    G.box(x, z, cs, sn, hw, hd, top, top + 0.15, wall, null);
    G.gable(x, z, cs, sn, hw + 0.5, hd + 0.6, top + 0.15, 0.9 + d * 0.16, roof, wall);         // tin roof, ridge along the long side
  }
}

/** A hotel OSM maps only as a named point: a three-storey block, whitewashed under a painted tin roof. */
function hotel(G, site, x, z, i) {
  const e = 2, gx = site.heightAt(x + e, z) - site.heightAt(x - e, z), gz = site.heightAt(x, z + e) - site.heightAt(x, z - e);
  const a = Math.hypot(gx, gz) > 0.3 ? Math.atan2(gz, gx) + Math.PI / 2 : hash(i, 2) * Math.PI;
  house(G, site, [x, z, 17, 11, THREE.MathUtils.radToDeg(a), 3, 3], 9000 + i);
}

/** The houses group; it fills when town.json arrives (absent file = nothing). Adds the edit line if meta lacks it. */
export function town(site) {
  const group = new THREE.Group();
  group.name = "town";
  const slug = site.meta.site;
  fetch(new URL(`data/diorama/${slug}/town.json`, location.href)).then((r) => (r.ok ? r.json() : null)).then((t) => {
    if (!t || (!t.houses.length && !t.hotels.length)) return;
    const G = new Geo();
    t.houses.forEach((h, i) => house(G, site, h, i));
    t.hotels.forEach(([, x, z], i) => hotel(G, site, x, z, i));
    group.add(G.mesh(houseMaterial()));
    group.userData.count = t.houses.length + t.hotels.length;
    for (const e of t.edits || []) {
      if (site.meta.edits.includes(e)) continue;                        // a rebuild rewrote meta.json: the page still says so
      site.meta.edits.push(e);
      const ul = document.getElementById("about-edits");
      if (ul) { const li = document.createElement("li"); li.textContent = e; ul.append(li); }
    }
  }).catch((e) => console.warn(`town.json: ${e.message || e}`));
  return group;
}
