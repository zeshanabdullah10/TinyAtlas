// Amluk-Dara Stupa: the drawn rubble and wall stubs round the Atlas maquette (landmark.module). Photos 01-06 show
// tumbled stones and loose masonry at the plinth foot, and low ruined walls on the court side. The model keeps its
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
  // Ruined dry-stone wall stubs, 8 m long, 0.8 m thick, 1.2-2.0 m high, west and back of the court.
  const wall = (x, z, w, d, h) => ctx.box(group, w, h, d, M.stone, x, ctx.ground(x, z), z, 0);
  wall(-20.5, -6, 0.8, 8, 1.6);   // west: runs north-south
  wall(8, -21, 8, 0.8, 1.3);      // back: runs east-west
  ctx.batch(group);
}
