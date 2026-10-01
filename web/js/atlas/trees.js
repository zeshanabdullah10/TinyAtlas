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
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    this.mat.onBeforeCompile = (s) => {            // warm sunlit crowns, driven by height up the tree
      s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nvarying float vH;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvH = position.y;");
      s.fragmentShader = s.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vH;").replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= mix(vec3(1.0), vec3(2.2, 1.7, 0.8), smoothstep(0.55, 1.0, vH));");
    };
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
        lists[kk++ % 3].push(id);
      }
      e.raw = f; e.lists = lists; e.state = "ready";
    } catch { e.state = "empty"; }
  }

  _mesh(e, v) {
    const ids = e.lists[v];
    const m = new THREE.InstancedMesh(this.geos[v], this.mat, Math.max(1, ids.length));
    m.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    m.count = 0; m.castShadow = false; m.receiveShadow = false;
    const col = new THREE.Color(), c0 = new THREE.Color(0x1f3a2c), c1 = new THREE.Color(0x2e5236);
    for (let q = 0; q < ids.length; q++) m.setColorAt(q, col.copy(c0).lerp(c1, rnd(ids[q] * 7 + 1)));   // dark blue-green
    m.boundingSphere = new THREE.Sphere(new THREE.Vector3(e.c.rect.x0 + e.c.rect.w / 2, 2500, e.c.rect.z0 + e.c.rect.h / 2), Math.hypot(e.c.rect.w, e.c.rect.h) * 0.5 + 6000);
    m.frustumCulled = true;
    this.group.add(m);
    return m;
  }

  /** (Re)write instance matrices: ground y, height = 30 m * scale * tree_scale * distance ramp * jitter, small lean. */
  _fill(e) {
    const p = this.pack, M = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), E = new THREE.Euler(), K = (e.ramp ?? 1) * this.scale;
    const L = (4 * Math.PI) / 180;
    for (let v = 0; v < 3; v++) {
      const m = e.meshes[v], ids = e.lists[v];
      for (let q = 0; q < ids.length; q++) {
        const id = ids[q], i = id * 3, x = e.raw[i], z = e.raw[i + 1];
        const h = 30 * e.raw[i + 2] * K * this.hf[v] * (1 + (rnd(id * 3 + 2) - 0.5) * 0.6), w = h * (0.9 + rnd(id + 5) * 0.25);
        E.set((rnd(id * 5 + 1) - 0.5) * 2 * L, rnd(id) * Math.PI * 2, (rnd(id * 5 + 3) - 0.5) * 2 * L, "YXZ");
        Q.setFromEuler(E);
        M.compose(P.set(x, p.groundY(x, z) - h * 0.03, z), Q, S.set(w, h, w));
        m.setMatrixAt(q, M);
      }
      m.instanceMatrix.needsUpdate = true;
    }
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
    const k = total > this.cap ? this.cap / total : 1;
    let count = 0, draws = 0;
    const live = new Set();
    for (const [e, f] of want) {
      live.add(e);
      for (let v = 0; v < 3; v++) {
        const m = e.meshes[v], n = Math.floor(e.lists[v].length * f * k);
        m.count = n; m.visible = n > 0; count += n; draws += n > 0 ? 1 : 0;
        m.castShadow = e.c.dist < this.shadowDist;
      }
    }
    for (const e of this.chunks.values()) {            // everything not wanted now is hidden; far ones are freed
      if (live.has(e) || !e.meshes) continue;
      for (const m of e.meshes) m.visible = false;
      if (e.c.dist > this.radius * 1.5) { for (const m of e.meshes) { this.group.remove(m); m.dispose(); } e.meshes = null; }
    }
    this.count = count; this.draws = draws;
    this.group.visible = this.visible;
  }
}
