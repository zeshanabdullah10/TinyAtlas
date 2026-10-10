// Jahanabad Buddha (Manglawar): a rounded granite boulder with the seated Buddha in relief in an oval niche on its face.
// Local metres (x right, -z front). Sourced: the Jahan-Abad-i relief is 700 x 500 cm, its throne 120 x 390 cm, relief depth
// 11 cm, facing north west (Wikipedia, "Buddhist rock carving in Manglawar"). The boulder's shape and size, the niche,
// the folds, halo and deck are estimated.
import * as THREE from "three";

const RELIEF = 0.11;          // raised depth of the carving (source: D 11 cm)
const LIFT = 1.0;             // estimated: the throne's base sits 1 m above the foot
const NICHE_Z = 0.3;          // estimated: the niche floor is set 0.3 m back into the boulder
const NICHE = { x: 4.4, y: 4.5, ry: 4.2 };    // estimated oval niche (half-widths) around the figure
const C = { x: 0, y: 4.0, z: 4.5 };           // boulder centre; front face at z = 0
const S = { x: 6, y: 5.5, z: 4.5 };           // semi-axes: about 12 x 11 x 9 m

// Low-frequency lumps on the boulder surface, about +-0.6 m (estimated).
const lump = (x, y, z) =>
  0.5 * Math.sin(1.1 * x + 0.4) * Math.cos(0.9 * y + 1.3) +
  0.3 * Math.sin(1.7 * z + 0.2) * Math.cos(1.2 * x - 0.6) +
  0.2 * Math.sin(1.4 * y + 0.8 * z);

export default function build(ctx) {
  const { group, M } = ctx;
  const tones = [ctx.mat(0x6e6962, { roughness: 1 }), ctx.mat(0x8f8a82, { roughness: 1 }), ctx.mat(0xa6a097, { roughness: 1 })];
  const reliefMat = ctx.mat(0xa29c93, { roughness: 0.95 });

  // The boulder: a sphere, scaled, lumped, flattened on the front (z = 0) and sunk 1 m into the slope.
  const sph = new THREE.SphereGeometry(1, 96, 64).toNonIndexed();
  const p = sph.attributes.position;
  const w = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const ux = p.getX(i), uy = p.getY(i), uz = p.getZ(i);
    const n = lump(ux, uy, uz);
    w[i] = n;
    let x = ux * S.x + ux * 0.6 * n;
    let y = C.y + uy * S.y + uy * 0.6 * n;
    let z = C.z + uz * S.z + uz * 0.6 * n;
    if (z < 0) z = 0;                                        // flat carved face
    const r = Math.hypot(x / NICHE.x, (y - NICHE.y) / NICHE.ry);
    if (r < 1 && z < NICHE_Z) z = NICHE_Z;                   // the oval niche is recessed
    const floor = ctx.ground(x, z) - 1.0;                    // sunk 1 m into the ground
    if (y < floor) y = floor;
    p.setXYZ(i, x, y, z);
  }
  // Split the triangles into three granite tones by their lumps (weathered lighter and darker patches).
  const bins = [[], [], []];
  for (let t = 0; t < p.count; t += 3) {
    const v = (w[t] + w[t + 1] + w[t + 2]) / 3;
    const b = v < -0.25 ? 0 : v > 0.25 ? 2 : 1;
    for (let k = 0; k < 3; k++) bins[b].push(p.getX(t + k), p.getY(t + k), p.getZ(t + k));
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

  // A timber viewing deck in front of the face (about 3.6 x 1.5 m, estimated from the photos), and a few boulders.
  const deckY = ctx.ground(0, -1.45) - 0.15;
  ctx.box(group, 3.6, 0.4, 1.5, M.wood, 0, deckY, -1.45);
  ctx.rocks(ctx, 3, -4.5, -2.5, 2.2, 0.6, M.schist, 3);

  ctx.batch(group);
}
