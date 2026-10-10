// Butkara III: a main stupa and a row of small stupas on square plinths, in a court cut into the hillside, with a
// back wall of the earth cut and three shallow niches (Commons photos Butkara-III.JPG, Votive_Stupas_-_Butkara-III.JPG,
// Minor_Stupa_Butkara-III.JPG). Colours are sampled from the photos: grey-blue schist rubble (#7f7b72, lighter stones
// #b5afa3), the earth cut (#8c7f6a), niches (#5a564f, never darker). Sizes are estimated: no published dimensions for
// Butkara III were found. Front faces -z (the drive). Every piece is seated on ctx.ground(x, z).

/** One stupa: square plinth, a moulded round base, a drum and a hemispherical dome, capped by a harmika slab.
 *  s = { x, z, r (drum radius), ph (plinth height), dr (drum height), dh (dome height), mats }. Returns nothing. */
function stupa(ctx, s) {
  const { box, lathe, ground, group } = ctx;
  const { x, z, r, ph, dr, dh, mats } = s;
  const { schist, pale } = mats;
  const y = ground(x, z), side = r * 2.5, k = r;
  box(group, side, ph, side, schist, x, y, z);                         // square plinth of schist rubble
  const b = y + ph;
  lathe(group, [[r * 1.22, 0], [r * 1.22, 0.12 * k], [r * 1.08, 0.2 * k], [r * 1.08, 0.36 * k]], pale, x, b, z, 24); // base mouldings, lighter cut stone
  const d = b + 0.36 * k;
  lathe(group, [[r, 0], [r * 0.97, dr]], schist, x, d, z, 24);         // moulded drum
  const dome = [];
  for (let i = 0; i <= 8; i++) {                                        // dome, from the drum edge to the crown
    const a = (i / 8) * (Math.PI / 2);
    dome.push([r * 0.97 * Math.cos(a), dh * Math.sin(a)]);
  }
  lathe(group, dome, schist, x, d + dr, z, 24);
  box(group, r * 0.95, 0.16 * k, r * 0.95, pale, x, d + dr + dh - 0.05, z); // harmika slab on the crown
}

/** The earth cut behind the stupas (+z), with three shallow niches set into its face. */
function cutWall(ctx, mats) {
  const { box, ground, group } = ctx;
  for (const x of [-4.5, -1.5, 1.5, 4.5]) box(group, 3, 3.4, 0.8, mats.earth, x, ground(x, 4.4), 4.4);
  for (const x of [-3, 0, 3]) {
    const y = ground(x, 3.95);
    box(group, 1.1, 1.7, 0.12, mats.niche, x, y, 3.95);                 // shallow niche recess
    box(group, 1.3, 0.14, 0.2, mats.pale, x, y + 1.7, 3.95);            // its lintel
  }
}

export default function build(ctx) {
  const mats = { schist: ctx.mat(0x7f7b72, { roughness: 0.95 }), pale: ctx.mat(0xb5afa3, { roughness: 0.9 }),
    earth: ctx.mat(0x8c7f6a, { roughness: 1 }), niche: ctx.mat(0x5a564f, { roughness: 1 }) };
  // Main stupa on the slope at the point: about 4.3 m tall (estimated), the largest of the row.
  stupa(ctx, { x: 0, z: 0, r: 1.4, ph: 1.0, dr: 1.0, dh: 1.6, mats });
  // Small stupas in a row in front, about 2.2 m tall (estimated), varied as in the Commons photo of the row.
  const small = [
    { x: -4.6, z: -2.6, r: 0.55, ph: 0.6, dr: 0.45, dh: 0.75 },
    { x: -1.9, z: -2.9, r: 0.6, ph: 0.65, dr: 0.5, dh: 0.8 },
    { x: 1.9, z: -2.6, r: 0.65, ph: 0.7, dr: 0.55, dh: 0.85 },
    { x: 4.6, z: -2.8, r: 0.55, ph: 0.6, dr: 0.45, dh: 0.75 },
  ];
  for (const v of small) stupa(ctx, { ...v, mats });
  cutWall(ctx, mats);
  ctx.rocks(7, 0, -1, 7, 0.3, mats.schist, 3);                          // rubble on the court
  ctx.batch(ctx.group);
}
