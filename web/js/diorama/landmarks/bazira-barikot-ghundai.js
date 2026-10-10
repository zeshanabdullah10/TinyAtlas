// Ancient Bazira (Barikot): the excavation as photo 03 shows it, a compact dug area of low walls round rooms of varied
// size on bare ochre earth, and one stretch of town wall with a rectangular bastion (Wikipedia "Barikot": "a defensive
// wall with massive rectangular bastions"). The walls, rooms and the wall stretch are estimated (see meta.edits).
export default function build(ctx) {
  const { group: g, ground, hash, THREE } = ctx;
  const stone = ctx.mat(0xb8a68a, { roughness: 0.95 });   // tan mud-brick and stone
  const town = ctx.mat(0xa39478, { roughness: 1 });       // the stretch of town wall
  const earth = ctx.mat(0xb89a6e, { roughness: 1 });      // bare excavated earth

  // A straight wall: pieces of at most 7 m, each seated on the lowest ground under it; `gap` (m) leaves an opening.
  const seg = (x0, z0, x1, z1, h, t, m, gap = 0, gapAt = 0.5) => {
    const L = Math.hypot(x1 - x0, z1 - z0);
    if (gap > 0) {
      const ux = (x1 - x0) / L, uz = (z1 - z0) / L, a = L * gapAt - gap / 2, b = L * gapAt + gap / 2;
      seg(x0, z0, x0 + ux * a, z0 + uz * a, h, t, m);
      seg(x0 + ux * b, z0 + uz * b, x1, z1, h, t, m);
      return;
    }
    const n = Math.max(1, Math.ceil(L / 7)), pl = L / n;
    const ux = (x1 - x0) / L, uz = (z1 - z0) / L, ry = Math.atan2(-uz, ux);
    for (let i = 0; i < n; i++) {
      const a = (i + 0.5) / n, cx = x0 + (x1 - x0) * a, cz = z0 + (z1 - z0) * a;
      let lo = Infinity;
      for (const s of [-0.5, 0, 0.5]) lo = Math.min(lo, ground(cx + ux * pl * s, cz + uz * pl * s));
      ctx.box(g, pl, h + 0.3, t, m, cx, lo - 0.3, cz, ry);
    }
  };
  const lowest = (cx, cz, w, d) => {
    let lo = Infinity;
    for (const [dx, dz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [0, 0]]) lo = Math.min(lo, ground(cx + dx, cz + dz));
    return lo;
  };

  // The dug area: about 80 by 68 m, split at random into rooms of varied size (binary splits, some rooms stop early).
  let n = 0;
  const rnd = () => hash(++n, 17, 3);
  const rooms = [];
  const split = (x0, z0, x1, z1, depth) => {
    const w = x1 - x0, d = z1 - z0;
    if (depth === 0 || (w < 18 && d < 16) || (depth < 4 && rnd() < 0.2)) { rooms.push([x0, z0, x1, z1]); return; }
    const r = 0.3 + 0.4 * rnd();
    if (w / 18 >= d / 16) { const xm = x0 + w * r; split(x0, z0, xm, z1, depth - 1); split(xm, z0, x1, z1, depth - 1); }
    else { const zm = z0 + d * r; split(x0, z0, x1, zm, depth - 1); split(x0, zm, x1, z1, depth - 1); }
  };
  split(-40, -34, 40, 34, 5);
  for (const [x0, z0, x1, z1] of rooms) {
    const sides = [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]];
    for (const [ax, az, bx, bz] of sides) {
      if (rnd() < 0.15) continue;                                       // a wall that did not survive
      const t = 0.8 + 0.4 * rnd(), h = 0.6 + 1.9 * rnd();               // 0.8-1.2 m thick, 0.6-2.5 m high
      const gap = rnd() < 0.25 ? 1.5 : 0, gapAt = 0.3 + 0.4 * rnd();
      seg(ax, az, bx, bz, h, t, stone, gap, gapAt);
    }
  }

  // The bare earth under the dig: a ground-hugging mesh that follows the DEM.
  const geo = new THREE.PlaneGeometry(92, 80, 23, 20);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, ground(pos.getX(i), pos.getZ(i)) + 0.05);
  geo.computeVertexNormals();
  const floor = new THREE.Mesh(geo, earth);
  floor.receiveShadow = true;
  g.add(floor);

  // One stretch of town wall beside the dig (back side, away from the road): 50 m, with one rectangular bastion.
  seg(-25, 46, 25, 46, 1.5, 3, town);
  ctx.box(g, 8, 2.5, 7, town, 0, lowest(0, 49.5, 8, 7) - 0.3, 49.5);

  ctx.batch(ctx.group);
}
