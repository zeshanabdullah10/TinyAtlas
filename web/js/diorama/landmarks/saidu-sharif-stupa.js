// Saidu Sharif I (Tiny Atlas): the parts drawn round the main stupa. The main stupa's surviving base is the landmark
// model (saidu-sharif-stupa.glb, real metres); the build levels the Terrace of the Stupas (terrace_m) to the ground at
// the place point. Heading 180: local +z faces north, where Wikipedia puts the stair, so E (east) and N (north) offsets
// from the place point map to group-local x = E-direction and z = N-direction below, via ctx.local.
//
// Sources: Wikipedia "Saidu Sharif Stupa" (the two terraces, the stair on the north side, four corner columns with lions,
// the monastery on the upper terrace); the MAIP restitution drawing (column and lion heights, estimated from its scale
// bar); Commons photos 1-3 (minor stupas, the paved terrace, the dressed-stone edge); the OSM footprint of the monastery
// (way 1078000527) for where the monastery stands. Only the GLB base and the place point are measured; the rest is estimated.
export default function build(ctx) {
  const { THREE, M, box, cyl, lathe, batch, ground, group, lm } = ctx;
  const R = lm.terrace_m ?? 30;
  const o = ctx.world(0, 0);
  const L = (E, N) => ctx.local(o.x + E, o.z - N);          // (east, north) metres from the place point -> local {x, z}
  const G = (E, N) => { const p = L(E, N); return ground(p.x, p.z); };

  // The paved Terrace of the Stupas: a flat disc at the levelled ground (photo 3 shows grey schist flags).
  const pave = new THREE.Mesh(new THREE.CircleGeometry(R, 56), ctx.mat(0x7f7a6e, { roughness: 1 }));
  pave.rotation.x = -Math.PI / 2; pave.position.y = 0.06; pave.receiveShadow = true; group.add(pave);

  // Its dressed-stone edge, about 0.9 m high (estimated; photo 3 shows the curved coping).
  const NW = 36, rw = R - 0.35;
  for (let i = 0; i < NW; i++) {
    const a = (i + 0.5) / NW * Math.PI * 2, x = Math.cos(a) * rw, z = Math.sin(a) * rw;
    box(group, (2 * Math.PI * R) / NW * 0.98, 0.9, 0.7, M.stone, x, ground(x, z), z, -a - Math.PI / 2);
  }

  // Minor stupas on square bases (estimated from photos 1 and 2), on a ring 22 m out, none in the stair's sector.
  for (const d of [20, 60, 100, 140, 180, 220, 260, 300, 340]) {
    if (Math.abs(d - 90) <= 25) continue;
    const a = d * Math.PI / 180, x = Math.cos(a) * 22, z = Math.sin(a) * 22, y = ground(x, z);
    box(group, 3.2, 1.2, 3.2, M.stone, x, y, z);
    cyl(group, 1.3, 1.3, 1.0, M.stone, x, y + 1.2, z, 20);
    lathe(group, [[1.3, 0], [1.15, 0.45], [0.7, 1.0], [0.35, 1.45], [0, 1.6]], M.stone, x, y + 2.2, z, 20);
  }

  // The four corner columns with a crouching lion (restored, not surviving). Wikipedia: columns on a pedestal with a lion
  // at the four corners of the top of the square body (the model's top, y = 5 m). Shaft heights estimated from the MAIP drawing.
  for (const [E, N] of [[7.6, 7.6], [-7.6, 7.6], [7.6, -7.6], [-7.6, -7.6]]) {
    const p = L(E, N), y = 5.0;
    box(group, 1.8, 0.9, 1.8, M.stone, p.x, y, p.z);
    cyl(group, 0.62, 0.7, 8.3, M.stone, p.x, y + 0.9, p.z, 12);
    box(group, 1.6, 0.6, 1.6, M.stone, p.x, y + 9.2, p.z);
    box(group, 1.3, 1.2, 1.4, M.stone, p.x, y + 9.8, p.z);
    box(group, 0.8, 0.7, 0.9, M.stone, p.x, y + 11.0, p.z + 0.25);
  }

  // The monastery on the upper terrace: a walled courtyard inside the OSM footprint (east 30 to 54 m, north -72 to -34 m
  // of the place point), with six cells along each of the north and south sides. Ground under it is the DEM; the walls and
  // cells take their foundations down to the lowest ground under them. Sizes are estimated.
  const E0 = 30, E1 = 54, N0 = -72, N1 = -34, H = 1.0, T = 0.6;
  const run = (Ea, Na, Eb, Nb) => {                           // a wall in pieces of about 3 m, each on its own ground
    const len = Math.hypot(Eb - Ea, Nb - Na), n = Math.max(1, Math.ceil(len / 3));
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n, tm = (t0 + t1) / 2;
      const E = Ea + (Eb - Ea) * tm, N = Na + (Nb - Na) * tm;
      const gs = [G(Ea + (Eb - Ea) * t0, Na + (Nb - Na) * t0), G(Ea + (Eb - Ea) * t1, Na + (Nb - Na) * t1), G(E, N)];
      const base = Math.min(...gs) - 0.4, top = G(E, N) + H, p = L(E, N);
      const alongE = Na === Nb;
      box(group, alongE ? len / n : T, top - base, alongE ? T : len / n, M.stone, p.x, base, p.z);
    }
  };
  run(E0, N0, E1, N0); run(E0, N1, E1, N1); run(E0, N0, E0, N1); run(E1, N0, E1, N1);

  // Six cells along the north and south sides: stone rooms 4 m wide, 3.5 m deep, 2.6 m high, flat-roofed, a doorway on the courtyard side.
  const cellW = (E1 - E0) / 6, cellD = 3.5, cellH = 2.6;
  for (const [Nc, doorDir] of [[N1 - T - cellD / 2, -1], [N0 + T + cellD / 2, 1]]) {
    for (let i = 0; i < 6; i++) {
      const Ec = E0 + cellW * (i + 0.5);
      const gs = [G(Ec - cellW / 2, Nc - cellD / 2), G(Ec + cellW / 2, Nc - cellD / 2), G(Ec - cellW / 2, Nc + cellD / 2), G(Ec + cellW / 2, Nc + cellD / 2), G(Ec, Nc)];
      const base = Math.min(...gs) - 0.4, top = G(Ec, Nc) + cellH, p = L(Ec, Nc);
      box(group, cellW - 0.2, top - base, cellD, M.stone, p.x, base, p.z);
      const gd = G(Ec, Nc + doorDir * (cellD / 2 - 0.02)), pd = L(Ec, Nc + doorDir * (cellD / 2 - 0.02));
      box(group, 0.9, 1.5, 0.12, M.dark, pd.x, gd, pd.z);
    }
  }

  batch(group);
}
