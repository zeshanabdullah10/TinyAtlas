// Walking the shore: a footpath traced around the lake (20 m outside the WorldCover outline), viewpoints along it,
// and a first-person walker at eye height that cannot step into the water.
import * as THREE from "three";

const DIRS = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];   // [dr, dc], clockwise from east

/** Ordered outer boundary of the lake grown by `grow` cells, as world [x, z] points every ~3 m (closed loop). */
export function shoreLoop(site, grow = 2) {
  const g = site.meta.grid, W = g.cols, H = g.rows;
  let m = new Uint8Array(W * H);
  for (let i = 0; i < m.length; i++) m[i] = site.C[i] === 5 ? 1 : 0;
  for (let k = 0; k < grow; k++) {
    const n = m.slice();
    for (let r = 1; r < H - 1; r++) for (let c = 1; c < W - 1; c++) {
      if (m[r * W + c]) continue;
      for (const [dr, dc] of DIRS) if (m[(r + dr) * W + c + dc]) { n[r * W + c] = 1; break; }
    }
    m = n;
  }
  // Moore-neighbour tracing from the first filled cell in scan order
  let start = -1;
  for (let i = 0; i < m.length && start < 0; i++) if (m[i]) start = i;
  const cells = [];
  let cur = start, back = 6;     // we came from the west
  for (let guard = 0; guard < 100000; guard++) {
    cells.push(cur);
    const r = (cur / W) | 0, c = cur % W;
    let found = -1;
    for (let k = 0; k < 8; k++) {
      const d = (back + 1 + k) % 8, rr = r + DIRS[d][0], cc = c + DIRS[d][1];
      if (rr >= 0 && rr < H && cc >= 0 && cc < W && m[rr * W + cc]) { found = d; cur = rr * W + cc; break; }
    }
    if (found < 0) break;
    back = (found + 4) % 8;
    if (cur === start && cells.length > 8) break;
  }
  let pts = cells.map((i) => [site.x0 + (i % W) * g.cell, site.z0 + ((i / W) | 0) * g.cell]);
  for (let pass = 0; pass < 3; pass++) {            // round the cell steps (closed-loop moving average)
    const n = pts.length;
    pts = pts.map((_, i) => {
      let x = 0, z = 0;
      for (let k = -3; k <= 3; k++) { const p = pts[(i + k + n) % n]; x += p[0]; z += p[1]; }
      return [x / 7, z / 7];
    });
  }
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i <= pts.length; i++) {
    const a = pts[i - 1], b = pts[i % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let t = 3 - carry;
    while (t <= L) { out.push([a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L]); t += 3; }
    carry = L - (t - 3);
  }
  const S = [0];
  for (let i = 1; i < out.length; i++) S.push(S[i - 1] + Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]));
  return { pts: out, S, length: S[S.length - 1] + Math.hypot(out[0][0] - out.at(-1)[0], out[0][1] - out.at(-1)[1]) };
}

export function loopAt(loop, s) {
  const L = loop.length, n = loop.pts.length;
  s = ((s % L) + L) % L;
  let i = Math.min(Math.floor((s / L) * n), n - 1);
  while (i > 0 && loop.S[i] > s) i--;
  while (i < n - 1 && loop.S[i + 1] <= s) i++;
  const a = loop.pts[i], b = loop.pts[(i + 1) % n], seg = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, t = (s - loop.S[i]) / seg;
  return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, tx: (b[0] - a[0]) / seg, tz: (b[1] - a[1]) / seg, i };
}

export function nearestOnLoop(loop, x, z) {
  let best = 0, bd = Infinity;
  loop.pts.forEach((p, i) => { const d = (p[0] - x) ** 2 + (p[1] - z) ** 2; if (d < bd) { bd = d; best = i; } });
  return loop.S[best];
}

/** A trodden footpath along the loop. */
export function footpath(site, loop) {
  const n = loop.pts.length, across = 3, half = 0.7;
  const pos = new Float32Array((n + 1) * across * 3), uv = new Float32Array((n + 1) * across * 2);
  for (let i = 0; i <= n; i++) {
    const p = loop.pts[i % n], a = loop.pts[(i - 1 + n) % n], b = loop.pts[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1], d = Math.hypot(dx, dz) || 1;
    for (let j = 0; j < across; j++) {
      const l = (j - 1) * half, x = p[0] - (dz / d) * l, z = p[1] + (dx / d) * l, k = i * across + j;
      pos.set([x, site.heightAt(x, z) + 0.12, z], k * 3);
      uv.set([j - 1, (i < n ? loop.S[i] : loop.length)], k * 2);
    }
  }
  const idx = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < across - 1; j++) { const a = i * across + j; idx.push(a, a + 1, a + across, a + 1, a + across + 1, a + across); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aPath", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x9a7d5a, roughness: 1, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  mat.customProgramCacheKey = () => "dio-footpath";
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec2 aPath; varying vec2 vPath;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPath = aPath;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec2 vPath;")
      .replace("#include <color_fragment>", `#include <color_fragment>
  float wob = sin(vPath.y * 0.37) * 0.18 + sin(vPath.y * 1.3) * 0.08;
  diffuseColor.a = (1.0 - smoothstep(0.35, 0.95, abs(vPath.x + wob))) * 0.85;`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2; mesh.receiveShadow = true;
  return mesh;
}

/** Viewpoints, named only by where they are. */
export function viewpoints(site, loop, path) {
  const end = path.at(path.length);
  const sPark = nearestOnLoop(loop, end.x, end.z);
  const list = [{ name: "Where the track ends", s: sPark }];
  // the stream mouth: the OSM waterway end point closest to the lake
  let mouth = null, md = Infinity;
  for (const st of site.meta.streams) for (const p of [st.pts[0], st.pts.at(-1)]) {
    if (site.coverAt(p[0], p[1]) === 5) continue;
    const s = nearestOnLoop(loop, p[0], p[1]), q = loopAt(loop, s), d = Math.hypot(q.x - p[0], q.z - p[1]);
    if (d < md && Math.abs(s - sPark) > 120) { md = d; mouth = s; }
  }
  if (mouth != null && md < 60) list.push({ name: "Where a stream comes in", s: mouth });
  list.push({ name: "Far end of the lake", s: sPark + loop.length / 2 });
  list.push({ name: "Along the shore", s: sPark + loop.length / 4 }, { name: "Along the shore", s: sPark + (3 * loop.length) / 4 });
  list.sort((a, b) => (((a.s - sPark) % loop.length) + loop.length) % loop.length - ((((b.s - sPark) % loop.length) + loop.length) % loop.length));
  return list.map((v) => { const q = loopAt(loop, v.s); return { ...v, x: q.x, z: q.z, y: site.heightAt(q.x, q.z) }; });
}

export function viewpointPosts(vps) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.9 });
  const flag = new THREE.MeshStandardMaterial({ color: 0xe9a23b, roughness: 0.7, emissive: 0x3a2400 });
  for (const v of vps) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.6, 6), wood);
    post.position.set(v.x, v.y + 0.8, v.z); post.castShadow = true;
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.28, 0.05), flag);
    top.position.set(v.x, v.y + 1.5, v.z);
    g.add(post, top);
  }
  return g;
}

export class Walker {
  constructor(site, loop, canvas) {
    this.site = site; this.loop = loop;
    this.pos = new THREE.Vector3(); this.yaw = 0; this.pitch = -0.05; this.auto = false; this.s = 0;
    this.phase = 0; this.moving = 0; this.glide = null; this.steps = 0;
    let drag = null;
    canvas.addEventListener("pointerdown", (e) => { if (this.on) { drag = [e.clientX, e.clientY]; canvas.setPointerCapture?.(e.pointerId); } });
    canvas.addEventListener("pointermove", (e) => {
      if (!this.on || !drag) return;
      this.yaw -= (e.clientX - drag[0]) * 0.0042; this.pitch = Math.min(Math.max(this.pitch - (e.clientY - drag[1]) * 0.0035, -1.1), 0.9);
      drag = [e.clientX, e.clientY];
    });
    const up = () => (drag = null);
    canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
  }
  place(x, z, lookX, lookZ) {
    this.pos.set(x, 0, z);
    this.yaw = Math.atan2(-(lookX - x), -(lookZ - z));
    this.s = nearestOnLoop(this.loop, x, z);
  }
  glideTo(v, look) {
    this.auto = false;
    this.glide = { t: 0, from: this.pos.clone(), fromYaw: this.yaw, to: new THREE.Vector3(v.x, 0, v.z),
      toYaw: Math.atan2(-(look.x - v.x), -(look.z - v.z)), s: v.s };
  }
  /** keys: Set of lower-case keys; pace: time-lapse; returns metres moved this frame. */
  update(dt, keys, pace, lakeC, camera) {
    let moved = 0;
    if (this.glide) {
      const G = this.glide;
      G.t = Math.min(G.t + dt / 2.4, 1);
      const e = G.t < 0.5 ? 2 * G.t * G.t : 1 - (-2 * G.t + 2) ** 2 / 2;
      const prev = this.pos.clone();
      this.pos.lerpVectors(G.from, G.to, e);
      let dy = G.toYaw - G.fromYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw = G.fromYaw + dy * e;
      moved = prev.distanceTo(this.pos);
      if (G.t >= 1) { this.s = G.s; this.glide = null; }
    } else if (this.auto) {
      this.s += 1.35 * dt * pace;
      const q = loopAt(this.loop, this.s);
      const prev = this.pos.clone();
      this.pos.set(q.x, 0, q.z);
      moved = prev.distanceTo(this.pos);
      // look along the path, turned a third of the way toward the water
      const along = Math.atan2(-q.tx, -q.tz), toLake = Math.atan2(-(lakeC.x - q.x), -(lakeC.z - q.z));
      let d = toLake - along; d = Math.atan2(Math.sin(d), Math.cos(d));
      let want = along + d * 0.35 - this.yaw; want = Math.atan2(Math.sin(want), Math.cos(want));
      this.yaw += want * Math.min(1, dt * 1.5);
    } else {
      const f = (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
      const r = (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0);
      this.yaw += ((keys.has("arrowleft") ? 1 : 0) - (keys.has("arrowright") ? 1 : 0)) * dt * 1.6;
      if (f || r) {
        const sp = (keys.has("shift") ? 3.4 : 1.4) * dt * pace;
        const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
        let nx = this.pos.x + (fx * f - fz * r) * sp, nz = this.pos.z + (fz * f + fx * r) * sp;
        const half = [this.site.meta.grid.width / 2 - 20, this.site.meta.grid.height / 2 - 20];
        nx = Math.min(Math.max(nx, -half[0]), half[0]); nz = Math.min(Math.max(nz, -half[1]), half[1]);
        if (this.site.coverAt(nx, nz) !== 5) { moved = Math.hypot(nx - this.pos.x, nz - this.pos.z); this.pos.x = nx; this.pos.z = nz; }
      }
    }
    this.moving += ((moved > 0.0005 ? 1 : 0) - this.moving) * Math.min(1, dt * 6);
    const before = Math.floor(this.phase / Math.PI);
    this.phase += moved * 3.1;
    this.steps = Math.floor(this.phase / Math.PI) - before;
    const ground = this.site.heightAt(this.pos.x, this.pos.z);
    camera.position.set(this.pos.x, ground + 1.65 + Math.abs(Math.sin(this.phase)) * 0.045 * this.moving, this.pos.z);
    camera.rotation.set(this.pitch, this.yaw, Math.sin(this.phase * 0.5) * 0.004 * this.moving, "YXZ");
    return moved;
  }
}
