// Jahanabad Buddha (Manglawar): the seated Buddha in relief in an oval niche on the flat north-west face of a great
// boulder, with boulders beside and behind it (Commons photos 01-05). Local metres (x right, -z front). Sourced
// (Wikipedia, "Buddhist rock carving in Manglawar", Jahan-Abad-i): the boulder 1180 x 2300 cm (drawn 11.8 m high and
// 23 m wide, read in the same order as the relief's H x W), the relief 700 x 500 cm, its throne 120 x 390 cm, relief
// depth 11 cm, facing north west. The boulder's depth and rounded-block form, the streaks, the other boulders, the
// niche, the folds, halo and deck are estimated. Colours from the photos: weathered buff-grey stone, dark rain streaks.
import * as THREE from "three";

const RELIEF = 0.11;          // raised depth of the carving (source: D 11 cm)
const LIFT = 1.0;             // estimated: the throne's base sits 1 m above the foot
const NICHE_Z = 0.3;          // estimated: the niche floor is set 0.3 m back into the face
const NICHE = { x: 3.4, y: 4.6, ry: 4.2 };    // estimated oval niche (half-widths) around the figure
const STREAK_X = [-9.5, -7.6, -4.6, -3.2, 3.6, 5.2, 8.1, 9.9];   // estimated dark rain streaks on the face (x, metres)

// Stone surface: three octaves of lumps (unit-sphere input), so the rock reads broken and blocky, not egg-smooth.
const lump = (x, y, z, seed) => {
  let v = 0, amp = 1, f = 1.3;
  for (let k = 0; k < 3; k++, amp *= 0.5, f *= 2.1) {
    v += amp * Math.sin(f * x + seed * 1.7 + k) * Math.sin(f * 1.3 * y + seed + 2.1 * k) * Math.sin(f * 0.9 * z + 0.6 * seed + 0.7 * k);
  }
  return v * 1.6;
};

// One boulder: a rounded block (superellipsoid, exponent 3), lightly lumped, centred at `c` with half-sizes `s`, its
// foot sunk into the slope. `face` true: the front (-z) is cut flat at z = 0, with the niche and the rain streaks.
function boulder(ctx, group, c, s, face, seed) {
  const sph = new THREE.SphereGeometry(1, face ? 110 : 30, face ? 72 : 20);
  const p = sph.attributes.position;
  const pos = new Float32Array(p.count * 3), col = new Float32Array(p.count * 3);
  const base = new THREE.Color(0x7c7161), light = new THREE.Color(0x968a76), streak = new THREE.Color(0x4a443b), damp = new THREE.Color(0x625a4d);
  const niche = new THREE.Color(0x6e6556), k3 = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    let ux = p.getX(i), uy = p.getY(i), uz = p.getZ(i);
    const k = (Math.abs(ux) ** 3 + Math.abs(uy) ** 3 + Math.abs(uz) ** 3) ** (-1 / 3);     // onto the rounded block
    ux *= k; uy *= k; uz *= k;
    const n = lump(ux, uy, uz, seed), big = Math.sin(ux * 2.1 + seed) * Math.sin(uz * 1.7 + 0.5 * seed) * Math.cos(uy * 1.3);
    const onFace = face && uz < -0.2;
    const amp = onFace ? 0.012 : 0.05;
    let x = c[0] + ux * s[0] * (1 + amp * n + (onFace ? 0 : 0.08 * big));
    let y = c[1] + uy * s[1] * (uy > 0.6 ? 0.92 : 1) * (1 + amp * n);
    let z = c[2] + uz * s[2] * (1 + amp * n + (onFace ? 0 : 0.08 * big));
    if (face && z < 0) z = 0;                                // the flat face
    const rn = face ? Math.hypot(x / NICHE.x, (y - NICHE.y) / NICHE.ry) : 9;
    if (rn < 1 && z < NICHE_Z) z = NICHE_Z;                  // the oval niche is recessed
    const floor = ctx.ground(x, z) - 1.0;                    // sunk 1 m into the slope
    if (y < floor) y = floor;
    pos.set([x, y, z], i * 3);
    // colour: mottled stone, lighter on top, a damp foot, rain streaks running down the face from its upper edge
    k3.copy(base).lerp(light, Math.min(1, Math.max(0, 0.5 + 0.35 * n + 0.4 * (uy - 0.2))));
    const foot = y - ctx.ground(x, z);
    if (foot < 1.8) k3.lerp(damp, (1.8 - foot) / 1.8 * 0.7);
    if (face && z < 0.6 && rn > 1.04) {
      for (const sx of STREAK_X) {
        const w = 0.35 + 0.25 * Math.sin(y * 0.9 + sx * 3), d = Math.abs(x - sx + 0.3 * Math.sin(y * 0.7 + sx));
        if (d < w) k3.lerp(streak, (1 - d / w) * 0.9 * Math.min(1, Math.max(0, (y - 1) / 5)));
      }
    }
    if (rn < 1.04 && z > 0.1) k3.copy(niche);
    k3.multiplyScalar(0.94 + 0.12 * Math.abs(Math.sin(x * 1.7 + y * 2.3 + z * 1.1)));
    col.set([k3.r, k3.g, k3.b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(sph.index);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  m.castShadow = m.receiveShadow = true; m.userData.keep = true;           // keeps its colours (a batch drops them)
  group.add(m);
}

export default function build(ctx) {
  const { group, M } = ctx;
  const reliefMat = ctx.mat(0xa39782, { roughness: 0.95 });

  // The boulder: 23 m wide and 11.8 m high (sourced), 12 m deep (estimated); the carved face is its front (z = 0).
  const g0 = ctx.ground(0, 0);
  boulder(ctx, group, [0, g0 + 5.4, 5.0], [11.5, 6.4, 6.6], true, 0);
  // Boulders beside and behind it, partly overlapping (estimated sizes 6-12 m).
  boulder(ctx, group, [13.5, ctx.ground(13.5, 4) + 2.6, 4.0], [3.6, 3.6, 3.4], false, 2.1);
  boulder(ctx, group, [-13.8, ctx.ground(-13.8, 6) + 2.2, 6.0], [3.4, 3.2, 3.6], false, 4.3);
  boulder(ctx, group, [3.0, ctx.ground(3, 15) + 4.0, 15.0], [8.0, 5.0, 5.0], false, 6.7);

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
