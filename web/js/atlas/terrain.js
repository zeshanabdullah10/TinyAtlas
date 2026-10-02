// Chunked near terrain (LOD 128/64/32/16 segments + skirts, lazy albedo tiles) and the far backdrop.
import * as THREE from "three";
import { makeTerrainMaterial, makeFarMaterial, shared } from "./material.js";

const upCache = new Map();
const upAttr = (n) => {                       // shared constant +y normals (the shader computes its own)
  if (!upCache.has(n)) { const a = new Float32Array(n * 3); for (let i = 1; i < a.length; i += 3) a[i] = 1; upCache.set(n, new THREE.BufferAttribute(a, 3)); }
  return upCache.get(n);
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const border = (sx, sz) => {                   // grid-vertex indices along the four borders
  const W1 = sx + 1;
  return [Array.from({ length: W1 }, (_, i) => i), Array.from({ length: W1 }, (_, i) => sz * W1 + i),
    Array.from({ length: sz + 1 }, (_, j) => j * W1), Array.from({ length: sz + 1 }, (_, j) => j * W1 + sx)];
};

export class Terrain {
  constructor(pack, scene, { tier = "high", renderer } = {}) {
    this.pack = pack; this.scene = scene; this.tier = tier;
    this.group = new THREE.Group(); scene.add(this.group);
    this.chunks = [];
    this.tol = tier === "high" ? 14 : 26;                 // pixels of terrain cell allowed on screen
    this.maxTileLevel = tier === "high" ? pack.meta.albedo_levels - 1 : 2;
    this.cacheMax = tier === "high" ? 220 : 90;
    this.cache = new Map();                                // key -> {tex, used, c}
    this.queue = []; this.inflight = 0; this.frame = 0;
    this.aniso = Math.min(4, renderer?.capabilities.getMaxAnisotropy?.() ?? 1);
    this.frustum = new THREE.Frustum(); this.pv = new THREE.Matrix4();
    this.stats = { tris: 0, tilesLoaded: 0 };
    const n = pack.chunkCells, { cols, hm } = pack;
    for (let cy = 0; cy < pack.ncy; cy++) for (let cx = 0; cx < pack.ncx; cx++) {
      const rect = pack.chunkRect(cx, cy);
      let lo = Infinity, hi = -Infinity;
      for (let j = 0; j <= rect.nz; j += 2) for (let i = 0; i <= rect.nx; i += 2) {
        const v = hm[(cy * n + j) * cols + cx * n + i];
        if (v < lo) lo = v; if (v > hi) hi = v;
      }
      const mat = makeTerrainMaterial();
      mat.userData.tile.uTile.value.set(rect.x0, rect.z0, rect.w, rect.h);
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      mesh.receiveShadow = true; mesh.visible = false; mesh.frustumCulled = false;
      this.group.add(mesh);
      this.chunks.push({ cx, cy, rect, lo, hi, mat, mesh, lod: -1, box: new THREE.Box3(), albKey: null, wantKey: null, dist: 0, tris: 0 });
    }
    this.updateBoxes();
    this.buildFar();
  }

  updateBoxes() {
    const p = this.pack;
    for (const c of this.chunks) c.box.set(new THREE.Vector3(c.rect.x0, p.yOf(c.lo) - 5, c.rect.z0), new THREE.Vector3(c.rect.x0 + c.rect.w, p.yOf(c.hi) + 5, c.rect.z0 + c.rect.h));
  }

  /** Visit every grid vertex of a chunk at an LOD: fn(vertexIndex, cellX, cellZ). */
  _verts(c, lod, fn) {
    const step = 1 << lod, { nx, nz } = c.rect;
    const sx = Math.ceil(nx / step), sz = Math.ceil(nz / step);
    let v = 0;
    for (let j = 0; j <= sz; j++) for (let i = 0; i <= sx; i++) fn(v++, Math.min(nx, i * step), Math.min(nz, j * step));
  }

  build(c, lod) {
    const p = this.pack, { res, exag } = p, { nx, nz } = c.rect, n = p.chunkCells;
    const step = 1 << lod, sx = Math.ceil(nx / step), sz = Math.ceil(nz / step);
    const grid = (sx + 1) * (sz + 1), total = grid + 2 * (sx + 1) + 2 * (sz + 1);
    const pos = new Float32Array(total * 3), uv = new Float32Array(total * 2);
    const depth = res * step + 30;
    this._verts(c, lod, (v, i, j) => {
      const gx = c.cx * n + i, gz = c.cy * n + j;
      pos[v * 3] = (gx + 0.5) * res; pos[v * 3 + 1] = (p.hm[gz * p.cols + gx] - p.hmin) * exag; pos[v * 3 + 2] = (gz + 0.5) * res;
      uv[v * 2] = i / nx; uv[v * 2 + 1] = j / nz;
    });
    const idx = new Uint32Array((sx * sz * 2 + 2 * (sx + sz) * 2) * 3);
    let k = 0, sv = grid;
    for (let j = 0; j < sz; j++) for (let i = 0; i < sx; i++) {
      const a = j * (sx + 1) + i, b = a + 1, cc = a + sx + 1, d = cc + 1;
      idx[k++] = a; idx[k++] = cc; idx[k++] = b; idx[k++] = b; idx[k++] = cc; idx[k++] = d;
    }
    for (const list of border(sx, sz)) {
      const base = sv;
      for (const g of list) { pos.copyWithin(sv * 3, g * 3, g * 3 + 3); uv.copyWithin(sv * 2, g * 2, g * 2 + 2); pos[sv * 3 + 1] -= depth; sv++; }
      for (let q = 0; q < list.length - 1; q++) {
        const a = list[q], b = list[q + 1], a2 = base + q, b2 = a2 + 1;
        idx[k++] = a; idx[k++] = b; idx[k++] = a2; idx[k++] = b; idx[k++] = b2; idx[k++] = a2;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setAttribute("normal", upAttr(total));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingBox = c.box.clone();
    g.boundingSphere = c.box.getBoundingSphere(new THREE.Sphere());
    c.mesh.geometry.dispose();
    c.mesh.geometry = g; c.lod = lod; c.tris = idx.length / 3;
  }

  /** Exaggeration changed: rewrite y only (plus the backdrop). */
  rebuildY(far = true) {
    const p = this.pack, n = p.chunkCells;
    this.updateBoxes();
    shared.uExag.value = p.exag;
    for (const c of this.chunks) {
      if (c.lod < 0) continue;
      const g = c.mesh.geometry, a = g.attributes.position, pa = a.array;
      this._verts(c, c.lod, (v, i, j) => { pa[v * 3 + 1] = (p.hm[(c.cy * n + j) * p.cols + c.cx * n + i] - p.hmin) * p.exag; });
      const step = 1 << c.lod, depth = p.res * step + 30, sx = Math.ceil(c.rect.nx / step), sz = Math.ceil(c.rect.nz / step);
      let sv = (sx + 1) * (sz + 1);
      for (const l of border(sx, sz)) for (const gv of l) pa[sv++ * 3 + 1] = pa[gv * 3 + 1] - depth;
      a.needsUpdate = true;
      g.boundingBox = c.box.clone(); g.boundingSphere = c.box.getBoundingSphere(new THREE.Sphere());
    }
    if (far) this.buildFar();
  }

  /* ---------------- backdrop ---------------- */
  buildFar() {
    const p = this.pack, f = p.far;
    if (!f) return;
    if (!this.far) {
      this.farStride = Math.max(1, Math.ceil(Math.max(f.cols, f.rows) / 560));
      const tex = new THREE.Texture(); tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false;
      tex.anisotropy = this.aniso; tex.minFilter = THREE.LinearMipmapLinearFilter;
      this.far = new THREE.Mesh(new THREE.BufferGeometry(), makeFarMaterial(tex, { w: p.W, h: p.H, o: p.o }));
      this.far.frustumCulled = false; this.far.renderOrder = -1;
      this.scene.add(this.far);
      loadBitmap(p.base + "albedo/far.webp").then((bm) => { tex.image = bm; tex.needsUpdate = true; }).catch(() => {});
    }
    const s = this.farStride, cw = Math.ceil((f.cols - 1) / s) + 1, ch = Math.ceil((f.rows - 1) / s) + 1;
    const pos = new Float32Array(cw * ch * 3), nor = new Float32Array(cw * ch * 3), uv = new Float32Array(cw * ch * 2);
    const H = (i, j) => f.hm[Math.min(f.rows - 1, j * s) * f.cols + Math.min(f.cols - 1, i * s)];
    const cs = f.res_m * s;
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      const v = j * cw + i, gx = Math.min(f.cols - 1, i * s), gz = Math.min(f.rows - 1, j * s);
      pos[v * 3] = f.origin_m[0] + (gx + 0.5) * f.res_m; pos[v * 3 + 1] = (H(i, j) - p.hmin) * p.exag - 20; pos[v * 3 + 2] = f.origin_m[1] + (gz + 0.5) * f.res_m;
      uv[v * 2] = (gx + 0.5) / f.cols; uv[v * 2 + 1] = (gz + 0.5) / f.rows;
      const dx = ((H(Math.min(cw - 1, i + 1), j) - H(Math.max(0, i - 1), j)) / (2 * cs)) * p.exag;
      const dz = ((H(i, Math.min(ch - 1, j + 1)) - H(i, Math.max(0, j - 1))) / (2 * cs)) * p.exag;
      const il = 1 / Math.hypot(dx, 1, dz);
      nor[v * 3] = -dx * il; nor[v * 3 + 1] = il; nor[v * 3 + 2] = -dz * il;
    }
    const idx = new Uint32Array((cw - 1) * (ch - 1) * 6); let k = 0;
    for (let j = 0; j < ch - 1; j++) for (let i = 0; i < cw - 1; i++) {
      const a = j * cw + i, b = a + 1, c = a + cw, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    this.far.geometry.dispose(); this.far.geometry = g; this.farTris = idx.length / 3;
  }

  /* ---------------- per-frame LOD and tiles ---------------- */
  update(camera, viewH, force = false) {
    if (!force && (this.frame++ % 2)) return;
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    const mppK = (2 * Math.tan((camera.fov * Math.PI) / 360)) / viewH, cp = camera.position;
    let rebuilds = force ? 1e9 : 6, tris = 0;
    const levels = this.pack.meta.albedo_levels, todo = [];
    for (const c of this.chunks) {
      const vis = this.frustum.intersectsBox(c.box);
      c.mesh.visible = vis && c.lod >= 0;
      c.dist = c.box.distanceToPoint(cp);
      if (!vis) continue;
      const mpp = Math.max(c.dist, 50) * mppK;
      const lf = Math.log2((this.tol * mpp) / this.pack.res);
      let want = clamp(Math.floor(lf), 0, 3);
      if (c.lod >= 0 && want !== c.lod && lf > c.lod - 0.2 && lf < c.lod + 1.2) want = c.lod;   // hysteresis
      if (want !== c.lod) todo.push([c, want]);
      const tl = clamp(Math.floor(Math.log2(mpp / 6)), 0, levels - 1);
      this.wantTile(c, tl <= this.maxTileLevel ? tl : -1);
      if (c.lod >= 0) tris += c.tris;
    }
    todo.sort((a, b) => a[0].dist - b[0].dist);
    for (const [c, want] of todo) { if (rebuilds-- <= 0) break; this.build(c, want); c.mesh.visible = true; }
    this.stats.tris = tris + (this.farTris || 0);
    this.pump();
  }

  wantTile(c, level) {
    const key = level < 0 ? null : `${level}/${c.cx}_${c.cy}`;
    c.wantKey = key;
    if (key === c.albKey) return;
    if (key === null) { c.mat.userData.tile.uHasTile.value = 0; c.albKey = null; return; }
    const e = this.cache.get(key);
    if (e && e.tex) { e.used = performance.now(); this.setTile(c, key, e.tex, level); return; }
    if (!e) { this.cache.set(key, { tex: null, used: performance.now(), c, level }); this.queue.push(key); }
    else e.used = performance.now();
  }

  setTile(c, key, tex, level) {
    const t = c.mat.userData.tile;
    t.uAlb.value = tex; t.uHasTile.value = 1; t.uTexPx.value = (this.pack.chunkCells * 3) >> level;
    c.albKey = key;
  }

  pump() {
    while (this.inflight < 6 && this.queue.length) {
      this.queue = this.queue.filter((k) => this.chunks.some((c) => c.wantKey === k));   // drop tiles nobody wants now
      if (!this.queue.length) break;
      const dist = (k) => this.cache.get(k)?.c?.dist ?? 1e12;
      let bi = 0; for (let i = 1; i < this.queue.length; i++) if (dist(this.queue[i]) < dist(this.queue[bi])) bi = i;
      const key = this.queue.splice(bi, 1)[0], e = this.cache.get(key);
      this.inflight++;
      const [l, rest] = key.split("/"), [cx, cy] = rest.split("_").map(Number);
      loadBitmap(this.pack.tileUrl(l, cx, cy)).then((bm) => {
        if (this.disposed) { bm.close?.(); return; }
        const tex = new THREE.Texture(bm); tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = this.aniso; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.needsUpdate = true;
        e.tex = tex; this.stats.tilesLoaded++;
        for (const c of this.chunks) if (c.wantKey === key) this.setTile(c, key, tex, +l);
        this.evict();
      }).catch(() => { this.cache.delete(key); }).finally(() => { this.inflight--; });
    }
  }

  evict() {
    if (this.cache.size <= this.cacheMax) return;
    const inUse = new Set(this.chunks.map((c) => c.albKey));
    const old = [...this.cache.entries()].filter(([k, e]) => e.tex && !inUse.has(k)).sort((a, b) => a[1].used - b[1].used);
    for (const [k, e] of old) { if (this.cache.size <= this.cacheMax) break; e.tex.dispose(); e.tex.image?.close?.(); this.cache.delete(k); }
  }

  dispose() {
    for (const e of this.cache.values()) { e.tex?.image?.close?.(); e.tex?.dispose(); }
    this.cache.clear(); this.queue = []; this.disposed = true;
  }

  async loadOverview() {
    const bm = await loadBitmap(this.pack.base + "albedo/overview.webp");
    const t = new THREE.Texture(bm); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = this.aniso;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true;
    shared.uOv.value = t;
  }
}

export async function loadBitmap(url, flip = false) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return createImageBitmap(await r.blob(), { imageOrientation: flip ? "flipY" : "none", premultiplyAlpha: "none", colorSpaceConversion: "none" });
}
