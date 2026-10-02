// A planned day drawn on the Atlas terrain: a saffron ribbon (dark casing) draped like the roads, with numbered stop markers.
// The planner returns the route in 0..1 coordinates over the pack's extent (u = x / W, v = z / H).
import * as THREE from "three";
import { h } from "../dom.js";
import { buildRibbon, ribbonMaterial } from "./ribbon.js";

const SAFFRON = [0.97, 0.66, 0.16], CASING = [0.1, 0.07, 0.04];

export class DayRoute {
  constructor(pack, scene, root, { onClear } = {}) {
    this.pack = pack; this.onClear = onClear;
    this.group = new THREE.Group(); scene.add(this.group);
    this.casingMat = ribbonMaterial({ kind: "road", minPx: 7.5, color: CASING, maxK: 3, legibD: 3000 });
    this.lineMat = ribbonMaterial({ kind: "road", minPx: 4.6, color: SAFFRON, maxK: 3, legibD: 3000 });
    this.layer = h("div", { class: "day-markers" });
    this.pill = h("div", { class: "day-pill", hidden: true });
    root.append(this.layer, this.pill);
    this.pts = []; this.stops = []; this.markers = []; this.tick = 0;
  }

  get active() { return this.pts.length > 1; }

  /** day: a planner day ({n, title, stops[{slug, name}], route[[u, v]]}). Returns the framing for the camera or null. */
  show(day, planTitle = "") {
    const p = this.pack;
    this.pts = day.route.map(([u, v]) => [u * p.W, v * p.H]);
    this.stops = day.stops.map((s) => p.places.find((q) => q.slug === s.slug)).filter(Boolean)
      .map((q, i) => ({ place: q, n: i + 1, x: q.anchor?.[0] ?? q.x, z: q.anchor?.[1] ?? q.z }));
    this.title = `Day ${day.n}: ${day.title}`;
    this.build();
    this.layer.replaceChildren(...this.stops.map((s) => (s.el = h("div", { class: "day-mk", title: `${s.n}. ${s.place.name}` }, h("span", null, String(s.n))))));
    this.pill.replaceChildren(h("span", null, this.title), h("button", { type: "button", "aria-label": "Clear the route from the map", onClick: () => { this.clear(); this.onClear?.(); } }, "×"));
    this.pill.hidden = false;
    return this.frame();
  }

  build() {
    for (const m of [...this.group.children]) { this.group.remove(m); m.geometry.dispose(); }
    if (!this.active) return;
    const g1 = new THREE.Mesh(buildRibbon(this.pack, [{ pts: this.pts, half: 11 }], 35), this.casingMat); g1.renderOrder = 7;
    const g2 = new THREE.Mesh(buildRibbon(this.pack, [{ pts: this.pts, half: 6.5 }], 35), this.lineMat); g2.renderOrder = 8;
    g1.frustumCulled = g2.frustumCulled = false;
    this.group.add(g1, g2);
  }

  rebuild() { if (this.active) this.build(); }       // after the height exaggeration changes

  /** Camera target and distance that contain the route and its stops. */
  frame() {
    const xs = [...this.pts.map((q) => q[0]), ...this.stops.map((s) => s.x)], zs = [...this.pts.map((q) => q[1]), ...this.stops.map((s) => s.z)];
    if (!xs.length) return null;
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, span = Math.max(x1 - x0, z1 - z0);
    return { target: new THREE.Vector3(cx, this.pack.groundY(cx, cz), cz), dist: Math.min(80000, Math.max(5000, span * 2.1)), span };
  }

  clear() {
    this.pts = []; this.stops = []; this.build(); this.layer.replaceChildren(); this.pill.hidden = true;
  }

  /** Project the numbered markers (call every frame). */
  update(camera, w, hgt) {
    if (!this.stops.length) return;
    const v = new THREE.Vector3(), cam = camera.position, check = this.tick++ % 8 === 0;
    for (const s of this.stops) {
      v.set(s.x, this.pack.groundY(s.x, s.z) + 60, s.z);
      if (check) s.hidden = this.pack.occluded(cam, v, 60);
      const d = v.distanceTo(cam);
      v.project(camera);
      const vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && !s.hidden;
      s.el.style.opacity = vis ? "1" : "0";
      if (vis) s.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * hgt}px)`;
      s.el.dataset.far = d > 30000 ? "1" : "";
    }
  }

  dispose() { this.pill.remove(); this.layer.remove(); this.casingMat.dispose(); this.lineMat.dispose(); for (const m of [...this.group.children]) m.geometry.dispose(); }
}
