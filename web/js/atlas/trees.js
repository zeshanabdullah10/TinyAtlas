// Individual conifers: per-chunk InstancedMesh (3 low-poly stacked-cone variants), thinned with distance.
import * as THREE from "three";

/** A stacked-cone conifer, unit height, base at y=0. `tiers` cones, `sides` radial segments. */
function conifer(tiers, sides, slim, seed) {
  const pos = [], col = [], idx = [];
  const trunk = 0.08;
  for (let t = 0; t < tiers; t++) {
    const y0 = trunk + (1 - trunk) * (t / (tiers + 0.35)) * 0.82, y1 = trunk + (1 - trunk) * ((t + 1.45) / (tiers + 0.35));
    const r = slim * (1 - t / (tiers + 0.6)) * (0.9 + 0.1 * Math.sin(seed + t * 2));
    const b = pos.length / 3;
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      pos.push(Math.cos(a) * r, y0, Math.sin(a) * r);
      const sh = 0.28 + 0.72 * Math.pow(y0, 0.8);        // vertex AO: dark at the base, lit at the crown
      col.push(sh, sh, sh);
    }
    pos.push(0, Math.min(1, y1), 0); col.push(1, 1, 1);
    for (let s = 0; s < sides; s++) idx.push(b + s, b + sides, b + ((s + 1) % sides));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Near-detail conifer: jagged drooping tiers (long/short tips alternate, rotated per tier), dark inner, lit tips, short trunk. Flat-shaded. */
function coniferDetail(tiers, n, slim, seed) {
  const pos = [], col = [], idx = [];
  const trunk = 0.08, m = 2 * n;
  for (let t = 0; t < tiers; t++) {
    const y0 = trunk + (1 - trunk) * (t / (tiers + 0.35)) * 0.82, y1 = trunk + (1 - trunk) * ((t + 1.45) / (tiers + 0.35));
    const r = slim * (1 - t / (tiers + 0.6)) * (0.9 + 0.1 * Math.sin(seed + t * 2));
    const sh = 0.28 + 0.72 * Math.pow(y0, 0.8), b = pos.length / 3, rot = t * 0.55 + seed;
    for (let j = 0; j < m; j++) {
      const a = (j / m) * Math.PI * 2 + rot, long = j % 2 === 0, rr = long ? r * 1.1 : r * 0.66;
      pos.push(Math.cos(a) * rr, long ? y0 - 0.03 * (1 - t / tiers * 0.5) : y0 + 0.012, Math.sin(a) * rr);
      const k = long ? 1.18 : 0.78; col.push(sh * k, sh * k, sh * k);
    }
    pos.push(0, Math.min(1, y1), 0); col.push(sh * 0.55, sh * 0.55, sh * 0.55);
    for (let j = 0; j < m; j++) idx.push(b + j, b + m, b + ((j + 1) % m));
  }
  const b = pos.length / 3, tr = 0.028;                      // 4-sided trunk
  for (let s4 = 0; s4 < 4; s4++) { const a = s4 * Math.PI / 2 + 0.4; pos.push(Math.cos(a) * tr, -0.02, Math.sin(a) * tr, Math.cos(a) * tr * 0.8, trunk + 0.06, Math.sin(a) * tr * 0.8); col.push(0.18, 0.15, 0.12, 0.2, 0.17, 0.14); }
  for (let s4 = 0; s4 < 4; s4++) { const q = b + s4 * 2, q2 = b + ((s4 + 1) % 4) * 2; idx.push(q, q + 1, q2, q2, q + 1, q2 + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const f = g.toNonIndexed(); g.dispose(); f.computeVertexNormals();
  return f;
}
const triCount = (g) => g.attributes.position.count / 3;

const rnd = (n) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Trees {
  constructor(pack, scene, { tier = "high" } = {}) {
    this.pack = pack; this.scene = scene;
    this.group = new THREE.Group(); scene.add(this.group);
    this.scale = pack.meta.tree_scale_default ?? 2.5;
    this.cap = tier === "high" ? 120000 : 30000;
    this.radius = tier === "high" ? 12000 : 7000;
    this.geos = [conifer(5, 6, 0.17, 0), conifer(4, 7, 0.36, 2), conifer(3, 5, 0.27, 4)];   // slender blue pine, broad deodar, young tree: 30 / 28 / 15 tris
    this.hf = [1.12, 1.0, 0.6];
    this.detail = tier === "high";            // near-detail LOD: high tier only
    this.RD = 1500; this.maxD = 8000;         // detail radius (m, 3D from camera; 8 % hysteresis) and instance cap
    this.geosD = this.detail ? [coniferDetail(5, 6, 0.17, 0), coniferDetail(4, 7, 0.36, 2), coniferDetail(3, 5, 0.27, 4)] : null;
    this.tris = this.geos.map(triCount); this.trisD = this.geosD ? this.geosD.map(triCount) : this.tris;
    this.splitPos = null;
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    this.mat.onBeforeCompile = (s) => {            // warm sunlit crowns, driven by height up the tree
      s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nvarying float vH;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvH = position.y;");
      s.fragmentShader = s.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vH;").replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= mix(vec3(1.0), vec3(2.2, 1.7, 0.8), smoothstep(0.55, 1.0, vH));");
    };
    this.clearings = [];          // [{x, z, r}] around placed landmark models
    this.chunks = new Map();      // key -> {raw, meshes, rect, state}
    this.visible = true; this.shadowDist = tier === "high" ? 4000 : 2500;
    this.count = 0; this.draws = 0;
    this.frame = 0;
  }

  key(c) { return `${c.cx}_${c.cy}`; }

  async _load(c) {
    const k = this.key(c);
    const e = { raw: null, meshes: null, c, state: "loading", order: null };
    this.chunks.set(k, e);
    try {
      const r = await fetch(`${this.pack.base}trees/${k}.bin`);
      if (!r.ok) throw new Error(r.status);
      const f = new Float32Array(await r.arrayBuffer());
      const n = Math.floor(f.length / 3), perm = new Uint32Array(n);
      for (let i = 0; i < n; i++) perm[i] = i;
      let s = (c.cx * 73856093) ^ (c.cy * 19349663) | 1;                       // deterministic shuffle so thinning is stable
      for (let i = n - 1; i > 0; i--) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; const j = (s >>> 0) % (i + 1); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
      const lists = [[], [], []];
      const p = this.pack; let kk = 0;
      for (let i = 0; i < n; i++) {                                            // no trees on slopes > 50 degrees
        const id = perm[i], x = f[id * 3], z = f[id * 3 + 1];
        const gx = (p.heightAt(x + 30, z) - p.heightAt(x - 30, z)) / 60, gz = (p.heightAt(x, z + 30) - p.heightAt(x, z - 30)) / 60;
        if (Math.hypot(gx, gz) > 1.19) continue;
        if (this.clearings.some((c) => (x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r)) continue;      // keep landmark footprints clear
        lists[kk++ % 3].push(id);
      }
      e.raw = f; e.lists = lists; e.state = "ready";
    } catch { e.state = "empty"; }
  }

  _mesh(e, v, geo = this.geos[v]) {
    const ids = e.lists[v];
    const m = new THREE.InstancedMesh(geo, this.mat, Math.max(1, ids.length));
    m.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    m.count = 0; m.castShadow = false; m.receiveShadow = false;
    m.setColorAt(0, new THREE.Color());
    m.boundingSphere = new THREE.Sphere(new THREE.Vector3(e.c.rect.x0 + e.c.rect.w / 2, 2500, e.c.rect.z0 + e.c.rect.h / 2), Math.hypot(e.c.rect.w, e.c.rect.h) * 0.5 + 6000);
    m.frustumCulled = true;
    this.group.add(m);
    return m;
  }

  /** (Re)write instance matrices (+ colours): ground y, height = 30 m * scale * tree_scale * distance ramp * jitter, small lean.
   *  Far instances (e.far) go to the regular meshes, near ones (e.nl) to the detail meshes; same matrices, so the swap is seamless. */
  _fill(e) {
    const p = this.pack, M = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), E = new THREE.Euler(), K = (e.ramp ?? 1) * this.scale;
    const L = (4 * Math.PI) / 180, col = new THREE.Color(), c0 = new THREE.Color(0x1f3a2c), c1 = new THREE.Color(0x2e5236);
    const write = (m, ids, v) => {
      for (let q = 0; q < ids.length; q++) {
        const id = ids[q], i = id * 3, x = e.raw[i], z = e.raw[i + 1];
        const h = 30 * e.raw[i + 2] * K * this.hf[v] * (1 + (rnd(id * 3 + 2) - 0.5) * 0.6), w = h * (0.9 + rnd(id + 5) * 0.25);
        E.set((rnd(id * 5 + 1) - 0.5) * 2 * L, rnd(id) * Math.PI * 2, (rnd(id * 5 + 3) - 0.5) * 2 * L, "YXZ");
        Q.setFromEuler(E);
        M.compose(P.set(x, p.groundY(x, z) - h * 0.03, z), Q, S.set(w, h, w));
        m.setMatrixAt(q, M);
        m.setColorAt(q, col.copy(c0).lerp(c1, rnd(id * 7 + 1)));   // dark blue-green
      }
      m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true;
    };
    for (let v = 0; v < 3; v++) {
      write(e.meshes[v], e.far ? e.far[v] : e.lists[v], v);
      if (e.dmeshes) write(e.dmeshes[v], e.nl[v], v);
    }
  }

  /** Split a chunk's instances into near (detail) and far by 3D camera distance, with hysteresis. Returns the number of near instances. */
  _split(e, cp, left) {
    const R2 = this.RD ** 2, R2o = (this.RD * 1.08) ** 2;
    if (!e.far) { e.far = e.lists.map((l) => l); e.nl = [[], [], []]; e.isNear = new Set(); }
    const far = [[], [], []], nl = [[], [], []]; let nNear = 0, changed = false;
    if (!e.gy) e.gy = new Map();
    for (let v = 0; v < 3; v++) for (const id of e.lists[v]) {
      const x = e.raw[id * 3], z = e.raw[id * 3 + 1];
      let y = e.gy.get(id); if (y === undefined) { y = this.pack.groundY(x, z); e.gy.set(id, y); }
      const d2 = (x - cp.x) ** 2 + (z - cp.z) ** 2 + (y - cp.y) ** 2, was = e.isNear.has(id);
      let near = d2 < (was ? R2o : R2);
      if (near && !was && nNear >= left) near = false;
      if (near) { nl[v].push(id); nNear++; if (!was) { e.isNear.add(id); changed = true; } }
      else { far[v].push(id); if (was) { e.isNear.delete(id); changed = true; } }
    }
    if (changed || !e.dmeshes && nNear) {
      e.far = far; e.nl = nl;
      if (nNear && !e.dmeshes) e.dmeshes = [0, 1, 2].map((v) => this._mesh(e, v, this.geosD[v]));
      this._fill(e);
    }
    return nNear;
  }

  /** Re-place everything after exaggeration or tree scale changed. */
  refresh() { for (const e of this.chunks.values()) if (e.meshes) this._fill(e); }
  setScale(s) { this.scale = s; this.refresh(); }

  update(camera, terrain) {
    if (this.frame++ % 6) return;
    const cp = camera.position;
    const near = terrain.chunks.filter((c) => c.dist < this.radius && (this.visible)).sort((a, b) => a.dist - b.dist);
    // desired count per chunk: dense up close, thinning to 22 % at the edge of the radius
    const want = [];
    let total = 0;
    for (const c of near) {
      let e = this.chunks.get(this.key(c));
      if (!e) { this._load(c); continue; }
      if (e.state !== "ready") continue;
      const ramp = (1.3 / 2.5) + (1 - 1.3 / 2.5) * smooth(2000, 10000, c.dist), band = Math.round(ramp * 10);
      if (!e.meshes) { e.meshes = [0, 1, 2].map((v) => this._mesh(e, v)); e.ramp = ramp; e.band = band; this._fill(e); }
      else if (band !== e.band) { e.band = band; e.ramp = ramp; this._fill(e); }
      const f = c.dist < 2500 ? 1 : 1 - 0.78 * Math.min(1, (c.dist - 2500) / (this.radius - 2500));
      const n = e.raw.length / 3 * f;
      want.push([e, f, n]); total += n;
    }
    // near-detail split (high tier): only chunks within reach of the detail radius, and only when the camera moved
    let nD = 0, detTris = 0;
    if (this.detail) {
      const mv = !this.splitPos || this.splitPos.distanceToSquared(cp) > 40 * 40; if (mv) this.splitPos = cp.clone();
      for (const [e] of want) {
        const active = e.c.dist < this.RD * 1.2 || (e.isNear && e.isNear.size);
        if (active && (mv || !e.far)) this._split(e, cp, this.maxD - nD);
        if (e.nl) for (let v = 0; v < 3; v++) { nD += e.nl[v].length; detTris += e.nl[v].length * this.trisD[v]; }
      }
    }
    // far instances are thinned (shared factor k) to the instance cap and, on the high tier, to the triangle budget net of the detail trees
    let farN = 0, farTris = 0, allTris = 0, allN = 0;
    for (const [e, f] of want) for (let v = 0; v < 3; v++) {
      const nf = (e.far ? e.far[v].length : e.lists[v].length) * f, na = e.lists[v].length * f;
      farN += nf; farTris += nf * this.tris[v]; allN += na; allTris += na * this.tris[v];
    }
    let k = farN + nD > this.cap ? Math.max(0, this.cap - nD) / farN : 1;
    // triangle-neutral: the all-regular-geometry cost (at the instance cap) is the budget; detail trees are paid for by thinning far ones
    if (this.detail && nD) { const base = 1.04 * allTris * Math.min(1, this.cap / Math.max(1, allN)); k = Math.min(k, Math.max(0, base - detTris) / farTris); }
    let count = 0, draws = 0;
    const live = new Set();
    for (const [e, f] of want) {
      live.add(e);
      for (let v = 0; v < 3; v++) {
        const m = e.meshes[v], n = Math.floor((e.far ? e.far[v].length : e.lists[v].length) * f * k);
        m.count = n; m.visible = n > 0; count += n; draws += n > 0 ? 1 : 0;
        m.castShadow = e.c.dist < this.shadowDist;
        if (e.dmeshes) {
          const d = e.dmeshes[v], nd = e.nl[v].length;
          d.count = nd; d.visible = nd > 0; count += nd; draws += nd > 0 ? 1 : 0;
          d.castShadow = e.c.dist < this.shadowDist;
        }
      }
    }
    for (const e of this.chunks.values()) {            // everything not wanted now is hidden; far ones are freed
      if (live.has(e) || !e.meshes) continue;
      for (const m of [...e.meshes, ...(e.dmeshes ?? [])]) m.visible = false;
      if (e.c.dist > this.radius * 1.5) { for (const m of [...e.meshes, ...(e.dmeshes ?? [])]) { this.group.remove(m); m.dispose(); } e.meshes = e.dmeshes = e.far = e.nl = e.isNear = e.gy = null; }
    }
    this.count = count; this.draws = draws;
    this.group.visible = this.visible;
  }
}
