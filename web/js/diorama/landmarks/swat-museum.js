// Swat Museum (Saidu Sharif Road, Mingora): the building drawn after the Commons photos 04 and 05 (CC BY-SA 4.0).
// Local frame (kit.js): front (-z) faces the road to the west; x is right as seen from the front.
// Every size is estimated from the photos (no published dimensions); the OSM outline only places it. See landmark.edits.
export default function build(ctx) {
  const { group, ground, box, cyl, batch, mat, M } = ctx;
  const stone = mat(0xc89c78, { roughness: 0.95 });     // warm buff-pink banded sandstone cladding
  const trim = mat(0x5f7283, { roughness: 0.7 });       // blue-grey patterned portal surround
  const column = mat(0xd8d4ca, { roughness: 0.6 });     // plain grey-white columns
  const gate = mat(0x26342d, { roughness: 0.6 });       // dark metal gates
  const concrete = mat(0xbdbab2, { roughness: 0.95 });  // steps and path
  const lawn = mat(0x8f9a5c, { roughness: 1 });         // dry lawn in front
  const hedge = mat(0x4e6a32, { roughness: 1 });        // dwarf shrubs and palms
  const screen = mat(0x2f6b4a, { roughness: 0.8 });     // green lattice wing screens
  const carved = mat(0x9e8e78, { roughness: 0.95 });    // carved stone on plinths
  const coping = mat(0xd2b294, { roughness: 0.9 });     // stone parapet coping (reads as a wall top, not a roof)

  const g0 = ground(0, 0);                              // the terrace is levelled, so one height serves the building

  // main block: 22 m wide, 12 m deep, 8 m high, front wall at z = -6
  box(group, 22, 8, 12, stone, 0, g0, 0);
  box(group, 22.4, 0.4, 12.4, coping, 0, g0 + 8, 0);

  // portal: a blue-grey surround 9 m wide, its gates behind it, and a flight of five steps up to the columns
  box(group, 1.2, 6.8, 0.6, trim, -3.9, g0, -6.3);      // left jamb
  box(group, 1.2, 6.8, 0.6, trim, 3.9, g0, -6.3);       // right jamb
  box(group, 9, 0.8, 0.6, trim, 0, g0 + 6.0, -6.3);     // top band (the name is lettered here in the photos; left blank)
  box(group, 6.6, 6.0, 0.3, gate, 0, g0, -6.15);        // dark lattice gates in the opening
  for (let i = 0; i < 5; i++) {
    const top = 0.3 * (i + 1), zNear = -6.6 - 0.5 * (4 - i);   // each tread 0.5 m deep, 0.3 m rise
    box(group, 10, top, 0.5, concrete, 0, g0, zNear - 0.25);
  }
  cyl(group, 0.4, 0.42, 5.0, column, -1.7, g0 + 1.2, -6.9);   // columns stand on the top step
  cyl(group, 0.4, 0.42, 5.0, column, 1.7, g0 + 1.2, -6.9);

  // green lattice screens set back at the two ends of the front
  box(group, 4, 3.6, 0.3, screen, -13, g0, -3.5);
  box(group, 4, 3.6, 0.3, screen, 13, g0, -3.5);

  // garden in front: a dry lawn, a concrete path to the road, dwarf hedges and two palms
  box(group, 22, 0.06, 14, lawn, 0, g0, -17);
  box(group, 2.2, 0.1, 17, concrete, 0, g0, -17.6);
  box(group, 7, 0.8, 0.9, hedge, -7.5, g0, -11.2);
  box(group, 7, 0.8, 0.9, hedge, 7.5, g0, -11.2);
  cyl(group, 0, 1.0, 1.2, hedge, -9, g0 + 0.3, -13);
  cyl(group, 0, 1.0, 1.2, hedge, 9, g0 + 0.3, -13);

  // carved stone on a plinth to the right of the steps, a small signboard on the left
  box(group, 1.6, 0.8, 1.6, stone, 8, g0, -8.0);
  cyl(group, 0.6, 0.6, 1.0, carved, 8, g0 + 0.8, -8.0, 20);
  box(group, 1.0, 0.6, 1.0, stone, -6.5, g0, -8.0);
  box(group, 0.8, 0.5, 0.12, M.white, -6.5, g0 + 0.6, -8.0);

  batch(group);
}
