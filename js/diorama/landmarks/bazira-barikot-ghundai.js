// Ancient Bazira (Barikot): the excavation inside its OSM outline (way 797097015, historic=archaeological_site), as
// Commons photo 03 shows it: a grid of rooms along streets, walls of buff and grey rubble masonry with darker joints,
// thick and of uneven height (higher where they are better kept), on pale excavated earth; an earth bank round the
// dig where the spoil and the unexcavated ground stand above it. One stretch of town wall with a rectangular bastion
// stands beside it (Wikipedia "Barikot": "a defensive wall with massive rectangular bastions"). The outline is mapped;
// the rooms, the wall sizes, the bank and the town wall stretch are ESTIMATED (see meta.edits).

// The OSM outline (lat, lon), closed.
const OUTLINE = [[34.6770432, 72.2123599], [34.6769395, 72.2123519], [34.6767961, 72.2123921], [34.6767388, 72.2119737],
  [34.6768954, 72.2119174], [34.6769329, 72.2118396], [34.6770167, 72.2117833], [34.6771072, 72.2117484], [34.6771755, 72.2116706],
  [34.6772285, 72.2116572], [34.6772902, 72.2117189], [34.677341, 72.2118235], [34.6773807, 72.2119442], [34.6774138, 72.2120381],
  [34.6773807, 72.212081], [34.6772307, 72.2122205], [34.6771226, 72.2122929], [34.6770807, 72.2123546]];

export default function build(ctx) {
  const { group: g, ground, hash, THREE: T, masonry } = ctx;
  const WALL = masonry(0xab9d82, { alt: 0xc2b598, rubble: true, block: 0.5 });
  const WALL2 = masonry(0x9a8f7c, { alt: 0xb1a68f, rubble: true, block: 0.45 });     // greyer stretches
  const TOWN = masonry(0x9c8f78, { alt: 0xb0a287, block: 0.8, course: 0.5 });
  const BANK = masonry(0x9c8664, { alt: 0xaa946f, rubble: true, block: 2.6, joint: 0.95 });   // earth, mottled

  const poly = OUTLINE.map(([la, lo]) => { const [wx, wz] = ctx.site.toLocal(la, lo); return ctx.local(wx, wz); });
  const inside = (x, z, m = 0) => {                       // point in polygon, and at least m metres from its edge
    let c = false, d = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) c = !c;
      const ex = b.x - a.x, ez = b.z - a.z, t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez)));
      d = Math.min(d, Math.hypot(a.x + ex * t - x, a.z + ez * t - z));
    }
    return c && d >= m;
  };

  // A straight wall in pieces of at most 4 m, each seated on the lowest ground under it, its top uneven.
  let n = 0;
  const rnd = () => hash(++n, 17, 3);
  const seg = (x0, z0, x1, z1, h, t, m) => {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const k = Math.max(1, Math.ceil(L / 4)), pl = L / k;
    const ux = (x1 - x0) / L, uz = (z1 - z0) / L, ry = Math.atan2(-uz, ux);
    for (let i = 0; i < k; i++) {
      const a = (i + 0.5) / k, cx = x0 + (x1 - x0) * a, cz = z0 + (z1 - z0) * a;
      if (!inside(cx, cz, 1.5) || rnd() < 0.06) continue;                       // outside the dig, or a missing piece
      let lo = Infinity;
      for (const s of [-0.5, 0, 0.5]) lo = Math.min(lo, ground(cx + ux * pl * s, cz + uz * pl * s));
      const hh = Math.max(0.35, h * (0.7 + 0.6 * rnd()));
      ctx.box(g, pl + 0.02, hh + 0.3, t, m, cx, lo - 0.3, cz, ry);
    }
  };

  // Streets and rooms: a street 4 m wide along the long (north-south) axis and one across it; blocks either side are
  // split into rooms 3.5-9 m (photo 03). Walls 0.7-1.3 m thick, 0.5-2.2 m high (estimated).
  const xs = poly.map((p) => p.x), zs = poly.map((p) => p.z);
  const X0 = Math.min(...xs), X1 = Math.max(...xs), Z0 = Math.min(...zs), Z1 = Math.max(...zs);
  const sx = (X0 + X1) / 2 + 3, sz = (Z0 + Z1) / 2 - 6;                       // the streets' centre lines (estimated)
  const blocks = [[X0, Z0, sx - 2, sz - 2], [sx + 2, Z0, X1, sz - 2], [X0, sz + 2, sx - 2, Z1], [sx + 2, sz + 2, X1, Z1]];
  const rooms = [];
  const split = (x0, z0, x1, z1, depth) => {
    const w = x1 - x0, d = z1 - z0;
    if (depth === 0 || (w < 9 && d < 9) || (depth < 3 && rnd() < 0.25)) { rooms.push([x0, z0, x1, z1]); return; }
    const r = 0.3 + 0.4 * rnd();
    if (w >= d) { const xm = x0 + w * r; split(x0, z0, xm, z1, depth - 1); split(xm, z0, x1, z1, depth - 1); }
    else { const zm = z0 + d * r; split(x0, z0, x1, zm, depth - 1); split(x0, zm, x1, z1, depth - 1); }
  };
  for (const [a, b, c, d] of blocks) split(a, b, c, d, 5);
  for (const [x0, z0, x1, z1] of rooms) {
    const edge = Math.min(x0 - X0, X1 - x1, z0 - Z0, Z1 - z1);                 // walls stand higher near the dig's edge
    const hb = 0.6 + 1.4 * Math.max(0, 1 - edge / 25);
    for (const [ax, az, bx, bz] of [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]]) {
      if (rnd() < 0.12) continue;                                                // a wall that did not survive
      seg(ax, az, bx, bz, hb, 0.7 + 0.6 * rnd(), rnd() < 0.3 ? WALL2 : WALL);
    }
  }

  // The excavated floor: the outline draped on the DEM, pale earth with patches (vertex colours).
  const fine = [];
  {                                                                              // a grid inside the outline, so it follows the ground
    const P = [], C = [], c = new T.Color();
    const st = 2;
    for (let x = X0; x < X1; x += st) for (let z = Z0; z < Z1; z += st) {
      const q = [[x, z], [x + st, z], [x + st, z + st], [x, z + st]];
      if (!q.every(([a, b]) => inside(a, b))) continue;
      for (const k of [0, 2, 1, 0, 3, 2]) {
        const [a, b] = q[k], v = 0.92 + 0.14 * hash(Math.round(a * 3), Math.round(b * 3), 5);
        P.push(a, ground(a, b) + 0.06, b); c.setHex(0xa8916f).multiplyScalar(v); C.push(c.r, c.g, c.b);
      }
    }
    const fg = new T.BufferGeometry();
    fg.setAttribute("position", new T.Float32BufferAttribute(P, 3));
    fg.setAttribute("color", new T.Float32BufferAttribute(C, 3));
    fg.computeVertexNormals();
    const floor = new T.Mesh(fg, new T.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    floor.receiveShadow = true; floor.userData.keep = true;
    fine.push(floor);
  }

  // The earth bank round the dig: 3 m wide, 1.2 m above the ground on its inner face (estimated), in pieces along
  // the outline, a little outside it.
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const L = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
    let nx = uz, nz = -ux;                                                       // outward normal (tested below)
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    if (inside(mx + nx * 2, mz + nz * 2)) { nx = -nx; nz = -nz; }
    const k = Math.max(1, Math.ceil(L / 4));
    for (let j = 0; j < k; j++) {
      const t = (j + 0.5) / k, cx = a.x + (b.x - a.x) * t + nx * 2.2, cz = a.z + (b.z - a.z) * t + nz * 2.2;
      const lo = Math.min(ground(cx - nx * 1.5, cz - nz * 1.5), ground(cx + nx * 1.5, cz + nz * 1.5));
      ctx.box(g, L / k + 0.8, 0.9 + 0.4 * hash(i, j, 3) + 0.4, 3, BANK, cx, lo - 0.4, cz, Math.atan2(-uz, ux));
      ctx.box(g, L / k + 0.8, 0.5 + 0.3 * hash(i, j, 4) + 0.4, 2, BANK, cx + nx * 2.2, ground(cx + nx * 2.2, cz + nz * 2.2) - 0.4, cz + nz * 2.2, Math.atan2(-uz, ux));   // its outer slope
    }
  }

  // One stretch of town wall beside the dig, away from the road: 50 m, 3 m thick, 2.5 m high, with one rectangular
  // bastion 8 m along and 4 m proud of it (estimated; its line is not mapped).
  const tz = Z1 + 12;
  for (let i = 0; i < 10; i++) {
    const cx = -25 + 2.5 + i * 5, lo = Math.min(ground(cx - 2.5, tz), ground(cx + 2.5, tz));
    ctx.box(g, 5.02, 2.2 + 0.6 * hash(i, 9) + 0.4, 3, TOWN, cx, lo - 0.4, tz, 0);
  }
  const by = Math.min(ground(-4, tz + 4), ground(4, tz + 4), ground(0, tz + 1.5));
  ctx.box(g, 8, 3.4, 5.5, TOWN, 0, by - 0.4, tz + 2.75 + 1.5);

  for (let i = 0; i < 60; i++) {                                                 // fallen stones in the rooms
    const x = X0 + hash(i, 81) * (X1 - X0), z = Z0 + hash(i, 82) * (Z1 - Z0);
    if (!inside(x, z, 2)) continue;
    const s = 0.3 + hash(i, 83) * 0.4;
    ctx.box(g, s * 1.4, s * 0.6, s, WALL2, x, ground(x, z) - 0.05, z, hash(i, 84) * 3);
  }
  ctx.batch(g);
  for (const m of fine) g.add(m);
}
