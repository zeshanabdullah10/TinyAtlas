// Poster-style place labels as an HTML overlay: greedy collision, heightfield occlusion, tiers by zoom.
import * as THREE from "three";
import { h } from "../dom.js";

const ELEV_KINDS = new Set(["peak", "lake", "pass"]);
const TIER_MAX_DIST = { 1: Infinity, 2: 75000, 3: 30000, 4: 15000 };   // camera-to-target distance at which a tier appears
const LEAD = 24;
const DIRS = [[0, -1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [1, 1], [-1, 1]];
const DISTS = [60, 100, 140];
const HERITAGE = new Set(["stupa", "monastery", "palace", "museum", "archaeological_site", "mosque", "fort_ruin", "rock_carving", "temple", "fort"]);
const tierOf = (p) => (HERITAGE.has(p.kind) && p.tier > 1 ? Math.min(p.tier, 1.5) : p.tier);        // heritage ranks just after tier 1
const TIER_KEY = (t) => (t === 1.5 ? 2 : t);
const SVGNS = "http://www.w3.org/2000/svg";
const ICONS = {          // 12 px outline icons: stupa (dome on a plinth), column, arch
  stupa: "M2 11h8M3 11V9h6v2M3.5 9a2.5 2.5 0 0 1 5 0M6 6.5V3M5 3h2",
  column: "M2 11h8M3 9.5h6M4 9.5V4M8 9.5V4M2.5 4h7M6 1.5l3.5 2.5h-7Z",
  arch: "M2 11V6a4 4 0 0 1 8 0v5M4.5 11V6.5a1.5 1.5 0 0 1 3 0V11",
};
const ICON_OF = { stupa: "stupa", monastery: "stupa", palace: "column", museum: "column", archaeological_site: "column", fort_ruin: "column", fort: "column", temple: "column", rock_carving: "column", mosque: "arch" };
function icon(kind) {
  const d = ICONS[ICON_OF[kind]];
  if (!d) return null;
  const s = document.createElementNS(SVGNS, "svg");
  s.setAttribute("viewBox", "0 0 12 12"); s.setAttribute("class", "kic"); s.setAttribute("aria-hidden", "true");
  s.innerHTML = `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>`;
  return s;
}

export class Labels {
  constructor(pack, layer, { onPick, anchorLift = () => 0 } = {}) {
    this.pack = pack; this.layer = layer; this.onPick = onPick; this.anchorLift = anchorLift;
    this.on = true; this.block = null; this.selected = null; this.t = 0;
    this.items = pack.places.filter((p) => p.name).map((p) => this.make(p));
    this.items.sort((a, b) => a.tier - b.tier);
    this.v = new THREE.Vector3(); this.anchor = new THREE.Vector3();
    this.elevAnchor();
  }

  make(p) {
    const e = p.label_elevation_m;
    const chip = h("button", { class: "chip", type: "button", "aria-label": p.name, onClick: (ev) => { ev.stopPropagation(); this.onPick?.(p); } },
      h("span", { class: "nm" }, icon(p.kind), p.short_name || p.name), ELEV_KINDS.has(p.kind) && e != null ? h("span", { class: "el" }, `${Math.round(e).toLocaleString("en")} m`) : null);
    const el = h("div", { class: "lbl off", dataset: { tier: tierOf(p) } }, chip, h("i", { class: "lead" }), h("i", { class: "dot" }));
    this.layer.append(el);
    return { place: p, tier: tierOf(p), ox: 0, oy: -(LEAD + 5), el, chip, w: 80, h: 28, fs: 0, shown: false, want: false, sx: 0, sy: 0, vis: false, fade: 0 };
  }

  /** Anchor in scene space: on the ground (or on top of its model). Call again after exaggeration/scale changes. */
  elevAnchor() {
    for (const it of this.items) {
      const p = it.place, kind = p.kind;
      const base = kind === "lake" ? this.pack.yOf(p.ground_m ?? this.pack.heightAt(p.x, p.z)) : this.pack.groundY(p.x, p.z);
      const ax = p.anchor?.[0] ?? p.x, az = p.anchor?.[1] ?? p.z;
      it.base = kind === "lake" ? base : this.pack.groundY(ax, az);
      it.pos = new THREE.Vector3(ax, it.base + 14 + this.anchorLift(p.slug), az);
    }
  }

  setVisible(on) { this.on = on; this.layer.style.display = on ? "" : "none"; }
  select(slug) { this.selected = slug; for (const it of this.items) it.el.classList.toggle("sel", it.place.slug === slug); }

  update(camera, W, H, camDist, now) {
    const cp = camera.position;
    const slow = now - this.t > 100;
    if (slow) this.t = now;
    for (const it of this.items) {
      this.v.copy(it.pos).project(camera);
      const x = (this.v.x * 0.5 + 0.5) * W, y = (-this.v.y * 0.5 + 0.5) * H;
      it.sx = x; it.sy = y;
      it.onscreen = this.v.z < 1 && x > -40 && x < W + 40 && y > 20 && y < H + 40;
      if (it.onscreen) it.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
    }
    if (slow) for (const it of this.items) if (it.place.model) it.pos.y = it.base + 14 + this.anchorLift(it.place.slug);
    if (!slow || !this.on) return;
    const blockers = [...(this.block ? [this.block] : []), ...(this.blockers?.() ?? [])];
    const taken = [];
    const pad = 5, clash = (r) => taken.some((o) => r[0] < o[2] + pad && r[2] > o[0] - pad && r[1] < o[3] + pad && r[3] > o[1] - pad);
    const cand = this.items.filter((it) => it.onscreen && it.sx > 0 && it.sx < W && it.sy > 0 && it.sy < H &&   // anchor dot must be in the viewport: a chip leadered 140 px in from an off-screen anchor points at nothing
      (it.place.slug === this.selected || camDist <= (TIER_MAX_DIST[TIER_KEY(it.tier)] ?? 15000)));
    cand.sort((a, b) => (a.place.slug === this.selected ? -1 : b.place.slug === this.selected ? 1 : a.tier - b.tier || cp.distanceToSquared(a.pos) - cp.distanceToSquared(b.pos)));
    const show = new Set();
    for (const it of cand) {
      const d = cp.distanceTo(it.pos);
      const fs = Math.round(Math.min(14.5, Math.max(10.5, 13 * Math.pow(26000 / d, 0.18))) * 2) / 2;
      if (fs !== it.fs) { it.fs = fs; it.el.style.setProperty("--fs", `${fs}px`); it.w = it.chip.offsetWidth; it.h = it.chip.offsetHeight; }
      const isSel = it.place.slug === this.selected;
      const mk = (ox, oy) => [it.sx + ox - it.w / 2, it.sy + oy - it.h, it.sx + ox + it.w / 2, it.sy + oy];   // the chip itself; the dot may sit under UI
      const bad = (r) => r[0] < W * 0.04 || r[2] > W * 0.96 || r[1] < H * 0.04 || r[3] > H * 0.96 ||
        blockers.some((b) => r[2] > b[0] && r[0] < b[2] && r[3] > b[1] && r[1] < b[3]) || (!isSel && clash(r));
      let pos = [0, -(LEAD + 5)], rect = mk(pos[0], pos[1]);
      if (bad(rect)) {
        pos = null;
        if (it.tier <= 1 || isSel) {                                      // tier 1: try 8 directions x 3 leader lengths before dropping
          for (const L of DISTS) { for (const [dx, dy] of DIRS) { const q = [dx * L * (dx && dy ? 0.75 : 1), dy * L * (dx && dy ? 0.75 : 1)]; const r = mk(q[0], q[1]); if (!bad(r)) { pos = q; rect = r; break; } } if (pos) break; }
        }
        if (!pos) continue;
      }
      if (it.ox !== pos[0] || it.oy !== pos[1]) {
        it.ox = pos[0]; it.oy = pos[1];
        const len = Math.hypot(pos[0], pos[1]);
        it.el.style.setProperty("--ox", pos[0] + "px"); it.el.style.setProperty("--oy", pos[1] + "px");
        it.el.style.setProperty("--ll", len + "px"); it.el.style.setProperty("--la", Math.atan2(-pos[0], pos[1]) + "rad");
      }
      const occ = !isSel && this.pack.occluded(cp, it.pos, 40 + d * 0.004);
      if (occ && it.tier >= 3) continue;                                                  // tiers 1-2 stay as ghosts
      it.ghost = occ; taken.push(rect); show.add(it);
    }
    for (const it of this.items) {
      const on = show.has(it);
      if (on !== it.shown) { it.shown = on; it.el.classList.toggle("off", !on); }
      it.el.classList.toggle("ghost", on && !!it.ghost);
    }
  }
}
