// Ancient Bazira (Barikot): the excavated Indo-Greek town as the Commons photos show it (a grid of low wall foundations
// on blocks with streets between, some blocks dug to darker floors) and the town wall with rectangular bastions that
// Wikipedia "Barikot" describes. Only the wall's line, size, bastion spacing and the block grid are estimated (see
// meta.edits). Everything is seated on ctx.ground, so the walls follow the real slope.
export default function build(ctx) {
  const { group: g, ground, hash } = ctx;
  const stone = ctx.mat(0xb3a183, { roughness: 0.95 });   // tan mud-brick and stone foundations, as in the photos
  const town = ctx.mat(0x9a8a72, { roughness: 1 });       // the town wall, weathered
  const dug = ctx.mat(0x5b4731, { roughness: 1 });        // excavated floors, darker than the ground

  // A straight wall from (x0, z0) to (x1, z1): pieces of at most 7 m, each seated on the lowest ground under it.
  const seg = (x0, z0, x1, z1, h, t, m) => {
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(L / 7)), pl = L / n;
    const ux = (x1 - x0) / L, uz = (z1 - z0) / L, ry = Math.atan2(-uz, ux);
    for (let i = 0; i < n; i++) {
      const a = (i + 0.5) / n, cx = x0 + (x1 - x0) * a, cz = z0 + (z1 - z0) * a;
      let lo = Infinity;
      for (const s of [-0.5, 0, 0.5]) lo = Math.min(lo, ground(cx + ux * pl * s, cz + uz * pl * s));
      ctx.box(g, pl, h + 0.3, t, m, cx, lo - 0.3, cz, ry);
    }
  };
  const lowest = (cx, cz, w, d, ry = 0) => {
    const c = Math.cos(ry), s = Math.sin(ry);
    let lo = Infinity;
    for (const [dx, dz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [0, 0]]) {
      lo = Math.min(lo, ground(cx + dx * c + dz * s, cz - dx * s + dz * c));
    }
    return lo;
  };

  // The excavated grid: blocks 14 x 11 m on a pitch of 19 m (E-W) and 16 m (N-S), so 5 m streets run between them.
  const P = 19, Q = 16, W = 14, D = 11;
  for (let i = -3; i <= 3; i++) {
    for (let j = -3; j <= 3; j++) {
      const k = (n) => hash(i + 10, j + 10, n);
      if (k(31) < 0.2) continue;                                     // not dug: left as ground
      const cx = i * P, cz = j * Q, x0 = cx - W / 2, x1 = cx + W / 2, z0 = cz - D / 2, z1 = cz + D / 2;
      const h = 0.6 + k(37) * 1.0;                                   // 0.6 to 1.6 m high
      const sides = [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]];
      sides.forEach(([ax, az, bx, bz], s) => {
        if (k(41 + s) < 0.45) {                                      // a doorway gap in the middle of this side
          const p = (f) => [ax + (bx - ax) * f, az + (bz - az) * f];
          const [ea, eb] = [p(0.4), p(0.6)];
          seg(ax, az, ea[0], ea[1], h, 0.9, stone);
          seg(eb[0], eb[1], bx, bz, h, 0.9, stone);
        } else {
          seg(ax, az, bx, bz, h, 0.9, stone);
        }
      });
      if (k(53) < 0.5) seg(x0, cz, x1, cz, h * 0.7, 0.7, stone);     // a partition across the room
      if (k(61) < 0.45) {                                            // a dug floor, inside the walls
        const fw = W - 2.4, fd = D - 2.4;
        ctx.box(g, fw, 0.05, fd, dug, cx, lowest(cx, cz, fw, fd) + 0.02, cz);
      }
    }
  }

  // The town wall: a square about 250 m a side (estimated), 1.5 m high, 3 m thick, with rectangular bastions.
  const H = 125, T = 3, WH = 1.5;
  const C = [[-H, -H], [H, -H], [H, H], [-H, H]];
  for (let s = 0; s < 4; s++) {
    const [ax, az] = C[s], [bx, bz] = C[(s + 1) % 4];
    seg(ax, az, bx, bz, WH, T, town);
    const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
    let nx = -uz, nz = ux;                                           // outward normal of this side
    if (nx * (ax + bx) / 2 + nz * (az + bz) / 2 < 0) { nx = -nx; nz = -nz; }
    const ry = Math.atan2(-uz, ux);
    for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) {                    // five bastions per side, 8 m along, 4 m proud
      const px = ax + (bx - ax) * f + nx * 2.5, pz = az + (bz - az) * f + nz * 2.5;
      ctx.box(g, 8, WH + 1.0, 7, town, px, lowest(px, pz, 8, 7, ry) - 0.3, pz, ry);
    }
  }

  ctx.batch(ctx.group);
}
