// Story flight: a scripted camera pass along the real road between sourced stops of one pack.
// Road path: shortest path over vectors.json roads (vertices merged within 15 m, dangling road ends joined to a
// neighbour within 120 m). Where no road path exists the camera glides straight and the caption bar says so.
// Captions and sources come only from web/data/stories/*.json, which quote places.json; nothing is generated here.
import * as THREE from "three";
import { h } from "../dom.js";

const SNAP_M = 15, JOIN_M = 120, JOIN_PENALTY = 1.5, STOP_MAX_M = 1500;   // road graph
const ALT_M = 900, BACK_M = 700, LOOK_M = 1200;                           // camera: height above ground, offset behind, look-ahead (real metres)
const PAUSE_S = 4, MOVE_MIN_S = 25, TOTAL_MAX_S = 60, SPEED_MPS = 500;   // timing: 4 s at each stop, 35-60 s in all
const SMOOTH_PER_S = 4, LOW_POWER_HZ = 20, DRAG_PX = 6;

const graphs = new WeakMap();

/** Road graph from vectors.json, cached per vectors object. Nodes: {X, Z, adj: [[node, cost]]}. */
function roadGraph(vectors) {
  if (graphs.has(vectors)) return graphs.get(vectors);
  const idx = new Map(), X = [], Z = [], adj = [];
  const node = (x, z) => {
    const k = Math.round(x / SNAP_M) + "," + Math.round(z / SNAP_M);
    let i = idx.get(k);
    if (i === undefined) { i = X.length; idx.set(k, i); X.push(x); Z.push(z); adj.push([]); }
    return i;
  };
  const link = (a, b, c) => { if (a !== b) { adj[a].push([b, c]); adj[b].push([a, c]); } };
  for (const r of vectors?.roads || []) {
    const pts = r.pts || [];
    for (let k = 1; k < pts.length; k++) {
      const [ax, az] = pts[k - 1], [bx, bz] = pts[k];
      link(node(ax, az), node(bx, bz), Math.hypot(bx - ax, bz - az));
    }
  }
  // A road that stops a few metres short of another: join each dangling end to the nearest node within JOIN_M.
  const grid = new Map(), cellOf = (x, z) => Math.floor(x / JOIN_M) + "," + Math.floor(z / JOIN_M);
  for (let i = 0; i < X.length; i++) {
    const k = cellOf(X[i], Z[i]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  for (let i = 0; i < X.length; i++) {
    if (adj[i].length !== 1) continue;
    const cx = Math.floor(X[i] / JOIN_M), cz = Math.floor(Z[i] / JOIN_M);
    let best = -1, bd = JOIN_M;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const j of grid.get(`${cx + dx},${cz + dz}`) || []) {
        const d = Math.hypot(X[j] - X[i], Z[j] - Z[i]);
        if (j !== i && d < bd && !adj[i].some(([w]) => w === j)) { bd = d; best = j; }
      }
    }
    if (best >= 0) link(i, best, bd * JOIN_PENALTY);
  }
  const g = { X, Z, adj };
  graphs.set(vectors, g);
  return g;
}

function nearestNode(g, x, z) {
  let best = -1, bd = STOP_MAX_M;
  for (let i = 0; i < g.X.length; i++) {
    const d = Math.hypot(g.X[i] - x, g.Z[i] - z);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Dijkstra with a small binary heap. Returns [[x, z], ...] from node s to node t, or null. */
function shortestPath(g, s, t) {
  const n = g.X.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
  dist[s] = 0;
  const heap = [[0, s]];
  const push = (e) => {
    heap.push(e);
    for (let i = heap.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]]; i = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, u] = pop();
    if (u === t) break;
    if (d > dist[u]) continue;
    for (const [w, c] of g.adj[u]) {
      const nd = d + c;
      if (nd < dist[w]) { dist[w] = nd; prev[w] = u; push([nd, w]); }
    }
  }
  if (!Number.isFinite(dist[t])) return null;
  const out = [];
  for (let u = t; u !== -1; u = prev[u]) out.push([g.X[u], g.Z[u]]);
  return out.reverse();
}

/** One leg between two stop positions: the road polyline if a road path exists, else a straight glide. */
function legBetween(vectors, a, b) {
  const g = roadGraph(vectors);
  const sa = nearestNode(g, a[0], a[1]), sb = nearestNode(g, b[0], b[1]);
  const mid = sa >= 0 && sb >= 0 ? shortestPath(g, sa, sb) : null;
  return mid ? { pts: [a, ...mid, b], road: true } : { pts: [a, b], road: false };
}

/** Flatten legs into one polyline with cumulative arc length, and note where each stop sits on it. */
function buildRoute(vectors, stopPos) {
  const flat = [stopPos[0]], cum = [0], stopIdx = [0], legs = [];
  for (let i = 0; i + 1 < stopPos.length; i++) {
    const leg = legBetween(vectors, stopPos[i], stopPos[i + 1]);
    for (const p of leg.pts.slice(1)) {                 // pts[0] is the stop, already in flat
      const q = flat[flat.length - 1];
      cum.push(cum[cum.length - 1] + Math.hypot(p[0] - q[0], p[1] - q[1]));
      flat.push(p);
    }
    legs.push({ i, s0: cum[stopIdx[i]], s1: cum[flat.length - 1], road: leg.road });
    stopIdx.push(flat.length - 1);
  }
  return { flat, cum, stopIdx, legs, total: cum[cum.length - 1] };
}

export class StoryFlight {
  constructor({ camera, controls, pack, places = [], vectors = {}, onStop = () => {}, onEnd = () => {}, openPlace, root, lowPower = false } = {}) {
    Object.assign(this, { camera, controls, pack, places, vectors, onStop, onEnd, openPlace, lowPower });
    this.root = root || document.body;
    this.running = false; this.story = null; this.route = null; this.phases = []; this.pi = 0; this.t = 0; this.acc = 0;
    this.cur = null; this.look = null; this.stopsData = [];
    this.bar = h("div", { class: "sf-bar", role: "status", "aria-live": "polite", hidden: true });
    this.barText = h("span", { class: "sf-bt" });
    this.bar.append(this.barText, h("button", { type: "button", class: "sf-x", onClick: () => this.stop("cancelled") }, "End flight"));
    this.kicker = h("p", { class: "sf-k" });
    this.name = h("h2", { class: "sf-n" });
    this.caption = h("p", { class: "sf-c" });
    this.sources = h("p", { class: "sf-src" });
    this.card = h("aside", { class: "sf-card", role: "dialog", "aria-label": "Story stop", hidden: true },
      this.kicker, this.name, this.caption, this.sources,
      h("div", { class: "sf-row" },
        h("button", { type: "button", class: "sf-open", onClick: () => this.openStop() }, "Open"),
        h("button", { type: "button", class: "sf-x", onClick: () => this.stop("cancelled") }, "End flight")));
    this.root.append(this.bar, this.card);
    this.onKey = () => this.stop("cancelled");
    this.onWheel = () => this.stop("cancelled");
    this.down = null;
    this.onDown = (e) => { if (!this.inUi(e.target)) this.down = { x: e.clientX, y: e.clientY }; };
    this.onMove = (e) => { if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > DRAG_PX) this.stop("cancelled"); };
    this.onUp = () => { this.down = null; };
  }

  inUi(t) { return this.card.contains(t) || this.bar.contains(t); }
  emit() { document.dispatchEvent(new CustomEvent("storyflight", { detail: { running: this.running, id: this.story?.id ?? null } })); }

  /** Start a story ({id, pack, title, stops:[{slug, name, caption, sources}]}). Returns false if it cannot run. */
  start(story) {
    if (this.running) this.stop("replaced");
    if (!story || story.pack !== this.pack.slug) { console.warn("storyflight: story is for another pack"); return false; }
    const stops = [];
    for (const s of story.stops || []) {
      const pl = this.places.find((p) => p.slug === s.slug);
      if (!pl) { console.warn(`storyflight: no place ${s.slug} in ${this.pack.slug}`); continue; }
      stops.push({ ...s, place: pl, pos: [pl.anchor?.[0] ?? pl.x, pl.anchor?.[1] ?? pl.z] });
    }
    if (stops.length < 2) return false;
    this.story = story; this.stopsData = stops;
    this.route = buildRoute(this.vectors, stops.map((s) => s.pos));
    const r = this.route, nStops = stops.length;
    const pausesTotal = nStops * PAUSE_S;
    const moveTotal = Math.min(TOTAL_MAX_S - pausesTotal, Math.max(MOVE_MIN_S, r.total / SPEED_MPS));
    this.phases = [{ kind: "pause", stop: 0, dur: PAUSE_S }];
    for (const L of r.legs) {
      const frac = r.total ? (L.s1 - L.s0) / r.total : 1 / r.legs.length;
      this.phases.push({ kind: "move", leg: L, dur: Math.max(2, moveTotal * frac) });
      this.phases.push({ kind: "pause", stop: L.i + 1, dur: PAUSE_S });
    }
    let t0 = 0;
    for (const ph of this.phases) { ph.t0 = t0; t0 += ph.dur; }
    this.totalS = t0;
    this.pi = 0; this.t = 0; this.acc = 0; this.cur = null;
    this.running = true;
    this.controls.tween = null;
    this.controls.c.enabled = false;
    this.bar.hidden = false; this.card.hidden = true;
    addEventListener("keydown", this.onKey, true);
    addEventListener("wheel", this.onWheel, { passive: true, capture: true });
    addEventListener("pointerdown", this.onDown, true);
    addEventListener("pointermove", this.onMove, true);
    addEventListener("pointerup", this.onUp, true);
    this.emit();
    return true;
  }

  /** Stop the flight. reason: "finished" | "cancelled" | "replaced". Keeps the camera where it is. */
  stop(reason = "cancelled") {
    if (!this.running) return;
    this.running = false;
    removeEventListener("keydown", this.onKey, true);
    removeEventListener("wheel", this.onWheel, true);
    removeEventListener("pointerdown", this.onDown, true);
    removeEventListener("pointermove", this.onMove, true);
    removeEventListener("pointerup", this.onUp, true);
    this.bar.hidden = true; this.card.hidden = true;
    const c = this.controls.c;
    if (this.look) { c.target.set(...this.look); }
    c.enabled = true; c.update();
    this.emit();
    this.onEnd({ reason, id: this.story?.id ?? null });
  }

  dispose() { this.stop("cancelled"); this.bar.remove(); this.card.remove(); }

  openStop() {
    const s = this.stopsData[this.shownStop];
    if (s) this.openPlace?.(s.slug);
  }

  showStop(i) {
    const s = this.stopsData[i];
    this.shownStop = i;
    this.kicker.textContent = `Stop ${i + 1} of ${this.stopsData.length}`;
    this.name.textContent = s.name || s.place.name;
    this.caption.textContent = s.caption || "";
    this.sources.replaceChildren(...(s.sources || []).map((src) => h("a", { href: src.url, target: "_blank", rel: "noopener" }, src.url.replace(/^https?:\/\//, ""))));
    this.card.hidden = false;
    this.onStop({ index: i, slug: s.slug, name: s.name, caption: s.caption, sources: s.sources || [] });
  }

  /** Camera pose at arc position s: behind the road point, looking ahead along it. */
  poseAt(s) {
    const r = this.route, pack = this.pack;
    const at = (q) => {
      q = Math.min(r.total, Math.max(0, q));
      let lo = 0, hi = r.cum.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (r.cum[m] <= q) lo = m; else hi = m; }
      const a = r.flat[lo], b = r.flat[Math.min(hi, r.flat.length - 1)];
      const span = r.cum[hi] - r.cum[lo] || 1, t = Math.min(1, Math.max(0, (q - r.cum[lo]) / span));
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    };
    const p = at(s);
    let q = at(s + LOOK_M);
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 1) q = at(s - LOOK_M);
    let dx = q[0] - p[0], dz = q[1] - p[1];
    const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const cx = p[0] - dx * BACK_M, cz = p[1] - dz * BACK_M;
    const cy = pack.groundY(cx, cz) + ALT_M * pack.exag;
    const look = new THREE.Vector3(q[0], pack.groundY(q[0], q[1]), q[1]);
    return { cam: new THREE.Vector3(cx, cy, cz), look };
  }

  /** Call once per frame after controls.update(), before rendering. dt in seconds. */
  update(dt) {
    if (!this.running) return;
    if (this.lowPower) { this.acc += dt; if (this.acc < 1 / LOW_POWER_HZ) return; dt = this.acc; this.acc = 0; }
    this.t += dt;
    while (this.pi < this.phases.length && this.t >= this.phases[this.pi].t0 + this.phases[this.pi].dur) this.pi++;
    if (this.pi >= this.phases.length) { this.stop("finished"); return; }
    const ph = this.phases[this.pi], u = Math.min(1, Math.max(0, (this.t - ph.t0) / ph.dur));
    let s, glideNote = "";
    if (ph.kind === "pause") {
      s = this.route.cum[this.route.stopIdx[ph.stop]];
      if (this.shownStop !== ph.stop || this.card.hidden) this.showStop(ph.stop);
      this.barText.textContent = `${this.story.title} · stop ${ph.stop + 1} of ${this.stopsData.length}`;
    } else {
      if (!this.card.hidden) this.card.hidden = true;
      const e = u * u * (3 - 2 * u);                         // ease in and out at each stop
      s = ph.leg.s0 + (ph.leg.s1 - ph.leg.s0) * e;
      const a = this.stopsData[ph.leg.i].name, b = this.stopsData[ph.leg.i + 1].name;
      glideNote = ph.leg.road ? "" : ` · no road path between ${a} and ${b} in this pack, so the camera glides straight`;
      this.barText.textContent = `${this.story.title} · ${a} to ${b}${glideNote}`;
    }
    const { cam, look } = this.poseAt(s);
    this.look = look.toArray();
    if (!this.cur) this.cur = { cam: cam.clone(), look: look.clone() };
    const k = 1 - Math.exp(-SMOOTH_PER_S * dt);
    this.cur.cam.lerp(cam, k); this.cur.look.lerp(look, k);
    this.camera.position.copy(this.cur.cam);
    this.camera.lookAt(this.cur.look);
    this.controls.c.target.copy(this.cur.look);
  }
}

/** Dock button for the page's explore bar, or null when the data has no story for this pack. */
export function storyButton(flight, data, slug) {
  const story = (data?.stories || []).find((s) => s.pack === slug);
  if (!story) return null;
  const btn = h("button", { type: "button", class: "sf-dock", title: story.title, "aria-pressed": "false" }, "Story flight");
  const sync = (e) => {
    const on = !!e.detail?.running && e.detail.id === story.id;
    btn.textContent = on ? "End story flight" : "Story flight";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  };
  document.addEventListener("storyflight", sync);
  btn.addEventListener("click", () => (flight.running && flight.story?.id === story.id ? flight.stop("cancelled") : flight.start(story)));
  return btn;
}
