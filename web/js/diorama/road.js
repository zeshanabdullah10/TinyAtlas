// The jeep track: the drivable path (OSM line, smoothed), its surface (real grade + illustrative ruts, potholes and
// stones), and the ribbons that draw it. The same bump() feeds the ribbon mesh and the jeep's wheels, so every pothole
// you see is one you feel.
import * as THREE from "three";
import { hash } from "./site.js";
import { seasonize } from "./season.js";

export const HALF_W = 2.3;        // half width of the drawn track, metres
const LIFT = 0.3;                 // the track surface sits this far above the 10 m terrain mesh, which cannot hold its ruts

function vnoise(t, seed) {
  const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
  return (hash(i, seed) * (1 - u) + hash(i + 1, seed) * u) * 2 - 1;
}

/** Feature list per 5 m cell: potholes (negative) and stones (positive). */
function feature(k) {
  const r = hash(k, 7);
  if (r > 0.62) return null;
  return {
    s: (k + hash(k, 1)) * 5, l: (hash(k, 2) - 0.5) * 3.0, rad: 0.45 + 0.75 * hash(k, 3),
    d: r < 0.4 ? -(0.07 + 0.17 * hash(k, 4)) : 0.05 + 0.11 * hash(k, 4),
  };
}

/** Surface offset (metres) above the smoothed track profile at distance s along it and lateral offset l. */
export function bump(s, l) {
  const a = Math.abs(l);
  let y = 0.05 * (1 - (l / HALF_W) ** 2);                                  // crown
  y -= 0.07 * Math.exp(-(((a - 0.78) / 0.24) ** 2));                       // the two worn ruts
  y += 0.13 * vnoise(s / 13, 3) + 0.05 * vnoise(s / 4.5, 5);               // rolling and short undulation
  y += 0.012 * Math.sin(s * 7.1) * (0.5 + 0.5 * vnoise(s / 30, 9));        // washboard
  const k0 = Math.floor(s / 5);
  for (let k = k0 - 1; k <= k0 + 1; k++) {
    const f = feature(k);
    if (!f) continue;
    const d2 = ((s - f.s) ** 2 + (l - f.l) ** 2) / (f.rad * f.rad);
    if (d2 < 9) y += f.d * Math.exp(-d2 * 2);
  }
  return y * (1 - Math.max(0, (a - 1.9) / 0.6) * 0.7);
}

export class Path {
  constructor(drive, y0 = 0) {
    const n = drive.length, W = 0;   // the build already smoothed the line and cut the bench along it
    this.X = new Float32Array(n); this.Z = new Float32Array(n); this.Y = new Float32Array(n); this.S = new Float32Array(n);
    for (let i = 0; i < n; i++) {                     // moving average rounds the OSM corners into drivable curves
      let sx = 0, sz = 0, c = 0;
      for (let j = Math.max(0, i - W); j <= Math.min(n - 1, i + W); j++) { sx += drive[j][0]; sz += drive[j][1]; c++; }
      this.X[i] = sx / c; this.Z[i] = sz / c; this.Y[i] = drive[i][2] - y0 + LIFT;
      if (i) this.S[i] = this.S[i - 1] + Math.hypot(this.X[i] - this.X[i - 1], this.Z[i] - this.Z[i - 1]);
    }
    this.length = this.S[n - 1];
    this.n = n;
  }
  /** Position, unit tangent and grade at distance s. */
  at(s, out = {}) {
    s = Math.min(Math.max(s, 0), this.length);
    let lo = 0, hi = this.n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.S[m] > s) hi = m; else lo = m; }
    const L = this.S[hi] - this.S[lo] || 1, t = (s - this.S[lo]) / L;
    out.x = this.X[lo] + (this.X[hi] - this.X[lo]) * t;
    out.z = this.Z[lo] + (this.Z[hi] - this.Z[lo]) * t;
    out.y = this.Y[lo] + (this.Y[hi] - this.Y[lo]) * t;
    // tangent over a 12 m window keeps the heading steady through the polyline joints
    const a = Math.max(lo - 1, 0), b = Math.min(hi + 1, this.n - 1);
    const dx = this.X[b] - this.X[a], dz = this.Z[b] - this.Z[a], d = Math.hypot(dx, dz) || 1;
    out.tx = dx / d; out.tz = dz / d;
    out.grade = (this.Y[b] - this.Y[a]) / (this.S[b] - this.S[a] || 1);
    return out;
  }
  /** Road surface height at (s, lateral offset); lateral is to the driver's right. */
  surface(s, l) { return this.at(s, tmp).y + bump(s, l); }
  /** World point at (s, l). */
  point(s, l, out = new THREE.Vector3()) {
    const p = this.at(s, tmp);
    return out.set(p.x - p.tz * l, p.y + bump(s, l), p.z + p.tx * l);
  }
}
const tmp = {};

const ROAD_GLSL = /* glsl */ `
float rh(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float rn(vec2 x) { vec2 i = floor(x), f = fract(x), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(rh(i), rh(i + vec2(1, 0)), u.x), mix(rh(i + vec2(0, 1)), rh(i + vec2(1, 1)), u.x), u.y); }`;

function roadMaterial(edgeFade) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  m.customProgramCacheKey = () => (edgeFade ? "dio-road" : "dio-track");
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 aRoad; varying vec2 vRoad;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRoad = aRoad;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec2 vRoad;\n${ROAD_GLSL}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
  float l = vRoad.x, s = vRoad.y, a = abs(l);
  float g = rn(vec2(l * 9.0, s * 9.0)) * 0.55 + rn(vec2(l * 2.3, s * 2.3)) * 0.45;
  vec3 dirt = mix(vec3(0.56, 0.44, 0.31), vec3(0.74, 0.62, 0.45), g);
  float rut = exp(-pow((a - 0.78) / 0.2, 2.0));
  dirt = mix(dirt, vec3(0.42, 0.33, 0.24), rut * 0.55);
  float pebble = step(0.86, rh(floor(vec2(l * 14.0, s * 14.0))));
  dirt = mix(dirt, vec3(0.83, 0.78, 0.68), pebble * 0.6 * (1.0 - rut));
  float grassMid = smoothstep(0.35, 0.0, a) * 0.35 * smoothstep(0.4, 0.8, rn(vec2(s * 0.6, 3.0)));
  dirt = mix(dirt, vec3(0.45, 0.52, 0.22), grassMid);
  diffuseColor.rgb = dirt;
  diffuseColor.a = ${edgeFade ? "1.0 - smoothstep(1.75, 2.3, a + (rn(vec2(s * 1.7, l)) - 0.5) * 0.5)" : "1.0 - smoothstep(1.3, 2.0, a)"};`);
  };
  return m;
}

/** The drivable stretch, displaced by bump() so the surface matches the ride. */
export function driveRibbon(path, step = 0.5, across = 13) {
  const ns = Math.ceil(path.length / step) + 1;
  const pos = new Float32Array(ns * across * 3), road = new Float32Array(ns * across * 2);
  const v = new THREE.Vector3();
  for (let i = 0; i < ns; i++) {
    const s = Math.min(i * step, path.length);
    for (let j = 0; j < across; j++) {
      const l = -HALF_W + (2 * HALF_W * j) / (across - 1), k = i * across + j;
      path.point(s, l, v);
      pos.set([v.x, v.y + 0.05, v.z], k * 3);
      road.set([l, s], k * 2);
    }
  }
  return ribbonMesh(pos, road, ns, across, seasonize(roadMaterial(true), "ground"));
}

/** The rest of the OSM track (before and beyond the drive), draped on the terrain. */
export function trackRibbons(site, path) {
  const out = [], pts = site.meta.track;
  const nearDrive = (x, z) => {
    for (let i = 0; i < path.n; i += 2) if ((path.X[i] - x) ** 2 + (path.Z[i] - z) ** 2 < 100) return true;
    return false;
  };
  let run = [];
  const flush = () => { if (run.length > 2) out.push(run); run = []; };
  for (const p of pts) { if (nearDrive(p[0], p[1])) flush(); else run.push(p); }
  flush();
  const meshes = [];
  for (const r of out) {
    const across = 5, n = r.length;
    const pos = new Float32Array(n * across * 3), road = new Float32Array(n * across * 2);
    let s = 0;
    for (let i = 0; i < n; i++) {
      const a = r[Math.max(i - 1, 0)], b = r[Math.min(i + 1, n - 1)];
      const dx = b[0] - a[0], dz = b[1] - a[1], d = Math.hypot(dx, dz) || 1;
      if (i) s += Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]);
      for (let j = 0; j < across; j++) {
        const l = -2 + j, x = r[i][0] - (dz / d) * l, z = r[i][1] + (dx / d) * l, k = i * across + j;
        pos.set([x, site.heightAt(x, z) + 0.6, z], k * 3);
        road.set([l, s], k * 2);
      }
    }
    meshes.push(ribbonMesh(pos, road, n, across, seasonize(roadMaterial(false), "ground")));
  }
  return meshes;
}

/** The foot route from the trailhead to the shore (meta.walk): a narrow worn path, mapped and traced parts alike. */
export function trailRibbon(site) {
  const r = site.meta.walk?.pts;
  if (!r || r.length < 3) return [];
  const across = 3, n = r.length, pos = new Float32Array(n * across * 3), road = new Float32Array(n * across * 2);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const a = r[Math.max(i - 1, 0)], b = r[Math.min(i + 1, n - 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], d = Math.hypot(dx, dz) || 1;
    if (i) s += Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]);
    for (let j = 0; j < across; j++) {
      const l = (j - 1) * 0.7, x = r[i][0] - (dz / d) * l, z = r[i][1] + (dx / d) * l, k = i * across + j;
      pos.set([x, site.heightAt(x, z) + 0.35, z], k * 3);
      road.set([l * 2, s], k * 2);
    }
  }
  return [ribbonMesh(pos, road, n, across, seasonize(roadMaterial(false), "ground"))];
}

function ribbonMesh(pos, road, ns, across, mat) {
  const idx = [];
  for (let i = 0; i < ns - 1; i++) for (let j = 0; j < across - 1; j++) {
    const a = i * across + j, b = a + 1, c = a + across, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aRoad", new THREE.BufferAttribute(road, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  return mesh;
}

/** Small stones where bump() puts a stone, so the bumps have a cause you can see. */
export function roadStones(path) {
  const list = [];
  for (let k = 0; k < path.length / 5; k++) {
    const f = feature(k);
    if (f && f.d > 0) list.push(f);
  }
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x9c8f7d, roughness: 0.9, flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  list.forEach((f, i) => {
    path.point(f.s, f.l, v);
    v.y -= f.d * 0.4;
    q.setFromEuler(new THREE.Euler(hash(i, 1) * 3, hash(i, 2) * 3, hash(i, 3) * 3));
    sc.set(f.rad * 0.55, f.d * 1.6, f.rad * 0.45);
    mesh.setMatrixAt(i, m.compose(v, q, sc));
  });
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}
