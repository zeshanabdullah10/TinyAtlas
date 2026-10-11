// Mighty 22 Falls: the mapped stream (OSM way 345806360) comes down the real DEM slope above the waterfall node and
// meets the Mahodand jeep road at a ford. The fall is drawn where the DEM along that line falls steepest (measured on
// the page's own ground, see FALL and meta.edits): a band of grey cliff over the steep stretch, the water leaving the
// lip of its steepest 31 m in a free curtain, a plunge pool held by fallen rock at its foot, spray, wet dark rock, and
// the cascade on down to the ford. The DEM's 30 m cells smooth any vertical step, so the free fall, the rock and the
// pool are illustrative; the drop over the section is the DEM's. No published height.
import * as THREE from "three";

// The mapped stream (lat, lon), upper end first, from 470 m above the node down to the ford (OSM way 345806360).
const LINE = [
  [35.6401386, 72.688669], [35.639877, 72.6881433], [35.639319, 72.6873708], [35.6386905, 72.6865527], [35.63837, 72.6863802],
  [35.6380294, 72.6862939], [35.6379193, 72.6857886], [35.6376288, 72.6850738], [35.637158, 72.6838537], [35.6368963, 72.683312],
];
const STEP = 1.5;            // metres between samples
// Along the line from its upper end (m): the steep section, and its steepest stretch that the water leaves in a free
// fall. Found on the DEM as the page reads it (the build's grid): see build() which re-measures and reports them.
const FALL = { from: 214, to: 414, lip: 242, foot: 275 };

function streaks(n = 30, alpha = 0.55) {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 256;
  const g = c.getContext("2d");
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = "rgba(225,236,238,0.55)"; g.fillRect(0, 0, 64, 256);
  for (let i = 0; i < n; i++) {
    const x = rnd() * 64, w = 1 + rnd() * 5, a = alpha + rnd() * 0.4;
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, `rgba(255,255,255,${a})`); grd.addColorStop(0.5, `rgba(255,255,255,${a * 0.35})`); grd.addColorStop(1, `rgba(255,255,255,${a})`);
    g.fillStyle = grd; g.fillRect(x, 0, w, 256);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function puffTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, "rgba(255,255,255,0.85)"); grd.addColorStop(0.5, "rgba(245,252,255,0.4)"); grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export default function build(ctx) {
  const { THREE: T, group, ground, hash, masonry } = ctx;
  const CLIFF = masonry(0x8a857b, { alt: 0xa29c90, rubble: true, block: 3.2, joint: 0.8 });   // grey cliff, as in photo 02
  const WET = masonry(0x5c5953, { alt: 0x6d6961, rubble: true, block: 1.4, joint: 0.8 });

  // The stream in local metres, resampled every STEP m, with the ground under each sample.
  const corners = LINE.map(([la, lo]) => { const [wx, wz] = ctx.site.toLocal(la, lo); return ctx.local(wx, wz); });
  const P = [];
  let s = 0;
  for (let k = 0; k < corners.length - 1; k++) {
    const a = corners[k], b = corners[k + 1], len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.round(len / STEP));
    for (let i = 0; i < n; i++) { const t = i / n; P.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, s: s + len * t }); }
    s += len;
  }
  P.push({ x: corners.at(-1).x, z: corners.at(-1).z, s });
  for (const p of P) p.g = ground(p.x, p.z);
  const at = (sv) => P[Math.min(P.length - 1, Math.max(0, Math.round(sv / STEP)))];
  // Re-measure on the ground as drawn and say it in the console of a check (the numbers in meta.edits come from this).
  const sec = at(FALL.to).s - at(FALL.from).s, drop = at(FALL.from).g - at(FALL.to).g, free = at(FALL.lip).g - at(FALL.foot).g;
  group.userData.fall = { section_m: Math.round(sec), drop_m: Math.round(drop), steepest_m: Math.round(free), steepest_run_m: FALL.foot - FALL.lip };
  const across = (i) => {
    const a = P[Math.max(0, i - 2)], b = P[Math.min(P.length - 1, i + 2)], tx = b.x - a.x, tz = b.z - a.z, L = Math.hypot(tx, tz) || 1;
    return { nx: -tz / L, nz: tx / L, tx: tx / L, tz: tz / L };
  };

  // The water's height along the line: 0.35 m over the ground, except the free fall from the lip, a parabola that
  // leaves the lip level and meets the plunge pool at the foot.
  const lip = at(FALL.lip), foot = at(FALL.foot), pool = foot.g + 0.9;
  const kf = (lip.g + 0.4 - pool) / (FALL.foot - FALL.lip) ** 2;
  const surf = (p) => (p.s > FALL.lip && p.s < FALL.foot ? Math.max(p.g + 0.35, lip.g + 0.4 - kf * (p.s - FALL.lip) ** 2) : p.g + 0.35);
  const inFall = (p) => p.s >= FALL.from && p.s <= FALL.to;

  // The cliff band: a skin of grey rock draped over the steep section, 22-34 m either side of the water, standing a
  // little proud of the DEM, and outcrops (angular blocks 2-6 m) along the gully sides. Wet near the water.
  const skin = [], wet = [];
  for (let i = 0; i < P.length - 1; i += 2) {
    const p = P[i];
    if (!inFall(p)) continue;
    const w = 30 + 16 * Math.sin(p.s * 0.04) ** 2, { nx, nz } = across(i);
    for (let o = -w; o < w; o += 4) {
      const ax = p.x + nx * o, az = p.z + nz * o, q = P[Math.min(P.length - 1, i + 2)];
      const bx = q.x + nx * o, bz = q.z + nz * o;
      const quad = [[ax, az], [ax + nx * 4, az + nz * 4], [bx + nx * 4, bz + nz * 4], [bx, bz]];
      const list = Math.abs(o + 2) < 7 ? wet : skin;
      for (const k of [0, 1, 2, 0, 2, 3]) { const [x, z] = quad[k]; list.push(x, ground(x, z) + 0.25 + 0.5 * hash(Math.round(x), Math.round(z), 3), z); }
    }
  }
  for (const [arr, m] of [[skin, CLIFF], [wet, WET]]) {
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(arr, 3));
    geo.computeVertexNormals();
    // keep the faces up: flip any triangle whose normal points down
    const pos = geo.attributes.position;
    for (let t = 0; t < pos.count; t += 3) {
      const a = new T.Vector3().fromBufferAttribute(pos, t), b = new T.Vector3().fromBufferAttribute(pos, t + 1), c = new T.Vector3().fromBufferAttribute(pos, t + 2);
      if (b.clone().sub(a).cross(c.clone().sub(a)).y < 0) { pos.setXYZ(t + 1, c.x, c.y, c.z); pos.setXYZ(t + 2, b.x, b.y, b.z); }
    }
    geo.computeVertexNormals();
    const mesh = new T.Mesh(geo, m); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
  }
  // Outcrops: angular blocks seated on the slope (their lowest corner 0.5 m into it), tilted with it.
  const block = (x, z, sx, sy, sz, m, seed) => {
    const geo = new T.BoxGeometry(sx, sy, sz, 1, 1, 1);
    const pp = geo.attributes.position;
    for (let i = 0; i < pp.count; i++) pp.setXYZ(i, pp.getX(i) * (0.8 + 0.4 * hash(i, seed, 1)), pp.getY(i), pp.getZ(i) * (0.8 + 0.4 * hash(i, seed, 2)));
    geo.computeVertexNormals();
    const o = new T.Mesh(geo, m);
    const lo = Math.min(ground(x - sx / 2, z - sz / 2), ground(x + sx / 2, z - sz / 2), ground(x - sx / 2, z + sz / 2), ground(x + sx / 2, z + sz / 2));
    o.position.set(x, lo + sy / 2 - 0.5, z); o.rotation.y = hash(seed, 9) * Math.PI;
    o.castShadow = o.receiveShadow = true; group.add(o);
  };
  let seed = 1;
  for (let i = 0; i < P.length; i += 9) {
    const p = P[i];
    if (!inFall(p)) continue;
    const { nx, nz } = across(i);
    for (const sg of [-1, 1]) for (const d of [5.5, 11, 18, 26, 34]) {
      if (hash(i, d * 10, sg + 2) < 0.35) continue;
      const k = 1.2 + hash(i, d, 7) * 2.6;
      block(p.x + nx * sg * (d + hash(i, d, 5) * 3), p.z + nz * sg * (d + hash(i, d, 6) * 3), 2 * k, 1.6 * k + (d < 6 ? 2.5 : 0), 1.6 * k, d < 6 ? WET : CLIFF, seed++);
    }
  }
  // The lip: a rock sill the water pours over; the foot: a rim of fallen blocks holding the pool on the slope.
  { const i = P.indexOf(lip), { nx, nz } = across(i); block(lip.x - nx * 0, lip.z - nz * 0, 7, 1.6, 2.2, WET, 900); }
  const fi = P.indexOf(foot), fa = across(fi);
  for (let a = 0; a < 12; a++) {
    const ang = (a / 12) * Math.PI * 2, rx = Math.cos(ang) * 5.2, rz = Math.sin(ang) * 5.2;
    const x = foot.x + fa.nx * rx + fa.tx * rz, z = foot.z + fa.nz * rx + fa.tz * rz;
    const lo = ground(x, z), h = Math.max(1.2, pool + 0.5 - lo);
    block(x, z, 2.6, h + 0.5, 2.2, WET, 950 + a);
  }

  // The water: ribbons scrolling downhill; the fall and the cascade (white), the run below (clearer).
  const texFall = streaks(34, 0.6), texRun = streaks(18, 0.4);
  const ribbons = [];
  const ribbon = (from, to, offset, width, tex, opacity, rep) => {
    const pos = [], uv = [], idx = [];
    let n = 0;
    P.forEach((p, i) => {
      if (p.s < from || p.s > to) return;
      const { nx, nz } = across(i), y = surf(p) + (p.s > FALL.lip && p.s < FALL.foot ? 0 : 0.05);
      const fallK = p.s > FALL.lip && p.s < FALL.foot ? 1.25 : 1;                 // the curtain spreads as it falls
      for (const [o, u] of [[offset - (width * fallK) / 2, 0], [offset + (width * fallK) / 2, 1]]) {
        const x = p.x + nx * o, z = p.z + nz * o;
        pos.push(x, p.s > FALL.lip && p.s < FALL.foot ? y : Math.max(y, ground(x, z) + 0.3), z); uv.push(u, p.s / rep);
      }
      n++;
    });
    for (let i = 0; i < n - 1; i++) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new T.Mesh(geo, new T.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false, side: T.DoubleSide }));
    m.userData.keep = true; m.renderOrder = 2;
    group.add(m); ribbons.push(m);
  };
  ribbon(FALL.from - 40, FALL.to, 0, 5.5, texFall, 0.97, 6);
  ribbon(FALL.from - 40, FALL.to, -0.4, 3.0, texFall, 0.85, 4.5);
  ribbon(FALL.to - 2, P.at(-1).s, 0, 2.6, texRun, 0.85, 4);

  // The plunge pool and the small pool at the ford.
  const water = new T.MeshStandardMaterial({ color: 0xbfdde3, roughness: 0.08, transparent: true, opacity: 0.85 });
  const pd = new T.Mesh(new T.CircleGeometry(4.6, 28), water);
  pd.rotation.x = -Math.PI / 2; pd.position.set(foot.x, pool, foot.z); pd.userData.keep = true; group.add(pd);
  const end = P.at(-1), ford = new T.Mesh(new T.CircleGeometry(3, 24), water);
  ford.rotation.x = -Math.PI / 2; ford.position.set(end.x, end.g + 0.08, end.z); ford.userData.keep = true; group.add(ford);

  // Spray: big at the foot of the free fall, small down the cascade.
  const pt = puffTexture(), puffs = [];
  const puff = (x, y, z, sc, ph, op) => {
    const sp = new T.Sprite(new T.SpriteMaterial({ map: pt, transparent: true, opacity: op, depthWrite: false }));
    sp.position.set(x, y, z); sp.scale.setScalar(sc);
    sp.userData = { keep: true, phase: ph, y0: y, op };
    group.add(sp); puffs.push(sp);
  };
  for (let k = 0; k < 9; k++) puff(foot.x + (hash(k, 1) - 0.5) * 7, pool + 1 + hash(k, 2) * 3, foot.z + (hash(k, 3) - 0.5) * 7, 5 + hash(k, 4) * 4, k * 0.7, 0.55);
  for (let i = 0; i < P.length; i += 14) {
    const p = P[i];
    if (!inFall(p) || (p.s > FALL.lip - 5 && p.s < FALL.foot + 5)) continue;
    puff(p.x, surf(p) + 0.8, p.z, 2.2, i * 0.3, 0.35);
  }

  ctx.batch(group);
  return {
    update(dt, t) {
      texFall.offset.y = (texFall.offset.y + dt * 1.6) % 1;
      texRun.offset.y = (texRun.offset.y + dt * 0.8) % 1;
      for (const sp of puffs) {
        const k = (t * 1.1 + sp.userData.phase) % 3;
        sp.material.opacity = sp.userData.op * (0.35 + 0.65 * Math.sin((k / 3) * Math.PI) ** 2);
        sp.position.y = sp.userData.y0 + 1.2 * (k / 3);
      }
    },
  };
}
