// Jamia Masjid Thal, drawn from the two CC BY-SA Commons photos (see landmark.sources). A two-storey mosque of weathered
// grey timber on a stone base: an open ground floor of posts with lattice screens between them and a banded railing;
// two white octagonal gate pillars with small domes at the door; an upper storey that is an open gallery of posts and
// banded balusters under a painted frieze; a low, wide-eaved hipped roof; and a stepped three-tier tower with a small
// dome finial. Sizes are estimated from the photos; the front faces -z (the end of the drive).
export default function build(ctx) {
  const { THREE, M, mat, box, cyl } = ctx;
  const g = ctx.group;
  const timber = mat(0x9a9284, { roughness: 0.9 });        // weathered grey wood
  const roof = mat(0x5a4636, { roughness: 0.95, side: THREE.DoubleSide });
  const green = mat(0x3f8f5a, { roughness: 0.7 });
  const red = mat(0xb8433a, { roughness: 0.7 });
  const yellow = mat(0xd8b440, { roughness: 0.6 });
  const white = mat(0xf2efe8, { roughness: 0.5 });
  const stone = mat(0xc4baa6, { roughness: 0.95 });
  const dark = M.dark;
  const bands = [green, red, yellow];
  const FL = 3.6;                       // floor line of the upper gallery (ground floor 3.6 m)
  const S2 = FL + 4.2;                  // top of the upper storey (eaves)
  const R = S2 + 2.0;                   // top of the low hipped roof

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

  // Stone base to the floor line, with timber cribbing on the sides.
  box(g, 21, FL - yb, 15, stone, 0, yb, 0);
  for (const sx of [-10.6, 10.6]) {
    for (let k = 0; k < 3; k++) box(g, 0.32, 0.3, 14.6, M.darkWood, sx, yb + 0.9 + k * 0.95, 0);
  }

  // Ground floor: dark back wall, posts every 2.2 m on the front, lattice screens between them (thin crossed boxes),
  // and a banded railing of turned balusters along the front.
  const POSTS = [-9.9, -7.7, -5.5, -3.3, -1.1, 1.1, 3.3, 5.5, 7.7, 9.9];
  const gz = ctx.ground(0, -7.6);
  box(g, 19.2, FL - 0.4, 0.2, M.darkWood, 0, gz + 0.05, -7.55);
  for (const x of POSTS) {
    const y0 = ctx.ground(x, -7.9);
    cyl(g, 0.22, 0.22, FL - y0, timber, x, y0, -7.9, 8);
  }
  for (let i = 0; i < POSTS.length - 1; i++) {
    const cx = (POSTS[i] + POSTS[i + 1]) / 2;
    if (Math.abs(cx) < 2.5) continue;                   // the door between the gate pillars stays open
    const y0 = ctx.ground(cx, -7.9) + 0.3;
    for (const s of [-0.7, 0.7]) {                       // two crossed slats per lattice panel
      const o = box(g, 0.05, 2.6, 0.05, M.darkWood, cx, y0, -7.9, 0);
      o.rotation.z = s;
    }
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

  // Upper storey: an open gallery. Dark openings behind, posts every 2.2 m on the front and sides, a 1 m banded
  // balustrade on the front, and a painted carved frieze (a stack of thin coloured bands) 0.8 m tall under the eaves.
  box(g, 21.6, S2 - FL - 0.8, 17.6, dark, 0, FL, 0);
  const GP = [-9.9, -7.7, -5.5, -3.3, -1.1, 1.1, 3.3, 5.5, 7.7, 9.9];
  for (const x of GP) cyl(g, 0.2, 0.2, S2 - FL, timber, x, FL, -9.5, 8);
  for (const z of [-7.7, -5.5, -3.3, -1.1, 1.1, 3.3, 5.5, 7.7]) {
    cyl(g, 0.2, 0.2, S2 - FL, timber, -10.6, FL, z, 8);
    cyl(g, 0.2, 0.2, S2 - FL, timber, 10.6, FL, z, 8);
  }
  for (let i = 0; i <= 42; i++) {                       // balustrade, 1 m high, banded
    const x = -10.5 + i * 0.5;
    cyl(g, 0.07, 0.07, 1.0, bands[i % 3], x, FL, -9.5, 6);
  }
  box(g, 21.6, 0.12, 0.12, M.darkWood, 0, FL + 1.0, -9.5);
  box(g, 21.6, 0.25, 1.4, timber, 0, FL - 0.25, -9.9);
  const frieze = [green, red, yellow, white];
  for (let k = 0; k < 4; k++) {
    const y = S2 - 0.8 + k * 0.2;
    box(g, 21.8, 0.18, 0.12, frieze[k], 0, y, -9.55);
    box(g, 21.8, 0.18, 0.12, frieze[(k + 1) % 4], 0, y, 9.55);
    box(g, 0.12, 0.18, 17.8, frieze[(k + 2) % 4], -10.7, y, 0);
    box(g, 0.12, 0.18, 17.8, frieze[(k + 2) % 4], 10.7, y, 0);
  }

  // Low hipped roof with wide eaves (1.2 m beyond the walls), rising about 2 m.
  frustum(24.0, 20.0, S2, 16.0, 12.0, R, roof);

  // Stepped tower of three tiers (6, 4.5 and 3 m square), each 1.6 m tall with a window band and its own low roof.
  let y = R, size = 6.0;
  const tiers = [6.0, 4.5, 3.0];
  for (const s of tiers) {
    box(g, s, 1.6, s, timber, 0, y, 0);
    for (const [wx, wz, ww, wd] of [[0, -s / 2 - 0.05, s * 0.6, 0.1], [0, s / 2 + 0.05, s * 0.6, 0.1],
      [-s / 2 - 0.05, 0, 0.1, s * 0.6], [s / 2 + 0.05, 0, 0.1, s * 0.6]]) {
      box(g, ww, 0.5, wd, dark, wx, y + 0.6, wz);
    }
    frustum(s + 0.8, s + 0.8, y + 1.6, s - 1.0, s - 1.0, y + 2.1, roof);
    y += 2.1;
    size = s;
  }
  cyl(g, 0.05, 0.9, 0.9, white, 0, y, 0, 10);            // small dome finial
  cyl(g, 0.02, 0.02, 0.8, yellow, 0, y + 0.9, 0, 6);

  ctx.batch(g);
  return null;
}
