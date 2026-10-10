// Pines where WorldCover maps tree cover (broadleaf trees below about 1,700 m, where the lower valleys grow chinar,
// walnut, poplar and orchards; mixed between 1,500 and 1,900 m), shrubs on its shrubland, boulders on bare ground.
// Positions are deterministic; sizes and counts are illustrative (listed in meta.edits).
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

function broadleafGeometry() {
  const trunk = painted(new THREE.CylinderGeometry(0.22, 0.38, 4.2, 5).translate(0, 2.1, 0), L(96, 74, 56));
  const crowns = [[0, 6.4, 0, 3.3], [1.5, 5.4, 0.9, 2.4], [-1.4, 5.6, -0.8, 2.5], [0.3, 8.3, -0.4, 2.2]].map(([x, y, z, r], i) =>
    painted(new THREE.IcosahedronGeometry(r, 0).scale(1, 0.85, 1).translate(x, y, z), (yy) => {
      const t = Math.min(1, Math.max(0, (yy - 3) / 7));
      return L(56 + 40 * t + i * 4, 88 + 40 * t + i * 5, 40 + 18 * t);
    }));
  return mergeGeometries([trunk, ...crowns]);
}
/** Broadleaf below about 1,700 m above sea level, pines above, mixed between 1,500 and 1,900 m. */
const broadleafAt = (altitude, i) => hash(i, 7) < Math.min(1, Math.max(0, (1900 - altitude) / 400));

export function flora(site, path, tier) {
  const g = site.meta.grid, dens = tier === "low" ? 0.45 : 1;
  const clear = new Uint8Array(g.cols * g.rows);          // keep the drivable track clear
  for (let i = 0; i < path.n; i++) {
    const c = Math.round((path.X[i] - site.x0) / g.cell), r = Math.round((path.Z[i] - site.z0) / g.cell);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) clear[(r + dr) * g.cols + c + dc] = 1;
  }
  // A tree budget: dense-forest sites (the White Palace valley is half forest) would otherwise draw 6x Mahodand's trees.
  // Past the budget the forest is thinned evenly and its trees drawn a little larger, so the canopy still reads full.
  let forest = 0;
  for (let i = 0; i < site.C.length; i++) forest += site.C[i] === 1;
  const budget = tier === "low" ? 14000 : 36000, thin = Math.min(1, budget / (forest * 1.4 * dens * 0.95 + 1));
  const grow = Math.min(1.5, 1 / Math.sqrt(thin));
  const pines = [], shrubs = [], rocks = [];
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const i = r * g.cols + c, cov = site.C[i];
    if (clear[i]) continue;
    const h0 = hash(c, r, 11);
    if (cov === 1) {
      const n = h0 < 0.4 ? 2 : 1;
      for (let k = 0; k < n; k++) if (hash(c, r, 20 + k) < dens * 0.95 * thin) pines.push([c + hash(c, r, 30 + k) - 0.5, r + hash(c, r, 40 + k) - 0.5, k]);
    } else if ((cov === 7 && h0 < 0.5 * dens) || (cov === 6 && h0 < 0.08 * dens) || (cov === 2 && h0 < 0.015 * dens)) {
      shrubs.push([c + hash(c, r, 50) - 0.5, r + hash(c, r, 51) - 0.5]);
    } else if ((cov === 3 && h0 < 0.07 * dens) || (cov === 2 && h0 > 1 - 0.006 * dens)) {
      rocks.push([c + hash(c, r, 60) - 0.5, r + hash(c, r, 61) - 0.5]);
    }
  }
  const group = new THREE.Group();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);

  // pines in 800 m tiles, so the main and shadow passes skip what is off screen
  const pineGeo = pineGeometry(), pineMat = seasonize(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), "pine");
  const leafGeo = broadleafGeometry(), leafMat = seasonize(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }), "shrub");
  const TILE = 800 / g.cell, tiles = new Map();
  pines.forEach((p, i) => {
    const x = site.x0 + p[0] * g.cell, z = site.z0 + p[1] * g.cell, leaf = broadleafAt(site.heightAt(x, z) + site.Y0, i);
    const key = (leaf ? "b" : "p") + Math.floor(p[0] / TILE) + "," + Math.floor(p[1] / TILE);
    (tiles.get(key) || tiles.set(key, []).get(key)).push(i);
  });
  const pineMeshes = [];
  for (const [key, ids] of tiles) {
    const mesh = new THREE.InstancedMesh(key[0] === "b" ? leafGeo : pineGeo, key[0] === "b" ? leafMat : pineMat, ids.length);
    ids.forEach((i, j) => {
      const [c, r] = pines[i];
      const x = site.x0 + c * g.cell, z = site.z0 + r * g.cell;
      const sz = (1.05 + 0.85 * hash(i, 3)) * grow;
      // the DSM is the canopy top in forest, so the trees are set down into it by part of their height
      v.set(x, site.heightAt(x, z) - 7.5 * sz * 0.55, z);
      q.setFromAxisAngle(up, hash(i, 4) * 6.28);
      s.set(sz * (0.85 + 0.3 * hash(i, 5)), sz, sz * (0.85 + 0.3 * hash(i, 5)));
      mesh.setMatrixAt(j, m.compose(v, q, s));
      mesh.setColorAt(j, col.setScalar(0.82 + 0.36 * hash(i, 6)));
    });
    mesh.computeBoundingSphere();
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh); pineMeshes.push(mesh);
  }

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
  group.userData.counts = { trees: pines.length, shrubs: shrubs.length, rocks: rocks.length };
  return group;
}
