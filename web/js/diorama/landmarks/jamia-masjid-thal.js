// Jamia Masjid Thal, drawn from the two CC BY-SA Commons photos (see landmark.sources). A two-storey mosque of
// weathered grey timber on a stone base: an open ground-floor arcade of posts and a low railing, two white octagonal
// gate pillars with small domes at the door, an upper storey with painted bands and a balcony with banded turned
// balusters, a wide hipped roof and a tiered tower with a lantern. Sizes are estimated from the photos; the front
// faces -z (the end of the drive). Lattice screens are left out.
export default function build(ctx) {
  const { THREE, M, mat, box, cyl, batch } = ctx;
  const g = ctx.group;
  const DS = (c, o = {}) => mat(c, { side: THREE.DoubleSide, ...o });
  const timber = mat(0x9a9284, { roughness: 0.9 });        // weathered grey wood
  const roof = DS(0x5a4636, { roughness: 0.95 });
  const green = mat(0x3f8f5a, { roughness: 0.7 });
  const red = mat(0xb8433a, { roughness: 0.7 });
  const yellow = mat(0xd8b440, { roughness: 0.6 });
  const white = mat(0xf2efe8, { roughness: 0.5 });
  const stone = mat(0xc4baa6, { roughness: 0.95 });
  const dark = M.dark;
  const bands = [green, red, yellow];
  const FL = 3.6;                       // floor line of the upper storey: lower storey about 3.6 m
  const S2 = FL + 3.6;                  // top of the upper storey (eaves)
  const R1 = S2 + 2.6;                  // top of the hipped roof over the upper storey
  const T2 = R1 + 3.2;                  // top of the tower storey

  // A four-sided hipped roof: the bottom rectangle (w0 x d0) at y0 narrowing to (w1 x d1) at y1.
  function frustum(w0, d0, y0, w1, d1, y1, m) {
    const b = [[-w0 / 2, y0, -d0 / 2], [w0 / 2, y0, -d0 / 2], [w0 / 2, y0, d0 / 2], [-w0 / 2, y0, d0 / 2]];
    const t = [[-w1 / 2, y1, -d1 / 2], [w1 / 2, y1, -d1 / 2], [w1 / 2, y1, d1 / 2], [-w1 / 2, y1, d1 / 2]];
    const v = [];
    const tri = (a, c, e) => v.push(...a, ...c, ...e);
    const quad = (a, c, e, f) => { tri(a, c, e); tri(a, e, f); };
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(b[i], b[j], t[j], t[i]); }
    quad(t[0], t[1], t[2], t[3]);
    quad(b[0], b[3], b[2], b[1]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
    geo.computeVertexNormals();
    const o = new THREE.Mesh(geo, m);
    o.castShadow = o.receiveShadow = true; g.add(o);
    return o;
  }

  // Lowest ground under the footprint, so the stone base sits on the slope.
  let gmin = Infinity;
  for (let x = -10.5; x <= 10.5; x += 2) for (let z = -7.5; z <= 7.5; z += 2.5) gmin = Math.min(gmin, ctx.ground(x, z));
  const yb = gmin - 0.3;

  // Stone base and walls to the upper floor line, with timber cribbing on the sides.
  box(g, 21, FL - yb, 15, stone, 0, yb, 0);
  for (const sx of [-10.6, 10.6]) {
    for (let k = 0; k < 3; k++) box(g, 0.32, 0.3, 14.6, M.darkWood, sx, yb + 0.9 + k * 0.95, 0);
    for (let k = 0; k < 2; k++) box(g, 0.02, 1.4, 2.2, dark, sx + Math.sign(sx) * 0.02, FL + 0.9, -4 + k * 4);
  }

  // Ground-floor arcade: a dark back wall, grey posts, a low railing along the front.
  const gz = ctx.ground(0, -7.6);
  box(g, 19.2, FL - 0.4, 0.2, M.darkWood, 0, gz + 0.05, -7.55);
  for (const x of [-9.8, -7.2, -4.6, 4.6, 7.2, 9.8]) {
    const y0 = ctx.ground(x, -7.9);
    cyl(g, 0.22, 0.22, FL - y0, timber, x, y0, -7.9, 8);
  }
  for (let i = 0; i <= 40; i++) {                       // ground railing of turned balusters, banded
    const x = -10 + i * 0.5, y0 = ctx.ground(x, -8.9);
    cyl(g, 0.07, 0.07, 1.0, bands[i % 3], x, y0, -8.9, 6);
  }
  box(g, 20.4, 0.12, 0.12, M.darkWood, 0, ctx.ground(0, -8.9) + 1.0, -8.9);

  // Two white octagonal gate pillars, about 5 m, each with a small dome.
  for (const x of [-2.2, 2.2]) {
    const y0 = ctx.ground(x, -8.2);
    cyl(g, 0.45, 0.5, 5.0, white, x, y0, -8.2, 8);
    cyl(g, 0.5, 0.5, 0.25, yellow, x, y0 + 5.0, -8.2, 8);
    cyl(g, 0.02, 0.5, 0.9, white, x, y0 + 5.25, -8.2, 12);
    cyl(g, 0.02, 0.02, 0.6, yellow, x, y0 + 6.15, -8.2, 6);
  }

  // Upper storey: grey timber walls, painted bands under the eaves and between the storeys, windows front and back.
  box(g, 21.6, S2 - FL, 17.6, timber, 0, FL, 0);
  for (const [i, y] of [[0, FL + 0.2], [1, FL + 1.8], [2, S2 - 0.5]]) {
    const c = bands[(i + 1) % 3];
    box(g, 21.8, 0.25, 0.12, c, 0, y, -8.85);
    box(g, 21.8, 0.25, 0.12, c, 0, y, 8.85);
    box(g, 0.12, 0.25, 17.8, c, -10.85, y, 0);
    box(g, 0.12, 0.25, 17.8, c, 10.85, y, 0);
  }
  box(g, 21.8, 0.2, 0.12, white, 0, FL + 1.2, -8.85);
  for (const x of [-7, -3.5, 0, 3.5, 7]) {
    box(g, 2.2, 1.6, 0.12, dark, x, FL + 1.1, -8.85);
    box(g, 2.2, 1.6, 0.12, dark, x, FL + 1.1, 8.85);
  }

  // Balcony along the front: deck, top rail and banded turned balusters.
  box(g, 21.6, 0.25, 1.4, timber, 0, FL - 0.25, -9.5);
  box(g, 21.6, 0.12, 0.12, M.darkWood, 0, FL + 0.95, -10.1);
  for (let i = 0; i <= 42; i++) {
    const x = -10.5 + i * 0.5;
    cyl(g, 0.07, 0.07, 0.95, bands[(i + 1) % 3], x, FL, -10.1, 6);
  }

  // Roof: a wide hipped roof over the upper storey, then a smaller tiered tower and its lantern.
  frustum(22.4, 18.4, S2, 14.4, 10.4, R1, roof);
  box(g, 9.4, T2 - R1, 8.0, timber, 0, R1, 0);
  for (const x of [-2.4, 0, 2.4]) box(g, 1.2, 1.0, 0.12, dark, x, R1 + 1.1, -4.02);
  box(g, 9.6, 0.2, 0.2, green, 0, T2 - 0.1, -4.05);
  frustum(10.4, 9.0, T2, 3.6, 3.2, T2 + 2.2, roof);
  for (const [x, z] of [[-4.2, -3.5], [4.2, -3.5], [-4.2, 3.5], [4.2, 3.5]]) cyl(g, 0, 0.7, 1.6, roof, x, T2, z, 6);
  cyl(g, 0.9, 0.9, 1.4, white, 0, T2 + 2.2, 0, 8);
  cyl(g, 0.05, 1.1, 1.6, roof, 0, T2 + 3.6, 0, 8);
  cyl(g, 0.03, 0.03, 1.0, yellow, 0, T2 + 5.2, 0, 6);

  ctx.batch(g);
  return null;
}
