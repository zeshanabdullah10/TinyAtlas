// Life at the lake. None of these places come from a source yet, so every one is labelled "illustrative" on the page:
// rowing boats on the water, a camp of tents on the flattest meadow near the shore, tea stalls with smoke where the
// jeep track ends, and horses grazing by the shore.
import * as THREE from "three";
import { hash } from "./site.js";
import { Dust } from "./dust.js";

const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...o });
const shadowed = (g) => { g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); return g; };

export function boat(colour, { rower = true } = {}) {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.45, 3.6, 10, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2),
    mat(colour, { side: THREE.DoubleSide }));
  hull.scale.set(1, 0.55, 1); hull.position.y = 0.32;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.06, 0.3), mat(0x8a6a44)); seat.position.set(0, 0.3, 0.2);
  const rowerM = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.45, 3, 6), mat(0x2f4f7a)); rowerM.position.set(0, 0.75, 0.25);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), mat(0xc79a76)); head.position.set(0, 1.18, 0.25);
  const oar = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.04, 0.08), mat(0x9b7b55)); oar.position.set(0, 0.5, 0.35);
  g.add(hull, seat, oar);
  if (rower) g.add(rowerM, head);
  g.userData.oar = oar;
  return shadowed(g);
}

function tent(colour) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.7, 4, 1).rotateY(Math.PI / 4), mat(colour, { flatShading: true }));
  body.scale.set(1, 1, 1.4); body.position.y = 0.85;
  const door = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.9), mat(0x2a221b)); door.position.set(0, 0.45, 1.13); door.rotation.x = -0.42;
  g.add(body, door);
  return shadowed(g);
}

function stall() {
  const g = new THREE.Group();
  const wall = mat(0x8c6a4a), roof = mat(0x4e6f86, { flatShading: true });
  const base = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.0, 2.4), wall); base.position.y = 1.0;
  const top = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.12, 3.2), roof); top.position.y = 2.15; top.rotation.x = 0.08;
  const counter = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.9, 0.5), mat(0xb3906a)); counter.position.set(0, 0.45, 1.45);
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.2, 6), mat(0x3a3a3a)); pipe.position.set(1.1, 2.7, -0.6);
  for (let i = 0; i < 3; i++) {
    const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.45, 8), mat(0x6b4a2e)); stool.position.set(-1 + i, 0.22, 2.3); g.add(stool);
  }
  const bench = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 0.5), mat(0x7a5634)); bench.position.set(0, 0.45, 3.4);
  g.add(base, top, counter, pipe, bench);
  g.userData.chimney = new THREE.Vector3(1.1, 3.3, -0.6);
  return shadowed(g);
}

export function horse(colour) {
  const g = new THREE.Group(), m = mat(colour);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.2, 4, 8).rotateX(Math.PI / 2), m); body.position.y = 1.25;
  const neck = new THREE.Group(); neck.position.set(0, 1.45, -0.75);
  const n = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.6, 3, 6), m); n.rotation.x = -0.7; n.position.set(0, 0.25, -0.2);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.62), m); head.position.set(0, 0.5, -0.6); head.rotation.x = 0.5;
  neck.add(n, head);
  for (const [x, z] of [[-0.25, -0.6], [0.25, -0.6], [-0.25, 0.6], [0.25, 0.6]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 1.05, 6), m); leg.position.set(x, 0.52, z); g.add(leg);
  }
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.02, 0.8, 5), mat(0x2a1d14)); tail.position.set(0, 1.0, 1.05); tail.rotation.x = 0.4;
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.12, 0.6), mat(0x8a2f2a)); saddle.position.set(0, 1.7, -0.05);
  g.add(body, neck, tail, saddle);
  g.userData.neck = neck; g.userData.saddle = saddle;
  return shadowed(g);
}

/** Flat dry cells not in the water, `minD`..`maxD` metres from the loop. */
function candidates(site, loop, minD, maxD, near = null, nearR = Infinity) {
  const g = site.meta.grid, out = [];
  for (let r = 2; r < g.rows - 2; r++) for (let c = 2; c < g.cols - 2; c++) {
    const i = r * g.cols + c, cov = site.C[i];
    if (cov !== 2 && cov !== 6) continue;
    const x = site.x0 + c * g.cell, z = site.z0 + r * g.cell;
    if (near && Math.hypot(x - near.x, z - near.z) > nearR) continue;
    let d = Infinity;
    for (let k = 0; k < loop.pts.length; k += 3) d = Math.min(d, Math.hypot(loop.pts[k][0] - x, loop.pts[k][1] - z));
    if (d < minD || d > maxD) continue;
    const slope = Math.hypot(site.H[i + 1] - site.H[i - 1], site.H[i + g.cols] - site.H[i - g.cols]) / (2 * g.cell);
    out.push({ x, z, slope, d, i });
  }
  return out.sort((a, b) => a.slope - b.slope);
}
function spread(list, n, gap) {
  const pick = [];
  for (const p of list) { if (pick.every((q) => Math.hypot(q.x - p.x, q.z - p.z) > gap)) pick.push(p); if (pick.length >= n) break; }
  return pick;
}

export class Life {
  constructor(scene, site, loop, path, lakeC) {
    this.site = site; this.group = new THREE.Group(); this.labels = [];
    const end = path.at(path.length);
    // boats: lake cells with water all around
    const g = site.meta.grid, deep = [];
    for (let r = 3; r < g.rows - 3; r++) for (let c = 3; c < g.cols - 3; c++) {
      let ok = true;
      for (let dr = -1; dr <= 1 && ok; dr++) for (let dc = -1; dc <= 1 && ok; dc++) if (site.C[(r + dr) * g.cols + c + dc] !== 5) ok = false;
      if (ok) deep.push([site.x0 + c * g.cell, site.z0 + r * g.cell]);
    }
    // Layout follows satellite views of the lake (not traced): boats pulled up in a row along the meadow shore near
    // the end of the track, a cluster of stalls where the track meets the water, and camps spread over the meadow.
    this.boats = [];
    const colours = [0xe2b347, 0xd9573b, 0x3f8f5a, 0x3d7fb8, 0xf0ebe0];   // painted wooden boats, as in the Commons photo "Mahodand Lake 3044 (2)"
    let last = null, nb = 0;
    for (const [px, pz] of loop.pts) {
      if (nb >= 22 || Math.hypot(px - end.x, pz - end.z) > 380) continue;
      if (last && Math.hypot(px - last[0], pz - last[1]) < 7) continue;
      // walk toward the lake centre until the water starts; the boat sits on the bank, bow to the water
      const dx = lakeC.x - px, dz = lakeC.z - pz, L = Math.hypot(dx, dz) || 1;
      let edge = null;
      for (let t = 0; t < 80; t += 1) if (site.coverAt(px + dx / L * t, pz + dz / L * t) === 5) { edge = t; break; }
      if (edge == null) continue;
      const x = px + dx / L * (edge - 1.5), z = pz + dz / L * (edge - 1.5);
      const bt = boat(colours[nb % colours.length], { rower: false });
      bt.position.set(x, Math.max(site.heightAt(x, z), 0) + 0.05, z); bt.rotation.y = Math.atan2(-dx, -dz);
      this.group.add(bt); last = [px, pz]; nb++;
      if (nb === 1) this.labels.push({ text: "Boats for hire · illustrative, as in satellite views", p: bt.position.clone().setY(bt.position.y + 7), cls: "illus", modes: ["explore", "walk"] });
    }
    for (let k = 0; k < Math.min(2, deep.length); k++) {   // two out on the water
      const p = deep[Math.floor(hash(k, 501) * deep.length)], b = boat(colours[k]);
      b.position.set(p[0], 0, p[1]); b.rotation.y = hash(k, 502) * 6.28;
      this.group.add(b);
      this.boats.push({ m: b, home: new THREE.Vector2(p[0], p[1]), ph: hash(k, 503) * 10 });
    }

    // stalls and huts where the track meets the water
    this.smoke = new Dust(scene, 400);
    this.smoke.uni.uCol.value.setRGB(0.78, 0.78, 0.8);
    this.chimneys = [];
    const sc = spread(candidates(site, loop, 6, 400, end, 160), 8, 10);
    sc.forEach((p, k) => {
      const s = stall();
      s.position.set(p.x, site.heightAt(p.x, p.z) + 0.2, p.z);
      s.rotation.y = Math.atan2(-(lakeC.x - p.x), -(lakeC.z - p.z)) + Math.PI;
      this.group.add(s);
      s.updateMatrixWorld(true);
      this.chimneys.push(s.localToWorld(s.userData.chimney.clone()));
      if (!k) this.labels.push({ text: "Tea stalls and hotels · illustrative", p: s.position.clone().setY(s.position.y + 7), cls: "illus", modes: ["explore", "walk"] });
    });

    // camps spread over the meadow by the track, in small clusters
    const tc = spread(candidates(site, loop, 15, 350, end, 550).filter((p) => !sc.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 14)), 9, 35);
    const tcol = [0xe46b2f, 0x3d7fb8, 0xe6c34a, 0xf0ebe0, 0xd94a5a, 0xf0ebe0, 0x5b9a4a];
    let ti = 0;
    tc.forEach((p) => {
      const n = 3 + Math.floor(hash(ti, 600) * 4);
      for (let j = 0; j < n; j++, ti++) {
        const t = tent(tcol[ti % tcol.length]);
        t.position.set(p.x + (hash(ti, 601) - 0.5) * 16, 0, p.z + (hash(ti, 602) - 0.5) * 16);
        if (site.coverAt(t.position.x, t.position.z) === 5) continue;
        t.position.y = site.heightAt(t.position.x, t.position.z) + 0.25;
        t.rotation.y = hash(ti, 603) * 6.28;
        this.group.add(t);
      }
    });
    if (tc.length) this.labels.push({ text: "Camps · illustrative, as in satellite views", p: new THREE.Vector3(tc[0].x, site.heightAt(tc[0].x, tc[0].z) + 7, tc[0].z), cls: "illus", modes: ["explore", "walk"] });

    // horses grazing by the shore
    this.horses = [];
    const hc = spread(candidates(site, loop, 6, 60).filter((p) => !tc.some((t) => Math.hypot(t.x - p.x, t.z - p.z) < 25)), 4, 14);
    const hcol = [0x6b3e22, 0xd8cfc0, 0x3a2a20, 0x9a6a3e];
    hc.forEach((p, k) => {
      const h = horse(hcol[k % 4]);
      h.position.set(p.x, site.heightAt(p.x, p.z), p.z); h.rotation.y = hash(k, 701) * 6.28;
      this.group.add(h);
      this.horses.push({ m: h, ph: hash(k, 702) * 20 });
    });
    if (hc.length) this.labels.push({ text: "Horse rides · illustrative", p: this.horses[0].m.position.clone().setY(this.horses[0].m.position.y + 6), cls: "illus", modes: ["explore", "walk"] });
    scene.add(this.group);
  }
  update(dt, t, wind) {
    for (const b of this.boats) {
      // drift in a slow loop around home, turning back before the shore
      const a = t * 0.03 + b.ph, R = 12;
      const x = b.home.x + Math.cos(a) * R, z = b.home.y + Math.sin(a * 0.8) * R;
      if (this.site.coverAt(x, z) === 5) {
        const dx = x - b.m.position.x, dz = z - b.m.position.z;
        if (dx * dx + dz * dz > 1e-6) b.m.rotation.y = Math.atan2(-dx, -dz);
        b.m.position.x = x; b.m.position.z = z;
      }
      b.m.position.y = Math.sin(t * 1.3 + b.ph) * 0.05;
      b.m.rotation.z = Math.sin(t * 1.1 + b.ph) * 0.03;
      b.m.userData.oar.rotation.y = Math.sin(t * 1.6 + b.ph) * 0.35;
    }
    for (const h of this.horses) {
      const n = h.m.userData.neck;
      n.rotation.x = 0.55 + Math.sin(t * 0.5 + h.ph) * 0.35 + (Math.sin(t * 0.13 + h.ph) > 0.6 ? -0.5 : 0);
      h.m.rotation.y += Math.sin(t * 0.07 + h.ph) * dt * 0.05;
    }
    for (const c of this.chimneys) if (Math.random() < dt * 5) this.smoke.emit(c, 0, 1);
    this.smoke.update(dt, wind);
  }
}
