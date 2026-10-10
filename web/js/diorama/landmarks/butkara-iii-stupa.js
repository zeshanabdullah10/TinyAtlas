// Butkara III: a row of small Buddhist stupas on square plinths in a court cut into the hillside, with a back wall
// of niches (Commons photos Butkara-III.JPG, Votive_Stupas_-_Butkara-III.JPG, Minor_Stupa_Butkara-III.JPG).
// Sizes are estimated: no published dimensions were found for Butkara III. Stone courses are painted, not measured.
// Front faces -z (the drive). Every piece is seated on ctx.ground(x, z).

/** One stupa: square plinth, a stepped moulding, a drum and a hemispherical dome, capped by a harmika slab.
 *  s = { x, z, r (drum radius), ph (plinth height), dr (drum height), dh (dome height) }. Returns nothing. */
function stupa(ctx, s) {
  const { M, box, lathe, ground, group } = ctx;
  const { x, z, r, ph, dr, dh } = s;
  const y = ground(x, z), side = r * 2.5, k = r;
  box(group, side, ph, side, M.stone, x, y, z);                        // square plinth, cut stone
  const b = y + ph;
  lathe(group, [[r * 1.22, 0], [r * 1.22, 0.12 * k], [r * 1.08, 0.2 * k], [r * 1.08, 0.36 * k]], M.stone, x, b, z, 24); // mouldings
  const d = b + 0.36 * k;
  lathe(group, [[r, 0], [r * 0.97, dr]], M.schist, x, d, z, 24);      // drum of schist courses
  const dome = [];
  for (let i = 0; i <= 8; i++) {                                       // dome, from the drum's top edge to the crown
    const a = (i / 8) * (Math.PI / 2);
    dome.push([r * 0.97 * Math.cos(a), dh * Math.sin(a)]);
  }
  lathe(group, dome, M.schist, x, d + dr, z, 24);
  box(group, r * 0.95, 0.16 * k, r * 0.95, M.stone, x, d + dr + dh - 0.05, z); // harmika slab on the crown
}

/** The shrine wall: a schist back wall cut with three dark niches, behind the stupas (+z). */
function niches(ctx) {
  const { M, box, ground, group } = ctx;
  for (const x of [-4.5, -1.5, 1.5, 4.5]) box(group, 3, 2.6, 0.7, M.schist, x, ground(x, 4.4), 4.4);
  for (const x of [-3, 0, 3]) {
    const y = ground(x, 4.0);
    box(group, 1.1, 1.7, 0.3, M.dark, x, y, 4.0);                      // a niche opening
    box(group, 1.3, 0.14, 0.4, M.stone, x, y + 1.7, 4.0);              // its lintel
  }
}

export default function build(ctx) {
  // Main stupa on the slope at the point (the largest of the row).
  stupa(ctx, { x: 0, z: 0, r: 1.0, ph: 0.9, dr: 0.9, dh: 1.5 });
  // Votive stupas in a row in front, smaller and of varied height, as in the Commons photo of the row.
  const votive = [
    { x: -4.6, z: -2.6, r: 0.5, ph: 0.5, dr: 0.6, dh: 1.1 },
    { x: -1.9, z: -2.9, r: 0.55, ph: 0.55, dr: 0.7, dh: 1.3 },
    { x: 1.9, z: -2.6, r: 0.6, ph: 0.6, dr: 0.8, dh: 1.4 },
    { x: 4.6, z: -2.8, r: 0.5, ph: 0.5, dr: 0.6, dh: 1.1 },
  ];
  for (const v of votive) stupa(ctx, v);
  niches(ctx);
  // Schist fragments on the court, deterministic.
  ctx.rocks(7, 0, -1, 7, 0.3, ctx.M.schist, 3);
  ctx.batch(ctx.group);
}
