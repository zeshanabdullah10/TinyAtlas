// Day planner that runs entirely in the browser: a road graph from the pack's vectors.json, shortest path by travel time,
// and an honest estimate per leg (length of each mapped road class at a stated speed; climbs from height.bin).
// Mirrors backend/tinyatlas/atlaspack.py (CLASS_KMH) and planner.py (long-day rule, altitude rule). Scene metres throughout.

export const KMH = { paved: 40, minor: 25, jeep: 14, track: 9, walk: 3.5 };
export const LABEL = { paved: "paved road", minor: "minor road", jeep: "jeep track", track: "rough track", walk: "on foot" };
const SNAP_M = 15, JOIN_M = 120, JOIN_PENALTY = 1.5;      // same graph rules as storyflight.js
const GAP_WALK_M = 30, GAP_NOTE_M = 400, GAP_MAX_M = 3000, MIN_COMP = 50;
export const LONG_DAY_MIN = 360, ALT_START_M = 3000, ALT_STEP_M = 500, BIG_CLIMB_M = 1000;
const mins = (m, cls) => (m / 1000 / KMH[cls]) * 60;

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(k, v) {
    const a = this.a; a.push([k, v]);
    for (let i = a.length - 1, p; i > 0 && a[(p = (i - 1) >> 1)][0] > a[i][0]; i = p) [a[p], a[i]] = [a[i], a[p]];
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      for (let i = 0;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

function buildGraph(vectors) {
  const idx = new Map(), X = [], Z = [], adj = [];
  const node = (x, z) => {
    const k = Math.round(x / SNAP_M) + "," + Math.round(z / SNAP_M);
    let i = idx.get(k);
    if (i === undefined) { i = X.length; idx.set(k, i); X.push(x); Z.push(z); adj.push([]); }
    return i;
  };
  const link = (a, b, m, cls, pen = 1) => {
    if (a === b) return;
    const c = mins(m, cls) * pen;
    adj[a].push([b, c, m, cls]); adj[b].push([a, c, m, cls]);
  };
  for (const r of vectors?.roads || []) {
    const cls = r.class === "path" ? "walk" : KMH[r.class] ? r.class : "minor", pts = r.pts || [];
    for (let k = 1; k < pts.length; k++) link(node(...pts[k - 1]), node(...pts[k]), Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]), cls);
  }
  const grid = new Map(), cell = (x, z) => Math.floor(x / JOIN_M) + "," + Math.floor(z / JOIN_M);
  for (let i = 0; i < X.length; i++) { const k = cell(X[i], Z[i]); (grid.get(k) || grid.set(k, []).get(k)).push(i); }
  for (let i = 0; i < X.length; i++) {                       // a road that stops short of another: join its dangling end
    if (adj[i].length !== 1) continue;
    const cx = Math.floor(X[i] / JOIN_M), cz = Math.floor(Z[i] / JOIN_M);
    let best = -1, bd = JOIN_M;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const j of grid.get(`${cx + dx},${cz + dz}`) || []) {
      const d = Math.hypot(X[j] - X[i], Z[j] - Z[i]);
      if (j !== i && d < bd && !adj[i].some((e) => e[0] === j)) { bd = d; best = j; }
    }
    if (best >= 0) link(i, best, bd, adj[i][0][3], JOIN_PENALTY);
  }
  const comp = new Int32Array(X.length).fill(-1), size = [];       // connected components: stops snap only to real networks
  for (let s = 0; s < X.length; s++) {
    if (comp[s] >= 0) continue;
    const st = [s]; comp[s] = size.length; let n = 0;
    while (st.length) { const u = st.pop(); n++; for (const e of adj[u]) if (comp[e[0]] < 0) { comp[e[0]] = size.length; st.push(e[0]); } }
    size.push(n);
  }
  return { X, Z, adj, ok: (i) => size[comp[i]] >= MIN_COMP };
}

const planners = new WeakMap();
/** Planner for a loaded Pack (built once). */
export function localPlanner(pack) {
  if (planners.has(pack)) return planners.get(pack);
  const g = buildGraph(pack.vectors), trees = new Map(), snaps = new Map(), legs = new Map();
  const posOf = (p) => [p.anchor?.[0] ?? p.x, p.anchor?.[1] ?? p.z];

  const snap = (p) => {
    if (snaps.has(p.slug)) return snaps.get(p.slug);
    const [x, z] = posOf(p); let best = -1, bd = Infinity;
    for (let i = 0; i < g.X.length; i++) {
      const d = Math.hypot(g.X[i] - x, g.Z[i] - z);
      if (d < bd && g.ok(i)) { bd = d; best = i; }
    }
    const s = best >= 0 && bd <= GAP_MAX_M ? { node: best, gap: bd, x, z } : { node: -1, gap: bd, x, z };
    snaps.set(p.slug, s);
    return s;
  };
  const tree = (src) => {                                    // Dijkstra by travel time from one node
    if (trees.has(src)) return trees.get(src);
    const dist = new Float64Array(g.X.length).fill(Infinity), prev = new Int32Array(g.X.length).fill(-1), prevE = new Array(g.X.length), h = new Heap();
    dist[src] = 0; h.push(0, src);
    while (h.size) {
      const [d, u] = h.pop();
      if (d > dist[u]) continue;
      for (const e of g.adj[u]) if (d + e[1] < dist[e[0]]) { dist[e[0]] = d + e[1]; prev[e[0]] = u; prevE[e[0]] = e; h.push(dist[e[0]], e[0]); }
    }
    const t = { dist, prev, prevE }; trees.set(src, t); return t;
  };
  const ascent = (pts) => {                                  // sum of rises along the path, heights sampled every ~60 m
    let up = 0, last = null;
    for (let k = 1; k < pts.length; k++) {
      const [ax, az] = pts[k - 1], [bx, bz] = pts[k], n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 60));
      for (let s = last === null ? 0 : 1; s <= n; s++) {
        const hh = pack.heightAt(ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n);
        if (last !== null && hh > last) up += hh - last;
        last = hh;
      }
    }
    return Math.round(up);
  };

  /** One leg between two places: {ok, km, minutes, mix (km per class), ascent_m, gap_m (walked to/from the roads), pts}. */
  const leg = (a, b) => {
    const key = a.slug + ">" + b.slug;
    if (legs.has(key)) return legs.get(key);
    const A = snap(a), B = snap(b), mix = { paved: 0, minor: 0, jeep: 0, track: 0, walk: 0 };
    let out = { ok: false, from: a.slug, to: b.slug };
    if (A.node >= 0 && B.node >= 0) {
      const t = tree(A.node);
      if (Number.isFinite(t.dist[B.node])) {
        const mid = [[g.X[B.node], g.Z[B.node]]];
        for (let u = B.node; u !== A.node; u = t.prev[u]) { const e = t.prevE[u]; mix[e[3]] += e[2]; mid.push([g.X[t.prev[u]], g.Z[t.prev[u]]]); }
        const pts = [[A.x, A.z], ...mid.reverse(), [B.x, B.z]];
        const gaps = [A.gap, B.gap].map((d) => (d > GAP_WALK_M ? d : 0));
        mix.walk += gaps[0] + gaps[1];
        let m = 0;
        for (const c in mix) { m += mix[c]; }
        const minutes = Object.keys(mix).reduce((s, c) => s + mins(mix[c], c), 0);
        out = { ok: true, from: a.slug, to: b.slug, km: m / 1000, minutes, mix: Object.fromEntries(Object.entries(mix).map(([c, v]) => [c, v / 1000])),
          ascent_m: ascent(pts), gap_m: Math.max(...gaps) > GAP_NOTE_M ? Math.round(Math.max(...gaps)) : 0, pts };
      }
    }
    legs.set(key, out);
    return out;
  };
  const cost = (a, b) => { const l = leg(a, b); return l.ok ? l.minutes : 1e6 + Math.hypot(...posOf(a).map((v, i) => v - posOf(b)[i])); };

  /** Start fixed; nearest neighbour then 2-opt on the open path, by travel time. */
  const bestOrder = (stops) => {
    if (stops.length < 3) return stops.slice();
    const rest = stops.slice(1); let order = [stops[0]];
    while (rest.length) {
      const last = order[order.length - 1]; let bi = 0;
      rest.forEach((p, i) => { if (cost(last, p) < cost(last, rest[bi])) bi = i; });
      order.push(rest.splice(bi, 1)[0]);
    }
    const total = (o) => o.slice(1).reduce((s, p, i) => s + cost(o[i], p), 0);
    for (let improved = true; improved;) {
      improved = false;
      for (let i = 1; i < order.length - 1; i++) for (let j = i + 1; j < order.length; j++) {
        const o = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
        if (total(o) < total(order) - 1e-6) { order = o; improved = true; }
      }
    }
    return order;
  };

  /** Everything the sheet shows for an ordered list of places. */
  const plan = (stops) => {
    const legsOut = stops.slice(1).map((p, i) => leg(stops[i], p));
    const okLegs = legsOut.filter((l) => l.ok);
    const rounded = okLegs.map((l) => Math.round(l.minutes));
    return { legs: legsOut, km: okLegs.reduce((s, l) => s + l.km, 0), minutes: rounded.reduce((s, v) => s + v, 0),
      ascent_m: okLegs.reduce((s, l) => s + l.ascent_m, 0), pts: okLegs.flatMap((l) => l.pts) };
  };
  const api = { leg, plan, bestOrder, posOf, near: (p, list) => list.slice().sort((x, y) => Math.hypot(...posOf(x).map((v, i) => v - posOf(p)[i])) - Math.hypot(...posOf(y).map((v, i) => v - posOf(p)[i]))) };
  planners.set(pack, api);
  return api;
}

/** Sunset (local minutes after midnight, UTC+5 as everywhere in these packs) for a date at the pack's centre; null if unknown. */
export function sunsetMin(pack, date) {
  const m = pack.meta, zone = /EPSG:326(\d\d)/.exec(m.crs || "")?.[1];
  if (!zone || !m.origin_utm) return null;
  const E = m.origin_utm[0] + m.size_m[0] / 2, N = m.origin_utm[1] - m.size_m[1] / 2;
  const lat = N / 110574, lon = (+zone * 6 - 183) + (E - 500000) / (111320 * Math.cos((lat * Math.PI) / 180));
  const n = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 864e5), r = Math.PI / 180;
  const decl = 23.44 * r * Math.sin((2 * Math.PI * (284 + n)) / 365), b = (2 * Math.PI * (n - 81)) / 364;
  const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
  const c = (Math.cos(90.833 * r) - Math.sin(lat * r) * Math.sin(decl)) / (Math.cos(lat * r) * Math.cos(decl));
  if (Math.abs(c) > 1) return null;
  return Math.round(720 - 4 * lon - eot + 4 * Math.acos(c) / r + 300);
}
