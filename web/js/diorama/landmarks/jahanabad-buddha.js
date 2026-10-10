// Jahanabad Buddha (Manglawar): a tall granite face with the seated Buddha in relief in an oval niche, and boulders
// beside and behind it. Local metres (x right, -z front). Sourced: the Jahan-Abad-i relief is 700 x 500 cm, its throne
// 120 x 390 cm, relief depth 11 cm, facing north west (Wikipedia, "Buddhist rock carving in Manglawar"). The rock's
// shape and size, the streaks, the boulders, the niche, the folds, halo and deck are estimated.
import * as THREE from "three";

const RELIEF = 0.11;          // raised depth of the carving (source: D 11 cm)
const LIFT = 1.0;             // estimated: the throne's base sits 1 m above the foot
const NICHE_Z = 0.3;          // estimated: the niche floor is set 0.3 m back into the face
const NICHE = { x: 3.4, y: 4.6, ry: 4.2 };    // estimated oval niche (half-widths) around the figure
const STREAK_X = [-3.2, -1.1, 1.2, 3.1];      // estimated dark weathering streaks on the face (x, metres)

// Low-frequency lumps on a rock surface (estimated shape, unit-sphere input).
const lump = (x, y, z) =>
  0.5 * Math.sin(1.1 * x + 0.4) * Math.cos(0.9 * y + 1.3) +
  0.3 * Math.sin(1.7 * z + 0.2) * Math.cos(1.2 * x - 0.6) +
  0.2 * Math.sin(1.4 * y + 0.8 * z);

// One granite boulder: a lumped sphere scaled to `s`, centred at `c`, sunk 1 m into the ground.
// `face` true: the front (-z) is a flat carved face at z = 0, with the niche and the dark streaks.
function boulder(ctx, group, c, s, face, seed) {
  const tones = [ctx.mat(0x5f5b55, { roughness: 1 }), ctx.mat(0x6e6962, { roughness: 1 }),
                 ctx.mat(0x8f8a82, { roughness: 1 }), ctx.mat(0xa6a097, { roughness: 1 })];
  const sph = new THREE.SphereGeometry(1, 96, 64).toNonIndexed();
  const p = sph.attributes.position;
  const bins = [[], [], [], []];
  const ptsOf = [];
  for (let i = 0; i < p.count; i++) {
    const ux = p.getX(i), uy = p.getY(i), uz = p.getZ(i);
    const n = lump(ux + seed, uy, uz);
    const amp = face && uz < 0 ? 0.25 : 0.9;                // the carved face is kept smooth; the rest is broken
    let x = c[0] + ux * s[0] + ux * amp * n;
    let y = c[1] + uy * s[1] + uy * amp * n;
    let z = c[2] + uz * s[2] + uz * amp * n;
    if (face && z < 0) z = 0;                                // the flat carved face
    if (face) {
      const r = Math.hypot(x / NICHE.x, (y - NICHE.y) / NICHE.ry);
      if (r < 1 && z < NICHE_Z) z = NICHE_Z;                 // the oval niche is recessed
    }
    const floor = ctx.ground(x, z) - 1.0;                    // sunk 1 m into the slope
    if (y < floor) y = floor;
    ptsOf.push([x, y, z, n]);
  }
  for (let t = 0; t < ptsOf.length; t += 3) {
    const tri = ptsOf.slice(t, t + 3);
    const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3, cz = (tri[0][2] + tri[1][2] + tri[2][2]) / 3;
    const cn = (tri[0][3] + tri[1][3] + tri[2][3]) / 3;
    let b = cn < -0.25 ? 1 : cn > 0.25 ? 3 : 2;
    if (face && cz < 0.5 && !(Math.hypot(cx / NICHE.x, (tri[0][1] + tri[1][1] + tri[2][1]) / 3 - NICHE.y) / NICHE.ry < 1)) {
      if (STREAK_X.some((sx) => Math.abs(cx - sx) < 0.35) && cz < 0.5) b = 0;   // dark vertical streaks
    }
    for (const v of tri) bins[b].push(v[0], v[1], v[2]);
  }
  bins.forEach((arr, b) => {
    if (!arr.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, tones[b]);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  });
}

export default function build(ctx) {
  const { group, M } = ctx;
  const reliefMat = ctx.mat(0xa29c93, { roughness: 0.95 });

  // The face: about 9 m wide, 12 m tall, 8 m deep; the carved face is its front (z = 0).
  boulder(ctx, group, [0, 5.5, 4.0], [4.5, 6.0, 4.0], true, 0);
  // Boulders beside and behind the face, partly overlapping it (estimated sizes 4-7 m).
  boulder(ctx, group, [6.2, 2.2, 3.0], [2.8, 2.6, 2.6], false, 2.1);
  boulder(ctx, group, [-5.6, 1.6, 6.0], [2.4, 2.2, 2.3], false, 4.3);
  boulder(ctx, group, [-1.0, 4.0, 10.0], [3.4, 3.8, 3.2], false, 6.7);

  // The relief: flat shapes extruded 0.11 m out of the niche floor, standing on yb.
  const yb = ctx.ground(0, 0) + LIFT;
  const slab = (shape) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: RELIEF, bevelEnabled: false, curveSegments: 20 });
    g.translate(0, 0, NICHE_Z - RELIEF);
    const m = new THREE.Mesh(g, reliefMat);
    m.position.set(0, yb, 0);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  };
  const poly = (pts) => {
    const s = new THREE.Shape();
    s.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) s.lineTo(x, y);
    return s;
  };
  const mirror = (pts) => pts.map(([x, y]) => [-x, y]);
  const ellipse = (cx, cy, rx, ry) => { const s = new THREE.Shape(); s.absellipse(cx, cy, rx, ry, 0, Math.PI * 2, false, 0); return s; };
  const ring = (cx, cy, rxo, ryo, rxi, ryi) => {
    const s = ellipse(cx, cy, rxo, ryo);
    const h = new THREE.Path(); h.absellipse(cx, cy, rxi, ryi, 0, Math.PI * 2, true, 0);
    s.holes.push(h);
    return s;
  };

  // Throne (asana): base ledges and the lotus seat, 3.9 m wide, 1.2 m high.
  slab(poly([[-2.2, 0], [2.2, 0], [2.2, 0.2], [-2.2, 0.2]]));
  slab(poly([[-2.0, 0.2], [2.0, 0.2], [2.0, 0.4], [-2.0, 0.4]]));
  slab(poly([[-1.95, 0.4], [1.95, 0.4], [1.95, 0.7], [1.6, 1.2], [-1.6, 1.2], [-1.95, 0.7]]));
  // Crossed legs and robe folds over the lap (concentric folds, estimated).
  slab(ellipse(0, 2.0, 1.85, 0.75));
  slab(ring(0, 2.0, 1.6, 0.55, 1.5, 0.45));
  slab(ring(0, 2.0, 1.2, 0.36, 1.1, 0.27));
  // Torso draped in the robe, shoulders to waist.
  slab(poly([[-1.25, 5.3], [1.25, 5.3], [1.4, 4.2], [1.0, 2.9], [-1.0, 2.9], [-1.4, 4.2]]));
  // Arms: upper arm and forearm down to the hands in the lap (both sides).
  const arm = [[0.95, 5.1], [1.55, 4.3], [1.45, 3.2], [0.5, 2.6], [0.2, 2.95], [0.9, 3.4], [1.05, 4.3], [0.85, 4.9]];
  slab(poly(arm));
  slab(poly(mirror(arm)));
  slab(ellipse(0, 2.75, 0.5, 0.22));                    // hands resting, one over the other
  // Neck, head, the ushnisha (the bump on the crown) and the halo (estimated).
  slab(poly([[-0.3, 5.1], [0.3, 5.1], [0.3, 5.5], [-0.3, 5.5]]));
  slab(ellipse(0, 6.0, 0.62, 0.72));
  slab(ellipse(0, 6.85, 0.26, 0.22));
  slab(ring(0, 6.1, 1.3, 1.3, 1.12, 1.12));

  // A timber viewing deck at the foot of the face, 0.3 m high, seated on the ground (photo 01).
  ctx.box(group, 3.6, 0.3, 1.0, M.wood, 0, ctx.ground(0, -1.1) - 0.1, -1.1);

  ctx.batch(group);
}
