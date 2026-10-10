// Mighty 22 Falls: the mapped stream (OSM way 345806360) runs down the real DEM slope past the waterfall node and
// meets the Mahodand jeep road at a ford. The water is draped on that line 0.45 m above the ground: animated white
// ribbons, foam and spray at the steepest DEM step, wet dark rocks along both banks, and a small pool at the ford.
// Nothing is raised above the ground more than about 4 m. The fall's height and form are illustrative.
import * as THREE from "three";

// The mapped stream, upper end first (lat, lon), from OSM: about 170 m upslope of the node, past it, to the ford.
const LINE = [
  [35.6379193, 72.6857886],
  [35.6376288, 72.6850738],
  [35.637158, 72.6838537],
  [35.6368963, 72.683312],
];
const STEP = 2;       // metres between samples

/** A streak texture for flowing water: white strands, tiled along the run (the UVs set the length). */
function streaks() {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 256;
  const g = c.getContext("2d");
  g.clearRect(0, 0, 64, 256);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const x = rnd() * 64, w = 1 + rnd() * 4, a = 0.4 + rnd() * 0.5;
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, `rgba(255,255,255,${a})`);
    grd.addColorStop(0.5, `rgba(255,255,255,${a * 0.45})`);
    grd.addColorStop(1, `rgba(255,255,255,${a})`);
    g.fillStyle = grd;
    g.fillRect(x, 0, w, 256);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A soft round spray puff. */
function puffTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, "rgba(255,255,255,0.9)");
  grd.addColorStop(0.5, "rgba(245,252,255,0.45)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export default function build(ctx) {
  const { THREE: T, group, ground, mat, rocks } = ctx;

  // Project the mapped stream into the group's local frame (x right, -z front), then resample every STEP metres.
  const corners = LINE.map(([la, lo]) => { const [wx, wz] = ctx.site.toLocal(la, lo); return ctx.local(wx, wz); });
  const P = [];
  let s = 0;
  for (let k = 0; k < corners.length - 1; k++) {
    const a = corners[k], b = corners[k + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.round(len / STEP));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      P.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, s: s + len * t });
    }
    s += len;
  }
  const end = corners[corners.length - 1];
  P.push({ x: end.x, z: end.z, s });
  for (const p of P) p.g = ground(p.x, p.z);

  // A unit normal at each sample (across the stream).
  const normal = (i) => {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
    const tx = b.x - a.x, tz = b.z - a.z, L = Math.hypot(tx, tz) || 1;
    return { nx: -tz / L, nz: tx / L };
  };

  // Static parts: the pool where the water meets the road, and wet boulders along both banks (merged below).
  const wet = mat(0x2b2723, { roughness: 0.35 });
  const pool = new T.Mesh(
    new T.CircleGeometry(3, 24),
    new T.MeshStandardMaterial({ color: 0x9fcad6, roughness: 0.1, transparent: true, opacity: 0.75 }),
  );
  pool.rotation.x = -Math.PI / 2;
  const lastP = P[P.length - 1];
  pool.position.set(lastP.x, lastP.g + 0.05, lastP.z);
  group.add(pool);
  for (let i = 0; i < P.length; i += 7) {
    const { nx, nz } = normal(i);
    for (const sg of [-1, 1]) {
      rocks(2, P[i].x + nx * sg * 4.2, P[i].z + nz * sg * 4.2, 1.5, 0.6, wet, 50 + i * 2 + (sg > 0 ? 1 : 0));
    }
  }

  // The ribbons: three strips draped on the slope, scrolling downhill. Animated, so they stay out of the batch.
  const tex = streaks();
  tex.repeat.set(1, 1);
  const ribbons = [];
  const ribbon = (offset, width, opacity) => {
    const pos = [], uv = [], idx = [];
    P.forEach((p, i) => {
      const { nx, nz } = normal(i);
      for (const [o, u] of [[offset - width / 2, 0], [offset + width / 2, 1]]) {
        const x = p.x + nx * o, z = p.z + nz * o;
        pos.push(x, ground(x, z) + 0.45, z);
        uv.push(u, p.s / 4);
      }
    });
    for (let i = 0; i < P.length - 1; i++) {
      const a = 2 * i, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new T.Mesh(geo, new T.MeshBasicMaterial({
      map: tex, transparent: true, opacity, depthWrite: false, side: T.DoubleSide, color: 0xffffff,
    }));
    m.userData.keep = true;
    group.add(m);
    ribbons.push(m);
  };
  ribbon(-1.6, 2.2, 0.75);
  ribbon(0, 3.4, 0.85);
  ribbon(1.8, 2.0, 0.7);

  // The steepest DEM step along the line: foam and spray there.
  let steep = 0, best = -1;
  for (let i = 0; i < P.length - 1; i++) {
    const sl = (P[i + 1].g - P[i].g) / Math.max(0.1, P[i + 1].s - P[i].s);
    if (sl > best) { best = sl; steep = i; }
  }
  const pt = puffTexture();
  const puffs = [];
  for (let k = 0; k < 6; k++) {
    const x = P[steep].x + (k - 2.5) * 0.7, z = P[steep].z + (k % 2) * 0.8;
    const sp = new T.Sprite(new T.SpriteMaterial({ map: pt, transparent: true, opacity: 0.6, depthWrite: false }));
    sp.position.set(x, ground(x, z) + 1.0, z);
    sp.scale.setScalar(3 + (k % 2));
    sp.userData.phase = k * 0.9;
    sp.userData.y0 = sp.position.y;
    group.add(sp);
    puffs.push(sp);
  }

  ctx.batch(group);

  return {
    update(dt, t) {
      tex.offset.y = (tex.offset.y + dt * 0.9) % 1;               // water runs downhill (v grows downhill)
      for (const s2 of puffs) {
        const k = (t * 1.3 + s2.userData.phase) % 3;
        s2.material.opacity = 0.2 + 0.4 * Math.sin((k / 3) * Math.PI) ** 2;
        s2.position.y = s2.userData.y0 + 0.6 * (k / 3);
      }
    },
  };
}
