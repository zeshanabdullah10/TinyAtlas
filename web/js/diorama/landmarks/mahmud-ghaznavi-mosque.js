// Mahmud Ghaznavi Mosque (Udegram): the excavated and restored plan, drawn from the Wikipedia description
// (28 m by 21 m rectangle; mihrab centred in the west wall; off-centre entrance in the east wall; paved courtyard
// with an ablution tank; prayer chamber a step higher on earth; 5 x 8 pillar bases; three ziyada rooms and three
// bastions to the north) and the six reference photos. Local frame: -z is the front (the qibla wall, west),
// +x is to the right of the viewer (north), so the ziyada sit on +x. Estimated: positions, heights and sizes
// not in a source (see landmark.edits in backend/tools/diorama_sites/mahmud-ghaznavi-mosque.json).
export default function build(ctx) {
  const { M, box, group, ground } = ctx;
  const T = 0.9;          // wall thickness (estimated)
  const H = 1.6;          // wall height (estimated from the photos)
  const solid = (w, top, d, m, x, z, ry = 0) => {
    const g0 = ground(x, z), sink = 0.25;
    box(group, w, top + sink, d, m, x, g0 - sink, z, ry);
  };
  const wallX = (x0, x1, zc, h = H) => {          // a wall running along x (east-west in the photos' sense: across the hall)
    const cx = (x0 + x1) / 2, g0 = ground(cx, zc);
    solid(x1 - x0, h, T, M.schist, cx, zc);
    box(group, x1 - x0, 0.14, T + 0.14, M.stone, cx, g0 + h, zc);     // flat coping slabs, as in the photos
  };
  const wallZ = (z0, z1, xc, h = H) => {          // a wall running along z
    const cz = (z0 + z1) / 2, g0 = ground(xc, cz);
    solid(T, h, z1 - z0, M.schist, xc, cz);
    box(group, T + 0.14, 0.14, z1 - z0, M.stone, xc, g0 + h, cz);
  };

  // Prayer hall outline: 28 m (front to back, z) by 21 m (x), walls centred 13.55 m and 10.05 m from the axes.
  wallX(-10.5, 10.5, -13.55);                     // west wall, the mihrab wall (front)
  wallX(-10.5, 2.4, 13.55);                       // east wall, with the entrance gap ...
  wallX(3.6, 10.5, 13.55);                        // ... 1.2 m, off-centre to the north
  wallZ(-13.1, 13.1, -10.05);                     // south side (the -x side)
  wallZ(-13.1, 13.1, 10.05);                      // north side: shared with the ziyada

  // Mihrab: a square projection centred on the west wall (estimated size).
  solid(2.2, 2.2, 0.6, M.stone, 0, -14.3);

  // Ziyada: three oblong rooms to the north (+x), 4 m deep, dividers estimated.
  wallZ(-14, 14, 14.05);                          // outer north wall of the rooms
  wallX(10.5, 14.5, -13.55);
  wallX(10.5, 14.5, 13.55);
  wallX(10.5, 14.5, -4.67);
  wallX(10.5, 14.5, 4.67);
  // Three bastions on the outer face of the ziyada (taller than the walls, estimated).
  for (const z of [-9.33, 0, 9.33]) solid(2.0, 2.4, 3.0, M.schist, 15.5, z);

  // Floors: courtyard paving (top 0.25 m) and the prayer chamber on earth, a step higher (top 0.5 m).
  solid(19.2, 0.25, 15.1, M.stone, 0, 5.55);      // courtyard, z from -2 to 13.1
  solid(19.2, 0.5, 11.1, M.mud, 0, -7.55);        // prayer chamber, z from -13.1 to -2

  // Column bases: 5 lines (z) by 8 per line (x), square stone bases on the prayer floor.
  for (let k = 0; k < 5; k++) {
    for (let j = 0; j < 8; j++) {
      const x = -8.4 + j * 2.4, z = -12 + k * 2.1;
      const g0 = ground(x, z);
      box(group, 0.6, 0.2, 0.6, M.stone, x, g0 + 0.5, z);
    }
  }

  // Ablution tank in the middle of the courtyard: a stone rim and a dark opening (depth not published).
  const tz = 5.5, rim = 3.2;
  const gt = ground(0, tz);
  box(group, rim, 0.2, 0.3, M.stone, 0, gt + 0.25, tz - rim / 2 + 0.15);
  box(group, rim, 0.2, 0.3, M.stone, 0, gt + 0.25, tz + rim / 2 - 0.15);
  box(group, 0.3, 0.2, rim - 0.6, M.stone, -rim / 2 + 0.15, gt + 0.25, tz);
  box(group, 0.3, 0.2, rim - 0.6, M.stone, rim / 2 - 0.15, gt + 0.25, tz);
  box(group, 2.6, 0.02, 2.6, M.dark, 0, gt + 0.24, tz);

  // Entrance steps on the east side, from the slope up to the paving.
  for (const [z, top] of [[14.3, 0.12], [14.85, 0.25]]) solid(1.2, top, 0.5, M.stone, 3.0, z);

  // The platform: a rectangle 34 m by 27 m (estimated; it carries the bastions and the stair), levelled by the
  // site's terrace. Straight stone retaining walls stand on each downhill side, seated on the DEM, in 4 m lengths.
  const y0 = ground(0, 0), X0 = -14, X1 = 18, Z0 = -17, Z1 = 17, seg = 4;
  const retain = (ax, az, bx, bz) => {                       // one run along a side, from a to b
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / seg));
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, g = ground(mx, mz), drop = y0 - g;
      if (drop < 0.3 || drop > 5) continue;
      const len = Math.hypot(x1 - x0, z1 - z0) + 0.1, ry = Math.atan2(-(z1 - z0), x1 - x0);
      box(group, len, y0 + 0.05 - (g - 0.25), 0.8, M.schist, mx, g - 0.25, mz, ry);
    }
  };
  retain(X0, Z1 + 0.4, X1, Z1 + 0.4);       // +z side (east, the entrance side)
  retain(X0, Z0 - 0.4, X1, Z0 - 0.4);       // -z side (west, the mihrab side)
  retain(X0 - 0.4, Z0, X0 - 0.4, Z1);       // -x side (south)
  retain(X1 + 0.4, Z0, X1 + 0.4, Z1);       // +x side (north)

  ctx.batch(group);
  return null;
}
