// Amluk-Dara Stupa: what is drawn round the Atlas maquette (landmark.model). Photos 01-06 show tumbled stones and
// loose masonry at the plinth foot and low ruined walls near it. The model keeps its own plinth (34 m square), drum
// and stair; this adds a footing that carries the plinth down to the ground wherever the slope falls away under it
// (so it never stands on air), the rubble heaps and the wall stubs. Local frame: x right, -z front; the GLB stair
// projects toward +z, so the heaps and walls stay off that sector. Positions are illustrative (after Commons photos).
export default function build(ctx) {
  const { group, hash, masonry } = ctx;
  const STONE = masonry(0x8e8170, { alt: 0xa59684, block: 0.6, course: 0.42 });   // the plinth's buff-grey schist courses
  const RUBBLE = masonry(0x7f7666, { alt: 0x998f7c, rubble: true, block: 0.5 });

  // The footing under the 34 m plinth: pieces 4 m square round its edge, from the lowest ground under each up to the
  // plinth's foot (y = 0), hidden where the ground is level.
  const H = 17;
  for (let a = -H; a < H; a += 4) {
    for (const [x, z] of [[a + 2, -H + 0.6], [a + 2, H - 0.6], [-H + 0.6, a + 2], [H - 0.6, a + 2]]) {
      const w = Math.abs(z) > Math.abs(x) ? [4.05, 1.4] : [1.4, 4.05];
      let lo = Infinity;
      for (const fx of [-0.5, 0, 0.5]) for (const fz of [-0.5, 0.5]) lo = Math.min(lo, ctx.ground(x + fx * w[0], z + fz * w[1]));
      if (lo > -0.05) continue;
      ctx.box(group, w[0], -lo + 0.15, w[1], STONE, x, lo - 0.1, z);
    }
  }
  // Three rubble heaps, 2-4 m outside the plinth (local radius 19-21 m), on the three non-stair sides.
  [[205, 20], [255, 20], [335, 20]].forEach(([deg, R], h) => {
    const a = (deg * Math.PI) / 180;
    ctx.rocks(26, Math.cos(a) * R, Math.sin(a) * R, 3.5, 0.9, RUBBLE, 41 + h);
  });
  // Ruined dry-stone wall stubs, 8 m long, 0.8 m thick, 1.6 and 1.3 m high, in 2 m pieces each seated on the lowest
  // ground under it, their tops uneven.
  const wall = (x0, z0, x1, z1, t, h, seed) => {
    const L = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / L, uz = (z1 - z0) / L, n = Math.ceil(L / 2);
    for (let i = 0; i < n; i++) {
      const cx = x0 + ux * (i + 0.5) * (L / n), cz = z0 + uz * (i + 0.5) * (L / n);
      const lo = Math.min(ctx.ground(cx - ux, cz - uz), ctx.ground(cx + ux, cz + uz), ctx.ground(cx, cz));
      ctx.box(group, L / n + 0.02, h * (0.75 + 0.4 * hash(i, seed)) + 0.3, t, STONE, cx, lo - 0.3, cz, Math.atan2(-uz, ux));
    }
  };
  wall(-20.5, -10, -20.5, -2, 0.8, 1.6, 1);   // south side, runs along local z
  wall(4, -21, 12, -21, 0.8, 1.3, 2);         // front (road) side, runs along local x
  ctx.batch(group);
}
