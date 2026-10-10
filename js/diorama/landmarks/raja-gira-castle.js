// Raja Gira Castle (Udegram): the ruin of a hill fort on a narrow spur above the Odigram road.
// The outline is the OSM fort area (lm.outline, way 889059633). The walls, round towers, rooms and the stair follow
// the Commons photos 01-06: grey schist dry-stone courses, curved bastions, rectangular room foundations, a stone
// stair up the north end. Heights, gaps, room places and the stair's size are estimated (see landmark.edits).
// Local frame: x east, z south, front (-z) north, toward the road. Every piece sits on ctx.ground.
export default function build(ctx) {
  const { lm, group: g, M, box, cyl, hash } = ctx;
  const P = lm.outline.map(([la, lo]) => { const [wx, wz] = ctx.site.toLocal(la, lo); const l = ctx.local(wx, wz); return [l.x, l.z]; });
  const [A, B, C, D] = P;                       // north-west, north-east, south-east, south-west corners
  const lerp = (p, q, f) => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];

  // A wall along a->b: one box per ~step metres, each seated on the lower end of its piece and topped at H (+-25%).
  // `gaps(f)` is true where the stone has fallen (f = 0..1 along the run).
  function wall(a, b, H, m, t = 1.0, step = 2.5, seed = 1, gaps = () => false) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / step));
    const ry = Math.atan2(b[0] - a[0], b[1] - a[1]);
    for (let i = 0; i < n; i++) {
      const f0 = i / n, f1 = (i + 1) / n;
      if (gaps((f0 + f1) / 2)) continue;
      const [x0, z0] = lerp(a, b, f0), [x1, z1] = lerp(a, b, f1), xm = (x0 + x1) / 2, zm = (z0 + z1) / 2;
      const top = ctx.ground(xm, zm) + H * (0.75 + 0.5 * hash(i, seed, 3));
      const yb = Math.min(ctx.ground(x0, z0), ctx.ground(x1, z1)) - 0.3;
      box(g, t, Math.max(0.5, top - yb), L / n + 0.08, m, xm, yb, zm, ry);
    }
  }
  // A round tower: radius r, top about H metres above the ground under it.
  function tower(x, z, H, r, k) {
    const y = ctx.ground(x, z) - 0.4;
    cyl(g, r * 0.85, r, H + 0.4 + (k % 2) * 0.6 - 0.3, M.schist, x, y, z, 14);
  }

  // Enceinte: north edge (A-B) with a gap for the stair, east cliff (B-C) low and broken, south (C-D), west (D-A).
  wall(A, B, 3.6, M.schist, 1.0, 2.5, 11, (f) => f > 0.44 && f < 0.57);
  wall(B, C, 2.2, M.schist, 1.0, 2.5, 12, (f) => (f > 0.42 && f < 0.5) || (f > 0.78 && f < 0.86));
  wall(C, D, 2.6, M.schist, 1.0, 2.5, 13);
  wall(D, A, 3.2, M.schist, 1.0, 2.5, 14, (f) => (f > 0.2 && f < 0.3) || (f > 0.62 && f < 0.7));

  // Round bastions at the corners and mid east side (photos 02-04: curved schist towers, about 4-5 m).
  tower(A[0], A[1], 4.2, 2.3, 0); tower(B[0], B[1], 4.0, 2.3, 1);
  tower(C[0], C[1], 3.6, 2.3, 2); tower(D[0], D[1], 4.4, 2.3, 3);
  const eM = lerp(B, C, 0.5); tower(eM[0], eM[1], 3.0, 2.2, 4);

  // Room foundations inside the walls (photo 01: rectangular rooms, walls about 0.9 m high).
  const room = (cx, cz, w, d, s) => {
    wall([cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], 0.9, M.schist, 0.6, 2.0, s);
    wall([cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], 0.9, M.schist, 0.6, 2.0, s + 1);
    wall([cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2], 0.9, M.schist, 0.6, 2.0, s + 2);
    wall([cx - w / 2, cz + d / 2], [cx - w / 2, cz - d / 2], 0.9, M.schist, 0.6, 2.0, s + 3);
  };
  room(-6, -24, 9, 7, 21); room(6, -10, 7, 8, 31); room(-4, 8, 8, 7, 41); room(14, 26, 6, 6, 51);

  // The great stair up the north end (photo 06): 16 treads, each rising evenly to the wall, with low side walls.
  const sx = (A[0] + B[0]) / 2, zWall = -44.5, N = 16, dep = 0.45, wd = 2.8;
  const zBot = zWall - N * dep, yBot = ctx.ground(sx, zBot), yWall = ctx.ground(sx, zWall), rise = (yWall - yBot) / N;
  for (let k = 0; k < N; k++) {
    const zc = zWall - (N - 1 - k) * dep - dep / 2, topk = yBot + (k + 1) * rise;
    const yb = Math.min(ctx.ground(sx, zc) - 0.8, topk - 0.3);
    box(g, wd, topk - yb, dep + 0.05, M.stone, sx, yb, zc);
  }
  wall([sx - wd / 2 - 0.4, zBot], [sx - wd / 2 - 0.4, zWall], 1.2, M.schist, 0.5, 2.0, 61);
  wall([sx + wd / 2 + 0.4, zBot], [sx + wd / 2 + 0.4, zWall], 1.2, M.schist, 0.5, 2.0, 62);

  // Fallen stone at the foot of the walls and the cliffs.
  ctx.rocks(14, 20, 0, 14, 0.9, M.schist, 5);
  ctx.rocks(10, -26, 6, 10, 0.7, M.schist, 9);
  ctx.rocks(8, sx, zBot - 3, 7, 0.8, M.stone, 3);

  ctx.batch(g);
}
