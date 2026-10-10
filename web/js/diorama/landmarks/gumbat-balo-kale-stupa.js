// Gumbat Stupa (Balo Kale): a square chamber on a stepped podium, a stair up the front (-z), a domed roof on a drum.
// Estimated from the Commons photos (see the site's landmark.edits); local metres, origin at the shrine's centre.
export default function build(ctx) {
  const { group: g, M, box, cyl, lathe, ground } = ctx;
  const stone = ctx.mat(0xa27a58, { roughness: 0.95 });   // warm rubble masonry in the photos
  const podium = ctx.mat(0x8c7257, { roughness: 1 });
  const dark = ctx.mat(0x2a2320, { roughness: 1 });
  const top = ctx.mat(0x9c8062, { roughness: 0.9 });

  // podium: 8 m square, 1.5 m high, seated on the real slope (sunk 0.6 m so no edge floats)
  box(g, 8, 1.5, 8, podium, 0, ground(0, 0) - 0.6, 0);
  // stair down the front (-z): four treads, 0.3 m apart in height, each 3.2 m wide and 0.925 m deep (run 3.7 m)
  const tops = [1.2, 0.9, 0.6, 0.3];
  tops.forEach((h, k) => {
    const z = -4 - (k + 0.5) * 0.925;
    box(g, 3.2, h + 0.6, 0.925, podium, 0, ground(0, z) - 0.6, z);
  });
  // chamber: 5.8 m square, 4.6 m high, on the podium
  box(g, 5.8, 4.6, 5.8, stone, 0, 1.5, 0);
  // doorway on the front, and dark arched niches on both sides
  box(g, 1.0, 1.9, 0.12, dark, 0, 1.5, -2.9);
  box(g, 0.12, 1.7, 0.9, dark, -2.9, 2.2, 0);
  box(g, 0.12, 1.7, 0.9, dark, 2.9, 2.2, 0);
  // drum and dome (a squat egg of revolution), then harmika and umbrella
  cyl(g, 2.7, 2.7, 0.5, top, 0, 6.1, 0, 24);
  const dome = [];
  for (let i = 0; i <= 8; i++) { const p = (i / 8) * Math.PI / 2; dome.push([2.5 * Math.cos(p), 2.9 * Math.sin(p)]); }
  lathe(g, dome, stone, 0, 6.6, 0, 32);
  cyl(g, 0.9, 0.9, 0.12, top, 0, 9.5, 0, 16);
  cyl(g, 0.15, 0.2, 1.0, top, 0, 9.6, 0, 8);

  ctx.batch(g);
  return null;
}
