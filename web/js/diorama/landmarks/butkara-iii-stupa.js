// Butkara III: a stupa court cut into the hillside (Commons photos Butkara-III.JPG, Votive_Stupas_-_Butkara-III.JPG,
// Minor_Stupa_Butkara-III.JPG and the court view): a main stupa on a square plinth with a moulded round drum of grey
// schist diaper masonry and the stump of its dome; votive stupas on square plinths, most ruined to a broken top; a row
// of chapels with arched niches against the earth cut at the back; flagged and earthen floor. Colours are sampled from
// the photos (grey-blue schist #7a776e-#8e897c with lighter blocks, the earth cut #9a8b70). Sizes are ESTIMATED: no
// published dimensions for Butkara III were found. Front faces -z (the drive). Every piece is seated on ctx.ground.
import * as THREE from "three";

export default function build(ctx) {
  const { group: g, box, lathe, ground, hash, masonry } = ctx;
  const SCHIST = masonry(0x77746b, { alt: 0x8e897c, block: 0.55, course: 0.4 });
  const SLAB = masonry(0x716d63, { alt: 0x837d70, slabs: true, block: 0.7, course: 0.45 });
  const RUBBLE = masonry(0x7d776a, { alt: 0x958e7e, rubble: true, block: 0.45 });
  const EARTH = masonry(0x97886d, { alt: 0xa49577, rubble: true, block: 1.4 });
  const PAVE = masonry(0x86806f, { alt: 0x9a9382, block: 0.9 });
  const NICHE = ctx.mat(0x5e584f, { roughness: 1 });

  // The court: 24 x 17 m (estimated), levelled at the highest ground where the stupas stand (nothing is buried); the
  // slope above it is held by the earth cut at the back, the floor's edge shows as a low wall where the ground falls.
  const W = 24, D = 17, zb = D / 2;
  let F = -Infinity, lo = Infinity;
  for (let x = -W / 2; x <= W / 2; x += 2) for (let z = -D / 2; z <= D / 2; z += 2) {
    const y = ground(x, z); lo = Math.min(lo, y);
    if (z < 4) F = Math.max(F, y + 0.05);
  }
  const hiBack = Math.max(ground(-W / 2, zb), ground(0, zb), ground(W / 2, zb), F + 2.5);
  box(g, W, F - lo + 0.45, D, EARTH, 0, lo - 0.6, 0);                       // the ground under the floor, an earth edge downhill
  box(g, W - 0.2, 0.2, D - 0.2, PAVE, 0, F - 0.15, 0);                         // the flagged floor
  // the earth cut: back and both sides, from the floor up to the hillside (at least 2.5 m)
  box(g, W + 3, hiBack - F + 0.6, 2.2, EARTH, 0, F - 0.3, zb + 1.1);
  for (const sx of [-1, 1]) {
    const top = Math.max(ground(sx * (W / 2 + 1), 0), ground(sx * (W / 2 + 1), zb), F + 1.2);
    box(g, 2.2, top - F + 0.4, D + 2.2, EARTH, sx * (W / 2 + 1.1), F - 0.3, 0.6);
  }

  // The chapels against the cut: five, 3.4 m wide, 2.6 m deep, 2.9 m high, each with an arched niche (photo 4).
  for (let i = 0; i < 5; i++) {
    const x = -8.8 + i * 4.4, zc = zb - 1.3;
    box(g, 3.6, 2.9, 2.6, SCHIST, x, F, zc);
    box(g, 2.0, 1.7, 0.2, NICHE, x, F + 0.35, zc - 1.32);                       // the niche, set back
    const arch = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.2, 14, 1, false, -Math.PI / 2, Math.PI), NICHE);
    arch.rotation.x = Math.PI / 2; arch.position.set(x, F + 2.05, zc - 1.32); arch.castShadow = arch.receiveShadow = true; g.add(arch);
    box(g, 3.8, 0.25, 2.8, SLAB, x, F + 2.9, zc);                                // the cornice slab, broken on some
    if (hash(i, 5) < 0.6) box(g, 1.6 + hash(i, 6), 0.4, 1.4, RUBBLE, x + (hash(i, 7) - 0.5), F + 3.15, zc);
  }

  // One stupa: square plinth, base mouldings, a drum of diaper masonry, a dome (or its ruined stump).
  const stupa = (x, z, side, ph, r, dr, dome, broken) => {
    box(g, side, ph, side, SCHIST, x, F, z);
    box(g, side + 0.3, 0.22, side + 0.3, SLAB, x, F + ph - 0.22, z);            // the plinth's cornice
    const b = F + ph;
    lathe(g, [[0, 0], [r * 1.22, 0], [r * 1.22, 0.16], [r * 1.12, 0.22], [r * 1.12, 0.38], [r * 1.04, 0.44], [0, 0.44]], SLAB, x, b, z, 28);
    lathe(g, [[0, 0], [r, 0], [r, dr], [r * 1.06, dr + 0.08], [r * 1.06, dr + 0.2], [0, dr + 0.2]], SCHIST, x, b + 0.44, z, 28);
    const y = b + 0.64 + dr, prof = [[0, 0]];
    const n = broken ? 4 : 8;
    for (let i = 0; i <= n; i++) { const a = (i / 8) * Math.PI / 2; prof.push([r * Math.cos(a), dome * Math.sin(a)]); }
    prof.push([0, prof.at(-1)[1]]);
    lathe(g, prof, broken ? RUBBLE : SCHIST, x, y, z, 28);
    if (!broken) box(g, r * 0.8, 0.5, r * 0.8, SLAB, x, y + dome - 0.05, z);     // the harmika
  };
  // The main stupa (estimated: plinth 6.4 m square and 1.5 m high, drum 4.6 m across, about 6.5 m in all).
  stupa(0, 1.5, 6.4, 1.5, 2.3, 1.8, 2.0, false);
  // Votive stupas round it: plinths 2.4-3.4 m, two with a drum, the rest ruined to a broken top.
  const votive = [[-7.5, -4.5], [-3.8, -5.6], [3.6, -5.4], [7.6, -4.2], [-8.6, 1.5], [8.4, 2.0], [-5.2, -0.4], [5.4, -0.2]];
  votive.forEach(([x, z], i) => {
    const side = 2.4 + hash(i, 1) * 1.0, ph = 0.9 + hash(i, 2) * 0.5;
    if (i === 1 || i === 5) { stupa(x, z, side, ph, side * 0.32, side * 0.3, side * 0.3, true); return; }
    box(g, side, ph, side, hash(i, 3) < 0.5 ? SCHIST : SLAB, x, F, z);
    let tw = side * 0.8, ty = F + ph;
    for (let k = 0; k < 2; k++) {                                               // the broken top
      tw *= 0.6 + 0.3 * hash(i, 10 + k);
      const th = 0.25 + 0.3 * hash(i, 20 + k);
      box(g, tw, th, tw * (0.7 + 0.4 * hash(i, 30 + k)), RUBBLE, x + (hash(i, 40 + k) - 0.5) * 0.5, ty, z + (hash(i, 50 + k) - 0.5) * 0.5, hash(i, 60 + k) * 0.4);
      ty += th;
    }
  });
  for (let i = 0; i < 16; i++) {                                                 // fallen stones on the court
    const s = 0.25 + hash(i, 71) * 0.35;
    box(g, s * 1.5, s * 0.6, s, RUBBLE, (hash(i, 72) - 0.5) * 20, F, -7 + hash(i, 73) * 9, hash(i, 74) * 3);
  }
  ctx.batch(g);
}
