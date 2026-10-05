// Pines where WorldCover maps tree cover, shrubs on its shrubland, boulders on bare ground. Positions are deterministic;
// sizes and counts are illustrative (listed in meta.edits).
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { hash } from "./site.js";
import { seasonize } from "./season.js";

function painted(geo, rgb) {
  const g = geo.index ? geo.toNonIndexed() : geo, n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const y = g.attributes.position.getY(i);
    const k = typeof rgb === "function" ? rgb(y) : rgb;
    c.set(k, i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  if (g.attributes.uv) g.deleteAttribute("uv");
  return g;
}
const L = (r, g, b) => [r, g, b].map((v) => Math.pow(v / 255, 2.2));

function pineGeometry() {
  const trunk = painted(new THREE.CylinderGeometry(0.18, 0.32, 3.2, 5).translate(0, 1.6, 0), L(92, 64, 44));
  const tiers = [[2.7, 5.2, 2.4], [2.1, 4.6, 4.9], [1.45, 4.0, 7.2], [0.8, 3.0, 9.4]].map(([r, h, y], i) =>
    painted(new THREE.ConeGeometry(r, h, 7, 1).translate(0, y + h / 2, 0), (yy) => {
      const t = (yy - y) / h;
      return L(38 + 30 * t + i * 6, 74 + 34 * t + i * 6, 64 + 20 * t);
    }));
  return mergeGeometries([trunk, ...tiers]);
}

export function flora(site, path, tier) {
  const g = site.meta.grid, dens = tier === "low" ? 0.45 : 1;
  const clear = new Uint8Array(g.cols * g.rows);          // keep the drivable track clear
  for (let i = 0; i < path.n; i++) {
    const c = Math.round((path.X[i] - site.x0) / g.cell), r = Math.round((path.Z[i] - site.z0) / g.cell);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) clear[(r + dr) * g.cols + c + dc] = 1;
  }
  const pines = [], shrubs = [], rocks = [];
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const i = r * g.cols + c, cov = site.C[i];
    if (clear[i]) continue;
    const h0 = hash(c, r, 11);
    if (cov === 1) {
      const n = h0 < 0.4 ? 2 : 1;
      for (let k = 0; k < n; k++) if (hash(c, r, 20 + k) < dens * 0.95) pines.push([c + hash(c, r, 30 + k) - 0.5, r + hash(c, r, 40 + k) - 0.5, k]);
    } else if ((cov === 7 && h0 < 0.5 * dens) || (cov === 6 && h0 < 0.08 * dens) || (cov === 2 && h0 < 0.015 * dens)) {
      shrubs.push([c + hash(c, r, 50) - 0.5, r + hash(c, r, 51) - 0.5]);
    } else if ((cov === 3 && h0 < 0.07 * dens) || (cov === 2 && h0 > 1 - 0.006 * dens)) {
      rocks.push([c + hash(c, r, 60) - 0.5, r + hash(c, r, 61) - 0.5]);
    }
  }
  const group = new THREE.Group();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);

  const pineMesh = new THREE.InstancedMesh(pineGeometry(), seasonize(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), "pine"), pines.length);
  pines.forEach(([c, r, k], i) => {
    const x = site.x0 + c * g.cell, z = site.z0 + r * g.cell;
    const sz = 1.05 + 0.85 * hash(i, 3);
    // the DSM is the canopy top in forest, so the trees are set down into it by part of their height
    v.set(x, site.heightAt(x, z) - 7.5 * sz * 0.55, z);
    q.setFromAxisAngle(up, hash(i, 4) * 6.28);
    s.set(sz * (0.85 + 0.3 * hash(i, 5)), sz, sz * (0.85 + 0.3 * hash(i, 5)));
    pineMesh.setMatrixAt(i, m.compose(v, q, s));
    pineMesh.setColorAt(i, col.setScalar(0.82 + 0.36 * hash(i, 6)));
  });
  pineMesh.castShadow = true; pineMesh.receiveShadow = true;
  group.add(pineMesh);

  const shrubGeo = painted(new THREE.IcosahedronGeometry(1, 0).scale(1, 0.7, 1), L(104, 124, 56));
  const shrubMesh = new THREE.InstancedMesh(shrubGeo, seasonize(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }), "shrub"), shrubs.length);
  shrubs.forEach(([c, r], i) => {
    const x = site.x0 + c * g.cell, z = site.z0 + r * g.cell, sz = 0.8 + 1.4 * hash(i, 8);
    v.set(x, site.heightAt(x, z) + 0.2 * sz, z);
    q.setFromAxisAngle(up, hash(i, 9) * 6.28);
    shrubMesh.setMatrixAt(i, m.compose(v, q, s.set(sz, sz, sz)));
    shrubMesh.setColorAt(i, col.setRGB(0.8 + 0.4 * hash(i, 10), 0.85 + 0.3 * hash(i, 11), 0.8));
  });
  shrubMesh.castShadow = true;
  group.add(shrubMesh);

  const rockMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0),
    seasonize(new THREE.MeshStandardMaterial({ color: 0xa69582, roughness: 0.95, flatShading: true }), "rock"), rocks.length);
  rocks.forEach(([c, r], i) => {
    const x = site.x0 + c * g.cell, z = site.z0 + r * g.cell, sz = 0.7 + 2.6 * hash(i, 12) ** 2;
    v.set(x, site.heightAt(x, z) + 0.15 * sz, z);
    q.setFromEuler(new THREE.Euler(hash(i, 13) * 0.6, hash(i, 14) * 6.28, hash(i, 15) * 0.6));
    rockMesh.setMatrixAt(i, m.compose(v, q, s.set(sz * 1.2, sz * 0.7, sz)));
    rockMesh.setColorAt(i, col.setScalar(0.8 + 0.35 * hash(i, 16)));
  });
  rockMesh.castShadow = true; rockMesh.receiveShadow = true;
  group.add(rockMesh);
  // grass tufts along the track, where you can see them from the jeep
  const blades = [];
  for (let k = 0; k < 7; k++) {                       // thin leaning blades, darker at the root
    const a = (k / 7) * 6.28 + hash(k, 90), lean = 0.12 + 0.18 * hash(k, 91), h = 0.35 + 0.35 * hash(k, 92), w = 0.045;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, lean * 0.2, h, lean], 3));
    g.computeVertexNormals();
    blades.push(painted(g.rotateY(a), (y) => L(70 + 190 * y, 92 + 150 * y, 34 + 40 * y)));
  }
  const tuftGeo = mergeGeometries(blades);
  const tufts = [];
  for (let i = 0; i < path.n; i += 1) for (let k = 0; k < (tier === "low" ? 4 : 9); k++) {
    const side = hash(i, k, 70) < 0.5 ? -1 : 1, off = side * (2.5 + 26 * hash(i, k, 71) ** 1.6);
    const tx = path.X[Math.min(i + 1, path.n - 1)] - path.X[Math.max(i - 1, 0)], tz = path.Z[Math.min(i + 1, path.n - 1)] - path.Z[Math.max(i - 1, 0)];
    const d = Math.hypot(tx, tz) || 1, x = path.X[i] - (tz / d) * off + (hash(i, k, 72) - 0.5) * 4, z = path.Z[i] + (tx / d) * off + (hash(i, k, 73) - 0.5) * 4;
    const cov = site.coverAt(x, z);
    if (cov === 2 || cov === 6 || cov === 7 || cov === 1) tufts.push([x, z]);
  }
  const tuftMesh = new THREE.InstancedMesh(tuftGeo, seasonize(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide, alphaTest: 0.5 }), "shrub"), tufts.length);
  tufts.forEach(([x, z], i) => {
    const sz = 0.7 + 1.1 * hash(i, 80);
    v.set(x, site.heightAt(x, z) - 0.05, z);
    q.setFromAxisAngle(up, hash(i, 81) * 6.28);
    tuftMesh.setMatrixAt(i, m.compose(v, q, s.set(sz, sz * (0.7 + 0.8 * hash(i, 82)), sz)));
    tuftMesh.setColorAt(i, col.setRGB(0.85 + 0.3 * hash(i, 83), 0.85 + 0.25 * hash(i, 84), 0.75));
  });
  group.add(tuftMesh);
  group.userData.tufts = tuftMesh;
  group.userData.counts = { pines: pines.length, shrubs: shrubs.length, rocks: rocks.length };
  return group;
}
