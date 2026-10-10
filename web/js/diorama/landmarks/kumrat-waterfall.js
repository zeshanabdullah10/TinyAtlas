// Kumrat Waterfall (meta.landmark.module "kumrat-waterfall"): a steep stream chute in the upper Kumrat valley, drawn on
// the real DEM slope (terrace 0; trees are cleared round it by clear_trees_m). The stream line is the DEM steepest
// descent through the gully (no stream is mapped in OSM here): LINE runs from the lip (DEM ~2520 m) to the plunge pool
// at the foot (DEM ~2400 m), in metres east (E) and south (S) of the OSM waterfall node, the group origin.
// Two rows of displaced low-poly rock blocks form the gorge walls along the line; foam falls in four steps between
// them, with spray at each step and at the pool; 10-20 large boulders lie at the foot. The drop is from the 30 m DSM.
import * as THREE_ from "three";

const LINE = [[90, -79], [63, -46], [38, -16], [17, 21], [0, 62], [-40, 86]];   // lip -> foot, E/S metres
const POOL = [-40, 86];                                                          // the foot, where the water lands
const WALL_OFF = 8.5;                                                            // gorge walls this far either side of the line
const STEPS = [0.25, 0.5, 0.75];                                                 // where the fall breaks into a new step
const GREY = 0x8a8780, LICHEN = 0x6f7a5a, FOAM = 0xf2f5f5;

/** A canvas of vertical streaks on a near-white foam body, tiled, so scrolling it reads as moving water. */
function streaks(seed) {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(242,245,245,0.9)";
  g.fillRect(0, 0, 64, 256);
  let s = seed * 7919 + 13;
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 46; i++) {
    const x = r() * 60, w = 1 + r() * 3.5, y = r() * 256, len = 40 + r() * 150;
    g.fillStyle = `rgba(255,255,255,${(0.6 + r() * 0.4).toFixed(2)})`;
    for (const dy of [0, -256, 256]) g.fillRect(x, y + dy, w, len);   // wrap so the tile has no seam
  }
  const tex = new THREE_.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE_.RepeatWrapping;
  return tex;
}

/** A soft round sprite for the spray. */
function softDot() {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d"), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  return new THREE_.CanvasTexture(c);
}

export default function build(ctx) {
  const T = ctx.THREE, g = ctx.group, hash = ctx.hash;
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

  // Gorge walls: two rows of displaced low-poly blocks along the line, 8-15 m tall, about 7 m apart, seated on the ground.
  const wallMat = [ctx.mat(GREY, { roughness: 0.95 }), ctx.mat(LICHEN, { roughness: 1 })];
  const block = (w, h, d, seed) => {
    const geo = new T.BoxGeometry(w, h, d, 2, 2, 2), p = geo.attributes.position, k = 0.14 * Math.min(w, d);
    for (let i = 0; i < p.count; i++) {
      p.setXYZ(i, p.getX(i) + (hash(i, seed, 31) - 0.5) * 2 * k, p.getY(i) + (hash(i, seed, 37) - 0.5) * k,
               p.getZ(i) + (hash(i, seed, 41) - 0.5) * 2 * k);
    }
    geo.translate(0, h / 2, 0);
    geo.computeVertexNormals();
    return geo;
  };
  let bi = 0;
  for (const side of [-1, 1]) {
    let s = 0;
    for (let n = 0; s < 1.02; n++) {
      const { p, nrm } = at(s), seed = 60 + bi++;
      const x = p.x + nrm.x * side * WALL_OFF, z = p.y + nrm.y * side * WALL_OFF;
      const h = 9 + hash(n, seed, 3) * 7;                         // 8-15 m above the ground (sunk 1 m)
      const m = new T.Mesh(block(4 + hash(n, seed, 5) * 2, h, 4 + hash(n, seed, 9) * 2, seed),
                           hash(n, seed, 13) < 0.3 ? wallMat[1] : wallMat[0]);
      m.position.set(x, H(x, z) - 1, z);                          // sunk 1 m so the base is hidden in the slope
      m.rotation.y = hash(n, seed, 17) * 0.6 - 0.3;
      m.castShadow = m.receiveShadow = true;
      g.add(m);
      s += 7 / L;                                                  // ~7 m apart along the line
    }
  }

  // Foam: four steps (the line in quarters), each a pair of translucent sheets with scrolling streaks, between the walls.
  const bounds = [0, ...STEPS, 1], fall = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const tex = streaks(k + 1), speed = [0.9, 1.25, 1.05, 0.8][k];
    const mat = new T.MeshStandardMaterial({ color: FOAM, map: tex, transparent: true, opacity: 0.9, roughness: 0.3,
                                             emissive: 0xc4d4da, emissiveIntensity: 0.5, side: T.DoubleSide, depthWrite: false });
    for (const off of [-4.2, 4.2]) {
      const pos = [], uv = [], idx = [], N = 14;
      for (let i = 0; i <= N; i++) {
        const s = bounds[k] + ((bounds[k + 1] - bounds[k]) * i) / N, { p, nrm } = at(s);
        for (const side of [-1, 1]) {
          const q = off + (side * 4.6) / 2;
          const v = onSlope(p.x + nrm.x * q, p.y + nrm.y * q, 0.8);
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
      const m = new T.Mesh(geo, mat);
      m.userData.keep = true;
      g.add(m);
      fall.push(tex);
      tex.userData = { speed };
    }
  }

  // Spray: a cloud of points that rise and drift at each step and over the pool.
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const sprayMat = new T.PointsMaterial({ size: 3.0, map: softDot(), transparent: true, opacity: 0.5, depthWrite: false,
                                          color: 0xf2f7f9, sizeAttenuation: true });
  const sprays = [];
  const spray = (cx, cz, cy, radius, count, rise) => {
    const pts = [];
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * radius;
      pts.push({ bx: cx + Math.cos(a) * rr, bz: cz + Math.sin(a) * rr, dx: Math.cos(a) * (1 + rnd() * 2),
                 dz: Math.sin(a) * (1 + rnd() * 2), sp: 0.12 + rnd() * 0.12, ph: rnd() });
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.BufferAttribute(new Float32Array(count * 3), 3));
    const pt = new T.Points(geo, sprayMat);
    pt.userData.keep = true;
    g.add(pt);
    sprays.push({ geo, pts, cy, rise });
  };
  for (const s of STEPS) { const { p } = at(s); spray(p.x, p.y, H(p.x, p.y), 4, 40, 5); }
  const foot = toL(...POOL), footY = H(foot.x, foot.y);
  spray(foot.x, foot.y, footY, 9, 220, 9);

  // The plunge pool at the foot, set just above the rock there, with 10-20 large boulders round it.
  const pg = new T.CircleGeometry(8, 28);
  pg.rotateX(-Math.PI / 2);
  const pool = new T.Mesh(pg, new T.MeshStandardMaterial({ color: 0x7f9aa3, roughness: 0.08, metalness: 0.1,
                                                           transparent: true, opacity: 0.86 }));
  pool.position.set(foot.x, footY + 0.3, foot.y);
  pool.receiveShadow = true;
  g.add(pool);
  ctx.rocks(16, foot.x, foot.y, 14, 2, ctx.mat(GREY, { roughness: 0.9 }), 9);   // boulders 1-3 m

  ctx.batch(g);                       // merge the static parts (walls, pool, boulders); animated parts are kept apart

  return {
    update(dt, t) {
      for (const tex of fall) tex.offset.y -= dt * tex.userData.speed;   // water runs down the line (toward the foot)
      for (const sp of sprays) {
        const arr = sp.geo.attributes.position.array;
        sp.pts.forEach((m, i) => {
          const ph = (t * m.sp + m.ph) % 1;
          arr[i * 3] = m.bx + m.dx * ph * 4 + Math.sin(t * 1.3 + i) * 0.3;
          arr[i * 3 + 1] = sp.cy + 0.6 + ph * sp.rise;
          arr[i * 3 + 2] = m.bz + m.dz * ph * 4;
        });
        sp.geo.attributes.position.needsUpdate = true;
      }
    },
  };
}
