// Kumrat Waterfall (meta.landmark.module "kumrat-waterfall"): a steep stream chute in the upper Kumrat valley, drawn on
// the real DEM slope (terrace 0, nothing levelled). Four translucent sheets with scrolling streaks run down the stream
// line from the lip (DEM ~2520 m) to the plunge pool at the foot (DEM ~2400 m); mist rises from the pool; dark wet
// boulders stand beside the chute. LINE is the DEM steepest-descent line through the gully, in metres east (E) and
// south (S) of the OSM waterfall node, which is the group origin. The drop is measured from the 30 m DSM (approximate).
import * as THREE_ from "three";

const LINE = [[90, -79], [63, -46], [38, -16], [17, 21], [0, 62], [-40, 86]];   // lip -> foot, E/S metres
const POOL = [-40, 86];                                                          // the foot, where the sheets land
const SHEETS = [{ off: -2.6, w: 1.6, speed: 0.9 }, { off: -0.9, w: 2.0, speed: 1.25 },
                { off: 0.9, w: 1.8, speed: 1.05 }, { off: 2.7, w: 1.4, speed: 0.8 }];

/** A canvas of vertical streaks (white, alpha), tiled, so scrolling it along the fall reads as moving water. */
function streaks(seed) {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 256;
  const g = c.getContext("2d");
  let s = seed * 7919 + 13;
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 46; i++) {
    const x = r() * 60, w = 1 + r() * 3.5, y = r() * 256, len = 40 + r() * 150;
    g.fillStyle = `rgba(255,255,255,${(0.18 + r() * 0.5).toFixed(2)})`;
    for (const dy of [0, -256, 256]) g.fillRect(x, y + dy, w, len);   // wrap so the tile has no seam
  }
  const tex = new THREE_.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE_.RepeatWrapping;
  return tex;
}

/** A soft round sprite for the mist. */
function softDot() {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d"), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  return new THREE_.CanvasTexture(c);
}

export default function build(ctx) {
  const T = ctx.THREE, g = ctx.group;
  const o = ctx.world(0, 0);                                    // the origin in world metres (x east, z south)
  const toL = (E, S) => { const p = ctx.local(o.x + E, o.z + S); return new T.Vector2(p.x, p.z); };
  const H = (x, z) => ctx.ground(x, z);

  // The stream line as a polyline, sampled by fraction s (0 = lip, 1 = foot).
  const line = LINE.map(([E, S]) => toL(E, S));
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + line[i].distanceTo(line[i - 1]));
  const L = cum[cum.length - 1];
  const at = (s) => {
    const d = Math.min(1, Math.max(0, s)) * L;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const a = line[i - 1], b = line[i], seg = cum[i] - cum[i - 1] || 1;
    const p = a.clone().lerp(b, Math.min(1, Math.max(0, (d - cum[i - 1]) / seg)));
    const tan = b.clone().sub(a).normalize();
    return { p, nrm: new T.Vector2(-tan.y, tan.x) };             // the horizontal normal to the flow
  };
  // A point on the real slope, lifted off it along the local terrain normal (so water sits on the rock, not in it).
  const onSlope = (x, z, lift) => {
    const e = 1.5, gx = (H(x + e, z) - H(x - e, z)) / (2 * e), gz = (H(x, z + e) - H(x, z - e)) / (2 * e);
    return new T.Vector3(x, H(x, z), z).addScaledVector(new T.Vector3(-gx, 1, -gz).normalize(), lift);
  };

  // Falling water: four sheets, each a strip along the line with a scrolling streak texture.
  const N = 80, fall = [];
  for (const sh of SHEETS) {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const s = i / N, { p, nrm } = at(s);
      for (const side of [-1, 1]) {
        const off = sh.off + (side * sh.w) / 2;
        const v = onSlope(p.x + nrm.x * off, p.y + nrm.y * off, 0.8);
        pos.push(v.x, v.y, v.z);
        uv.push(side < 0 ? 0 : 1, (s * L) / 10);
      }
      if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const tex = streaks(fall.length + 1);
    const mat = new T.MeshStandardMaterial({ color: 0xffffff, map: tex, transparent: true, opacity: 0.8, roughness: 0.3,
                                             emissive: 0x9fb2ba, emissiveIntensity: 0.3, side: T.DoubleSide, depthWrite: false });
    const m = new T.Mesh(geo, mat);
    m.userData.keep = true;
    g.add(m);
    fall.push({ tex, speed: sh.speed });
  }

  // Mist and spray over the pool: points that rise and drift off the foot.
  const NM = 220, mistPos = new Float32Array(NM * 3), mist = [];
  const foot = toL(...POOL);
  const footY = H(foot.x, foot.y);
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < NM; i++) {
    const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * 9;
    mist.push({ bx: foot.x + Math.cos(a) * rr, bz: foot.y + Math.sin(a) * rr, dx: Math.cos(a) * (1 + rnd() * 2),
                dz: Math.sin(a) * (1 + rnd() * 2), sp: 0.12 + rnd() * 0.12, ph: rnd() });
  }
  const mistGeo = new T.BufferGeometry();
  mistGeo.setAttribute("position", new T.BufferAttribute(mistPos, 3));
  const mistMat = new T.PointsMaterial({ size: 3.2, map: softDot(), transparent: true, opacity: 0.5, depthWrite: false,
                                         color: 0xf2f7f9, sizeAttenuation: true });
  const points = new T.Points(mistGeo, mistMat);
  points.userData.keep = true;
  g.add(points);

  // The plunge pool: a flat disc at the foot, set just above the rock there.
  const pg = new T.CircleGeometry(8, 28);
  pg.rotateX(-Math.PI / 2);
  const pool = new T.Mesh(pg, new T.MeshStandardMaterial({ color: 0x7f9aa3, roughness: 0.08, metalness: 0.1,
                                                           transparent: true, opacity: 0.86 }));
  pool.position.set(foot.x, footY + 0.3, foot.y);
  pool.castShadow = false; pool.receiveShadow = true;
  g.add(pool);

  // Dark wet boulders beside the chute and round the pool.
  const wet = ctx.mat(0x3a3530, { roughness: 0.5 });
  for (const [k, s] of [[0, 0.22], [1, 0.48], [2, 0.74]]) {
    const { p, nrm } = at(s);
    for (const side of [-1, 1]) {
      const q = new T.Vector2(p.x + nrm.x * side * 9, p.y + nrm.y * side * 9);
      ctx.rocks(5, q.x, q.y, 4, 1.6, wet, 31 + k * 2 + (side > 0 ? 1 : 0));
    }
  }
  ctx.rocks(6, foot.x, foot.y, 11, 1.4, wet, 9);
  const lip = at(0).p;
  ctx.rocks(3, lip.x, lip.y, 4, 2.2, wet, 4);

  ctx.batch(g);                       // merge the static parts (pool, boulders); the animated ones are kept apart

  return {
    update(dt, t) {
      for (const f of fall) f.tex.offset.y -= dt * f.speed;          // water runs down the line (toward the foot)
      const arr = mistGeo.attributes.position.array;
      for (let i = 0; i < NM; i++) {
        const m = mist[i], ph = (t * m.sp + m.ph) % 1;
        arr[i * 3] = m.bx + m.dx * ph * 4 + Math.sin(t * 1.3 + i) * 0.3;
        arr[i * 3 + 1] = footY + 0.6 + ph * 9;
        arr[i * 3 + 2] = m.bz + m.dz * ph * 4;
      }
      mistGeo.attributes.position.needsUpdate = true;
    },
  };
}
