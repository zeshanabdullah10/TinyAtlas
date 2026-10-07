// Honest flood history: mapped extents (only when a sourced, open-licence extent exists) and sourced facts.
import * as THREE from "three";
import { h } from "../dom.js";

const FILL = "#4fa3d9", OPACITY = 0.45, LIFT = 2.5;
const NOTE = "it shows where water was seen from space, not depth or damage.";

/** Draped translucent blue polygons per event year. With no extent for a year, nothing is drawn for it. */
export class FloodLayer {
  constructor(scene, pack, floods) {
    this.scene = scene; this.pack = pack; this.group = new THREE.Group(); this.group.visible = false;
    this.byYear = new Map();
    const mat = new THREE.MeshBasicMaterial({ color: FILL, transparent: true, opacity: OPACITY, depthWrite: false, side: THREE.DoubleSide });
    this.mat = mat;
    for (const ev of floods?.events ?? []) {
      if (!ev.extent?.polys?.length) continue;
      if (ev.extent.pack !== pack.slug) continue;
      const mesh = new THREE.Group();
      for (const ring of ev.extent.polys) mesh.add(this.polyMesh(ring));
      mesh.visible = false;
      this.byYear.set(ev.year, mesh);
      this.group.add(mesh);
    }
    scene.add(this.group);
  }

  polyMesh(ring) {
    const pts = ring.map(([x, z]) => new THREE.Vector2(x, z));
    const tris = THREE.ShapeUtils.triangulateShape(pts, []);
    const pos = [];
    for (const [x, z] of ring) pos.push(x, this.pack.groundY(x, z) + LIFT, z);
    const index = tris.flat();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(index);
    return new THREE.Mesh(g, this.mat);
  }

  /** year 2010 | 2022 shows that year's extent; null hides all. */
  setYear(y) {
    this.group.visible = y != null;
    for (const [year, mesh] of this.byYear) mesh.visible = year === y;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => o.geometry?.dispose());
    this.mat.dispose();
    this.byYear.clear();
  }
}

/** Panel: year toggle, sourced facts with sources, and the fixed extent line. */
export function floodPanel(floods, { onYear } = {}) {
  const events = floods?.events ?? [];
  let current = null;
  const facts = h("div", { class: "floods-facts" });
  const summary = h("p", { class: "floods-summary" });
  const extentLine = h("p", { class: "floods-note", hidden: true });
  const buttons = new Map();

  const show = (year) => {
    current = year;
    for (const [y, b] of buttons) b.setAttribute("aria-pressed", String(y === year));
    const ev = events.find((e) => e.year === year);
    summary.textContent = ev ? ev.summary : "";
    facts.replaceChildren(...(ev?.facts ?? []).map((f) =>
      h("li", {}, f.text, " ", h("a", { href: f.url, target: "_blank", rel: "noopener" }, f.source))));
    const src = ev?.extent;
    extentLine.hidden = !src;
    if (src) extentLine.textContent = `Mapped extent from ${src.source}; ${NOTE}`;
    onYear?.(year);
  };

  const toggles = h("div", { class: "floods-toggle", role: "group", "aria-label": "Flood year" },
    ...events.map((ev) => {
      const b = h("button", { type: "button", class: "floods-year", onClick: () => show(current === ev.year ? null : ev.year) }, String(ev.year));
      buttons.set(ev.year, b);
      return b;
    }));

  const root = h("section", { class: "floods-panel", "aria-label": "Flood history" },
    h("h3", {}, "Floods: Swat history"), toggles, summary,
    h("ul", { class: "floods-facts-list" }, facts),
    extentLine,
    h("p", { class: "floods-note" }, "Facts are sourced; figures are shown with the body that reported them and when."));
  return { el: root, show, get year() { return current; } };
}
