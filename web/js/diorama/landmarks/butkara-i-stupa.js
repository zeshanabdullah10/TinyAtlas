// Butkara I (Mingora, Swat): the excavated sacred court, drawn from the Atlas photos 01 (the main stupa behind the
// court: a broad stepped core, a rubble top, dressed and plastered lower walls), 03 (its drum courses and the plaster
// patch), 02 and 04 (the votive court: square and oblong plinths of coursed grey schist slabs packed in rows, broken
// rubble tops, a few stepped, flagged paving between) and 06 (the stages of the stupa). No published dimensions were
// found, so every size is ESTIMATED from the photos (see landmark.edits in backend/tools/diorama_sites/butkara-i-stupa.json).
// Local metres: x right, -z front (the drive), y up. The court is at ground level on the build's terrace (a landmark
// cannot cut the DEM; the photos do not give the sinking).
import * as THREE from "three";

const COURT = { w: 60, d: 50, wall: 0.8 };          // estimated: a rectangular court with a low kerb wall

export default function build(ctx) {
  const { group, box, lathe, ground, hash, masonry } = ctx;
  const y0 = ground(0, 0);
  const FLOOR = y0 + 0.04;

  // Colours sampled from the photos: grey-green schist slabs, buff dressed stone, pale lichened tops, lime plaster.
  const SLAB = masonry(0x6f6b61, { alt: 0x7f796c, slabs: true, block: 0.8, course: 0.5 });
  const SLAB2 = masonry(0x77705f, { alt: 0x878070, slabs: true, block: 0.7, course: 0.45 });
  const RUBBLE = masonry(0x7d7564, { alt: 0x938a76, rubble: true, block: 0.55 });
  const DRESSED = masonry(0xa29579, { alt: 0xb3a688, block: 0.9, course: 0.55 });
  const PAVE = masonry(0x7a766d, { alt: 0x8a857a, block: 1.1 });
  const PLASTER = ctx.mat(0xd8d0bf, { roughness: 0.9 });

  // The paving: one slab over the court, its top drawn as flagstones by the masonry material.
  box(group, COURT.w, 0.12, COURT.d, PAVE, 0, FLOOR - 0.1, 0);
  // The low kerb wall round the court (estimated 0.8 m high, 0.8 m thick).
  box(group, 0.8, COURT.wall, COURT.d + 0.8, SLAB, -COURT.w / 2 - 0.4, FLOOR, 0);
  box(group, 0.8, COURT.wall, COURT.d + 0.8, SLAB, COURT.w / 2 + 0.4, FLOOR, 0);
  box(group, COURT.w + 0.8, COURT.wall, 0.8, SLAB, 0, FLOOR, -COURT.d / 2 - 0.4);
  box(group, COURT.w + 0.8, COURT.wall, 0.8, SLAB, 0, FLOOR, COURT.d / 2 + 0.4);

  // The main stupa (estimated): three dressed, stepped rings round the core (about 19 m across at the foot), the
  // rubble core rising above them in a low broken mound, the plaster patch of photo 03 on the front of the lowest ring.
  const rings = [[9.3, 1.3], [8.6, 1.1], [7.9, 1.0]];
  let y = FLOOR;
  rings.forEach(([R, h], k) => {
    const prof = [[0, 0], [R + 0.25, 0], [R + 0.25, 0.18], [R, 0.24], [R, h - 0.12], [R + 0.12, h - 0.06], [R + 0.12, h], [0, h]];
    lathe(group, prof, k === 0 ? DRESSED : SLAB2, 0, y, 0, 48);
    y += h;
  });
  // the core: a broad, flat-topped broken mound of rubble, higher and more ragged to the back (photo 01)
  const core = new THREE.LatheGeometry(Array.from({ length: 13 }, (_, i) => {
    const t = i / 12; return new THREE.Vector2(7.6 * (1 - t ** 2.2), 2.6 * Math.min(1, t * 2.2));
  }), 48, 0, Math.PI * 2);
  const P = core.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), yy = P.getY(i), z = P.getZ(i), r = Math.hypot(x, z);
    const a = Math.atan2(z, x), u = yy / 2.6;
    const n = Math.sin(a * 4 + 1.3) * Math.sin(yy * 2.1 + r * 0.7) * 0.6 + 0.4 * Math.sin(a * 9 + yy * 3.3) + 0.3 * Math.sin(x * 1.3 + z * 1.7);
    const back = Math.max(0, z / 7.6) * 1.4 * u;                     // the higher, broken back of the mound
    const k = r < 0.01 ? 1 : 1 + 0.07 * n * u;
    P.setXYZ(i, x * k, yy + back + n * 0.35 * u, z * k);
  }
  core.computeVertexNormals();
  const coreM = new THREE.Mesh(core, RUBBLE);
  coreM.position.set(0, y, 0); coreM.castShadow = coreM.receiveShadow = true; group.add(coreM);
  for (let i = 0; i < 60; i++) {                    // loose blocks and slabs on the broken top and its slopes
    const a = hash(i, 7, 1) * Math.PI * 2, r = 1.5 + hash(i, 7, 2) * 6.2, s = 0.35 + hash(i, 7, 3) * 0.6;
    const yy = y + 2.6 * Math.min(1, (1 - (r / 7.6) ** (1 / 2.2)) * 2.2) + Math.max(0, Math.sin(a) * r / 7.6) * 1.4 - 0.3;
    box(group, s * 1.4, s * 0.5, s, RUBBLE, Math.cos(a) * r, yy, Math.sin(a) * r, hash(i, 7, 5) * 3);
  }
  const plaster = new THREE.Mesh(new THREE.LatheGeometry(
    [new THREE.Vector2(9.33, 1.15), new THREE.Vector2(9.33, 0.25)], 24, Math.PI * 0.62, Math.PI * 0.76), PLASTER);
  plaster.position.set(0, FLOOR, 0); plaster.castShadow = plaster.receiveShadow = true; group.add(plaster);
  // the stair up the front (-z) of the rings, as the restitutions in photo 06 show (width estimated)
  for (let s = 0; s < 9; s++) box(group, 3.6, (s + 1) * 0.38, 0.55, DRESSED, 0, FLOOR, -9.4 - (8 - s) * 0.42);

  // The votive court: plinths of coursed slabs packed in rows with lanes between (photos 02, 04). Most are ruined to
  // a broken top; some are stepped; about one in eight keeps the stump of a drum. Sizes 1.8-5 m, 0.5-1.6 m high.
  const placed = [];
  for (let gx = -27; gx <= 27; gx += 4.6) {
    for (let gz = -22; gz <= 22; gz += 4.2) {
      const x = gx + (hash(gx * 10, gz * 10, 1) - 0.5) * 1.2, z = gz + (hash(gx * 10, gz * 10, 2) - 0.5) * 1.0;
      const id = Math.round(gx * 10) * 1000 + Math.round(gz * 10);
      if (Math.hypot(x, z) < 12.5 || (Math.abs(x) < 2.6 && z < -9) || hash(id, 3) < 0.22) continue;   // the stupa, its stair, lanes
      const w = 1.8 + hash(id, 4) * 2.4, d = w * (0.8 + hash(id, 9) * 0.5), h = 0.5 + hash(id, 5) * 1.1;
      if (placed.some(([px, pz, pw, pd]) => Math.abs(px - x) < (pw + w) / 2 + 0.6 && Math.abs(pz - z) < (pd + d) / 2 + 0.6)) continue;
      placed.push([x, z, w, d]);
      const m = hash(id, 6) < 0.5 ? SLAB : SLAB2, rot = (hash(id, 7) - 0.5) * 0.06;
      box(group, w, h * 0.55, d, m, x, FLOOR, z, rot);                                           // the plinth
      box(group, w - 0.5, h * 0.45, d - 0.5, m, x, FLOOR + h * 0.55, z, rot);                    // its upper step
      const top = FLOOR + h;
      let tw = w - 0.5, td = d - 0.5, ty = top;                                                // the ruined top: uneven,
      for (let k = 0; k < 3; k++) {                                                               // shrinking layers, off centre
        tw *= 0.62 + 0.25 * hash(id, 30 + k); td *= 0.62 + 0.25 * hash(id, 40 + k);
        if (tw < 0.5 || td < 0.5 || hash(id, 80 + k) < 0.25) break;
        const th = 0.18 + hash(id, 20 + k) * 0.3;
        box(group, tw, th, td, k ? RUBBLE : m, x + (hash(id, 50 + k) - 0.5) * (w - tw) * 0.5, ty, z + (hash(id, 60 + k) - 0.5) * (d - td) * 0.5, rot);
        ty += th;
      }
      if (hash(id, 8) < 0.13) {                                                                   // a drum stump and a broken dome
        const dr = Math.min(w, d) * 0.3;
        lathe(group, [[0, 0], [dr * 1.1, 0], [dr * 1.1, 0.2], [dr, 0.25], [dr, 0.9], [dr * 0.9, 1.15], [dr * 0.5, 1.35], [0, 1.4]], SLAB2, x, top, z, 18);
      }
      if (hash(id, 11) < 0.2) box(group, 0.9, 0.25, 0.5, SLAB2, x, FLOOR, z - d / 2 - 0.25, rot);   // a step at the front
    }
  }
  ctx.batch(group);
  return {};
}
