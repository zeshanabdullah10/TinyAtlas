// Malam Jabba Ski Resort: the chairlift from its OSM way (ctx.lm.lifts, [name, kind, [[lat, lon], ...]], base first),
// its pylons at the way's interior nodes, the stations at both ends, the cable with its sag, a return cable, moving
// chairs, and the downhill piste (ctx.lm.pistes) as a pale cleared strip over the DEM. Heights of pylons, stations,
// sag, chairs and speed are estimated; positions are OSM's, ground is the Copernicus DSM.
import * as THREE from "three";

const PYLON_H = 10;      // estimated steel pylon height, m
const CABLE_PYLON = PYLON_H - 0.4;
const CABLE_STATION = 5; // cable height above the station ground, m
const SAG = 2.5;         // estimated cable sag between pylons, m
const RETURN_OFFSET = 1.5;
const CHAIR_SPEED = 1.6; // illustrative, m/s
const CHAIR_GAP = 45;    // illustrative spacing along the loop, m

/** Dense polyline in group-local metres, every ~4 m, with cumulative lengths for interpolation. */
function polyline(pts, step = 4) {
  const out = [pts[0].clone()];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / step));
    for (let k = 1; k <= n; k++) out.push(a.clone().lerp(b, k / n));
  }
  const cum = [0];
  for (let i = 1; i < out.length; i++) cum.push(cum[i - 1] + out[i].distanceTo(out[i - 1]));
  return { pts: out, cum, len: cum[cum.length - 1] };
}

/** Point and unit tangent at arc length s (metres). */
function at(poly, s) {
  const { pts, cum } = poly;
  s = Math.min(Math.max(s, 0), poly.len);
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const seg = cum[hi] - cum[lo] || 1, f = (s - cum[lo]) / seg;
  const p = pts[lo].clone().lerp(pts[hi], f);
  const t = pts[hi].clone().sub(pts[lo]).normalize();
  return { p, t };
}

/** Is (x, z) inside the ring of [x, z] points (even-odd rule). */
function inside(ring, x, z) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

export default function build(ctx) {
  const { THREE: T, M, group: g } = ctx;
  const toLocal = (ll) => { const [x, z] = ctx.site.toLocal(ll[0], ll[1]); return ctx.local(x, z); };
  const metal = M.metal, dark = M.dark, plaster = M.plaster;
  const chairMat = new THREE.MeshStandardMaterial({ color: 0xc2452d, roughness: 0.7 });

  // ---- the chairlift (first entry with a chair_lift kind) -----------------------------------------------------
  const lift = (ctx.lm.lifts || []).find((l) => l[1] === "chair_lift");
  const updates = [], animated = [];   // animated meshes are added after the static parts are merged
  if (lift) {
    const nodes = lift[2].map((ll) => { const p = toLocal(ll); return new THREE.Vector3(p.x, ctx.ground(p.x, p.z), p.z); });
    const last = nodes.length - 1;
    // Pylons at the interior nodes; stations at both ends.
    for (let i = 1; i < last; i++) {
      const a = nodes[i - 1], b = nodes[i + 1], p = nodes[i];
      const ang = Math.atan2(b.x - a.x, b.z - a.z);
      const gy = p.y;
      for (const [dx, dz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) {
        ctx.cyl(g, 0.12, 0.32, PYLON_H, metal, p.x + dx, gy, p.z + dz, 8);
      }
      ctx.box(g, 5.2, 0.35, 0.45, metal, p.x, gy + PYLON_H - 1.0, p.z, ang);      // cross-arm, across the line
    }
    const station = (p, a) => {
      const ang = Math.atan2(a.x - p.x, a.z - p.z);
      ctx.box(g, 6, 4.5, 8, plaster, p.x, p.y, p.z, ang);
      ctx.box(g, 7, 0.4, 9, dark, p.x, p.y + 4.5, p.z, ang);
    };
    station(nodes[0], nodes[1]);
    station(nodes[last], nodes[last - 1]);

    // Cable: the pylon tops, the stations, with a sag between each pair (estimated). Two runs: up and return.
    const top = nodes.map((p, i) => new THREE.Vector3(p.x, p.y + (i === 0 || i === last ? CABLE_STATION : CABLE_PYLON), p.z));
    const sagged = [];
    for (let i = 0; i < last; i++) {
      const a = top[i], b = top[i + 1], n = Math.max(2, Math.ceil(a.distanceTo(b) / 4));
      for (let k = 0; k < n; k++) {
        const t = k / n, q = a.clone().lerp(b, t);
        q.y -= SAG * 4 * t * (1 - t);
        sagged.push(q);
      }
    }
    sagged.push(top[last].clone());
    const up = polyline(sagged);
    // Return run: the same line, offset sideways from the base-to-top direction.
    const dir = top[last].clone().sub(top[0]); dir.y = 0; dir.normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(RETURN_OFFSET);
    const down = polyline(sagged.map((q) => q.clone().add(side)));
    for (const run of [up, down]) {
      const curve = new THREE.CatmullRomCurve3(run.pts);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, run.pts.length), 0.055, 6), dark);
      tube.castShadow = true; g.add(tube);
    }

    // Chairs: a loop of 2 x up-length, moved along by time (userData.keep, so the batch leaves them alone).
    const loop = 2 * up.len;
    const n = Math.max(8, Math.round(loop / CHAIR_GAP));
    const chairGeo = new THREE.BoxGeometry(1.1, 0.7, 0.45);
    const hangerGeo = new THREE.BoxGeometry(0.06, 1.55, 0.06);
    const chairs = new THREE.InstancedMesh(chairGeo, chairMat, n);
    const hangers = new THREE.InstancedMesh(hangerGeo, metal, n);
    chairs.castShadow = hangers.castShadow = true;
    chairs.userData.keep = hangers.userData.keep = true;
    const dummy = new THREE.Object3D();
    // phase in [0, 2): 0..1 up the line, 1..2 back down the return run.
    const chairAt = (i, t) => {
      const phase = (((i * 2) / n + (t * CHAIR_SPEED) / up.len) % 2 + 2) % 2;
      const onUp = phase < 1;
      const r = onUp ? at(up, phase * up.len) : at(down, (2 - phase) * down.len);
      return { p: r.p, tan: onUp ? r.t : r.t.clone().negate() };
    };
    const pose = (t) => {
      for (let i = 0; i < n; i++) {
        const { p, tan } = chairAt(i, t);
        dummy.position.set(p.x, p.y - 1.9, p.z);
        dummy.rotation.set(0, Math.atan2(tan.x, tan.z), 0);
        dummy.updateMatrix(); chairs.setMatrixAt(i, dummy.matrix);
        dummy.position.set(p.x, p.y - 0.78, p.z);
        dummy.updateMatrix(); hangers.setMatrixAt(i, dummy.matrix);
      }
      chairs.instanceMatrix.needsUpdate = hangers.instanceMatrix.needsUpdate = true;
    };
    pose(0);
    animated.push(chairs, hangers);
    updates.push((dt, t) => pose(t));
  }

  // ---- the downhill piste: a pale strip on a 12 m grid, each cell draped on the DEM ---------------------------
  for (const [, ll] of ctx.lm.pistes || []) {
    const ring = ll.map((p) => { const q = toLocal(p); return [q.x, q.z]; });
    const xs = ring.map((r) => r[0]), zs = ring.map((r) => r[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const step = 12, pos = [];
    const y = (x, z) => ctx.ground(x, z) + 0.25;
    for (let x = x0; x < x1; x += step) for (let z = z0; z < z1; z += step) {
      const cx = x + step / 2, cz = z + step / 2;
      if (!inside(ring, cx, cz)) continue;
      const a = [x, z], b = [x + step, z], c = [x + step, z + step], d = [x, z + step];
      for (const [p, q, r] of [[a, b, c], [a, c, d]]) for (const v of [p, q, r]) pos.push(v[0], y(v[0], v[1]), v[1]);
    }
    if (pos.length) {
      const geo = new T.BufferGeometry();
      geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      const mesh = new T.Mesh(geo, new T.MeshStandardMaterial({ color: 0xcdd5cf, roughness: 1 }));
      mesh.receiveShadow = true; g.add(mesh);
    }
  }

  ctx.batch(g);                       // one mesh per material for the static parts
  for (const m of animated) g.add(m);
  return updates.length ? { update(dt, t) { for (const u of updates) u(dt, t); } } : undefined;
}
