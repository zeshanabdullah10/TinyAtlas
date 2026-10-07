// Seasonal herder flocks (illustrative). The migration facts and their sources are in web/data/diorama/herders.json:
// herds spend the summer on high grass, walk down the valley as winter comes on, and are down in the plains in winter.
// Summer: flocks graze on grass cover above the arrival. Autumn ("on the move"): flocks walk the drive path.
// Winter: no flock. Placement is deterministic (hash), so a flock is in the same place on every visit.
import * as THREE from "three";
import { hash } from "./site.js";
const FACTS = await fetch(new URL("../../data/diorama/herders.json", import.meta.url)).then((r) => r.json()).catch(() => ({ label: "Herders' flock (illustrative)" }));

const MAX = 300;                                  // animals in total, all flocks
const FLOCKS = 3;
const STATE = { Summer: "graze", Autumn: "move", Winter: "none" };
const COLOURS = [0xf2efe6, 0x8a6a4a, 0x3b3128, 0xd8c6a4];   // sheep, brown goats, black goats, cream sheep
const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, ...o });

function person(colour) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.7, 3, 6), mat(colour)); body.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), mat(0xc79a76)); head.position.y = 1.7;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xe9e2d0)); cap.position.y = 1.78;
  g.add(body, head, cap);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
function dog() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.8), mat(0x7a5634)); body.position.y = 0.35;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.25), mat(0x7a5634)); head.position.set(0, 0.5, 0.5);
  g.add(body, head);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export class Herders {
  constructor(scene, site, path, opts = {}) {
    this.site = site; this.path = path; this.group = new THREE.Group(); this.labels = [];
    this.state = "none"; this.t = 0; this.flocks = [];
    const g = site.meta.grid, end = path.at(path.length);

    // Summer grazing: grass cover (site cover 2), gentle slope, above the arrival, within 1.5 km of it.
    const cand = [];
    for (let r = 2; r < g.rows - 2; r += 2) for (let c = 2; c < g.cols - 2; c += 2) {
      const i = r * g.cols + c;
      if (site.C[i] !== 2) continue;
      const x = site.x0 + c * g.cell, z = site.z0 + r * g.cell;
      const h = site.heightAt(x, z);
      if (h < 25 || Math.hypot(x - end.x, z - end.z) > 1500) continue;
      const slope = Math.hypot(site.H[i + 1] - site.H[i - 1], site.H[i + g.cols] - site.H[i - g.cols]) / (2 * g.cell);
      if (slope > 0.3) continue;
      cand.push({ x, z, h, i });
    }
    cand.sort((a, b) => hash(a.i, 801) - hash(b.i, 801));
    const pick = [];
    for (const p of cand) {
      if (pick.length >= FLOCKS) break;
      if (pick.every((q) => Math.hypot(q.x - p.x, q.z - p.z) > 150)) pick.push(p);
    }

    // animals: 40 to 69 per flock, MAX in total
    this.animals = [];
    pick.forEach((p, f) => {
      const count = 40 + Math.floor(hash(f, 802) * 30);
      const fl = { x: p.x, z: p.z, y: p.h, s0: path.length * (0.3 + 0.15 * f), lx: p.x, lz: p.z, ly: p.h, tx: 1, tz: 0, nx: 0, nz: 1 };
      this.flocks.push(fl);
      for (let k = 0; k < count && this.animals.length < MAX; k++) {
        const key = f * 1000 + k, a = hash(key, 803) * 6.283, rr = Math.sqrt(hash(key, 804)) * 14;
        this.animals.push({
          f, ph: hash(key, 805) * 10, col: COLOURS[Math.floor(hash(key, 806) * COLOURS.length)],
          x: p.x + Math.cos(a) * rr, z: p.z + Math.sin(a) * rr,        // grazing offset
          along: -hash(key, 807) * 14, lat: (hash(key, 808) - 0.5) * 8,  // walking offset behind the lead
        });
      }
    });

    // meshes: one instanced body and one instanced head for all animals
    const bodyG = new THREE.CapsuleGeometry(0.2, 0.45, 3, 6).rotateX(Math.PI / 2);
    const headG = new THREE.SphereGeometry(0.15, 6, 5);
    this.bodies = new THREE.InstancedMesh(bodyG, mat(0xffffff), MAX);
    this.heads = new THREE.InstancedMesh(headG, mat(0xffffff), MAX);
    this.bodies.castShadow = this.heads.castShadow = true;
    this.bodies.count = this.heads.count = this.animals.length;
    this.animals.forEach((a, i) => { this.bodies.setColorAt(i, new THREE.Color(a.col)); this.heads.setColorAt(i, new THREE.Color(a.col)); });
    this.group.add(this.bodies, this.heads);

    this.people = this.flocks.map(() => ({ herder: person(0x2f4f7a), dog: dog() }));
    this.people.forEach((p) => this.group.add(p.herder, p.dog));

    this.dummy = new THREE.Object3D();
    if (pick.length) this.labels.push({
      text: FACTS.label, p: new THREE.Vector3(pick[0].x, pick[0].h + 9, pick[0].z), cls: "illus", modes: ["explore", "walk"],
    });
    scene.add(this.group);
    this.setSeason("Winter");
  }

  /** Season names from season.js: Summer = grazing, Autumn = on the move, Winter = none. */
  setSeason(name) {
    this.state = STATE[name] ?? "none";
    this.group.visible = this.state !== "none";
  }

  update(dt, elapsed) {
    if (this.state === "none") return;
    const mv = this.state === "move", t = elapsed, path = this.path, d = this.dummy;
    // flock leaders: on the grazing slope, or walking the drive path in a 600 m stretch
    this.flocks.forEach((F, f) => {
      if (mv) {
        const p = path.at(Math.min(F.s0 + (t * 0.8) % 600, path.length - 1));
        F.lx = p.x; F.lz = p.z; F.ly = p.y;
        const L = Math.hypot(p.tx, p.tz) || 1; F.tx = p.tx / L; F.tz = p.tz / L; F.nx = -F.tz; F.nz = F.tx;
      } else { F.lx = F.x; F.lz = F.z; F.ly = F.y; F.tx = 0; F.tz = 1; F.nx = 1; F.nz = 0; }
      const P = this.people[f];
      P.herder.position.set(F.lx + F.tx * 5, F.ly, F.lz + F.tz * 5); P.herder.rotation.y = Math.atan2(-F.tx, -F.tz);
      P.dog.position.set(F.lx - F.tx * 3 + F.nx * 3, F.ly, F.lz - F.tz * 3 + F.nz * 3); P.dog.rotation.y = Math.atan2(F.tx, F.tz);
      P.herder.visible = P.dog.visible = true;
    });
    if (mv && this.labels[0]) this.labels[0].p.set(this.flocks[0].lx, this.flocks[0].ly + 9, this.flocks[0].lz);   // the label follows the lead flock
    this.animals.forEach((a, i) => {
      const F = this.flocks[a.f];
      let x, z, h, bob;
      if (mv) {
        x = F.lx + F.tx * a.along + F.nx * a.lat; z = F.lz + F.tz * a.along + F.nz * a.lat;
        h = Math.atan2(F.tx, F.tz); bob = Math.abs(Math.sin(t * 6 + a.ph)) * 0.05;
      } else {
        x = a.x; z = a.z; h = a.ph + Math.sin(t * 0.15 + a.ph) * 1.2; bob = 0;
      }
      const y = this.site.heightAt(x, z);
      const fx = Math.sin(h), fz = Math.cos(h);
      const dip = mv ? 0 : (0.5 + 0.5 * Math.sin(t * 0.7 + a.ph)) * 0.25;   // head down to graze
      d.position.set(x, y + 0.42 + bob, z); d.rotation.set(0, h, 0); d.updateMatrix();
      this.bodies.setMatrixAt(i, d.matrix);
      d.position.set(x + fx * 0.4, y + 0.6 + bob - dip, z + fz * 0.4); d.rotation.set(dip * 1.2, h, 0); d.updateMatrix();
      this.heads.setMatrixAt(i, d.matrix);
    });
    this.bodies.instanceMatrix.needsUpdate = true; this.heads.instanceMatrix.needsUpdate = true;
  }
}
