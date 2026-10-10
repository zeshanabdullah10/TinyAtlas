// Amluk-Dara Stupa: the drawn rubble and wall stubs round the Atlas maquette (landmark.module). Photos 01-06 show
// tumbled stones and loose masonry at the plinth foot, and low ruined walls near it. The model keeps its
// own plinth, drum and stair; this adds only what the photos show around it. Local frame: x right, -z front; the
// GLB stair projects toward +z, so the heaps and walls stay off that sector.
// Positions are illustrative (drawn after Commons photos, not a survey).
export default function build(ctx) {
  const { M, group, THREE } = ctx;
  // Three rubble heaps, 2-4 m outside the 34 m plinth (local radius 19-21 m), on the three non-stair sides.
  const heaps = [[205, 20], [255, 20], [335, 20]];
  heaps.forEach(([deg, R], h) => {
    const a = (deg * Math.PI) / 180;
    ctx.rocks(30, Math.cos(a) * R, Math.sin(a) * R, 3.5, 1.0, M.schist, 41 + h);
  });
  // Ruined dry-stone wall stubs, 8 m long, 0.8 m thick, 1.6 and 1.3 m high. Local -z is the front (the road side,
  // west on the map); each stub is seated on the lower of its two ends so it does not float on the slope.
  const wall = (x0, z0, x1, z1, t, h) => {
    const L = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / L, uz = (z1 - z0) / L;
    const lo = Math.min(ctx.ground(x0, z0), ctx.ground(x1, z1));
    ctx.box(group, L, h, t, M.stone, (x0 + x1) / 2, lo - 0.2, (z0 + z1) / 2, Math.atan2(-uz, ux));
  };
  wall(-20.5, -10, -20.5, -2, 0.8, 1.6);   // south side, runs along local z
  wall(4, -21, 12, -21, 0.8, 1.3);         // front (road) side, runs along local x
  ctx.batch(group);
}
