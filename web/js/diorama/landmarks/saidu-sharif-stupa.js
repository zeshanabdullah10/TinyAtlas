// Saidu Sharif I (Tiny Atlas): the parts drawn round the main stupa. The main stupa's surviving base is the landmark
// model (saidu-sharif-stupa.glb, real metres); the build levels a circle of terrace_m round the place point. Heading 180:
// local +z faces north, where Wikipedia puts the stair. Offsets below are east (E) and north (N) metres from the place point.
//
// Sources: Wikipedia "Saidu Sharif Stupa" (two terraces, the stair on the north side, the monastery on the upper terrace);
// Commons photos 1-3 (a rectangular stone-paved terrace with a dressed-stone edge, ruined square bases of minor stupas);
// the OSM footprint of the monastery (way 1078000527). Terrace size, minor stupa sizes and positions are estimated.
// The four corner columns of the MAIP restitution are not drawn: no photo shows them, and their heights are unsourced.
export default function build(ctx) {
  const { THREE, M, box, batch, ground, group } = ctx;
  const o = ctx.world(0, 0);
  const L = (E, N) => ctx.local(o.x + E, o.z - N);          // (east, north) metres from the place point -> local {x, z}
  const G = (E, N) => { const p = L(E, N); return ground(p.x, p.z); };

  // The rectangular stone-paved Terrace of the Stupas, 40 m east-west by 30 m north-south (estimated), with slab joints.
  const TW = 40, TD = 30;
  const cv = document.createElement("canvas"); cv.width = cv.height = 256;
  const g2 = cv.getContext("2d");
  g2.fillStyle = "#a59c8c"; g2.fillRect(0, 0, 256, 256);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let row = 0; row < 4; row++) {
    let x = -rnd() * 64;
    while (x < 256) {
      const w = 48 + rnd() * 40, shade = 0.9 + rnd() * 0.2;
      g2.fillStyle = `rgba(${Math.round(165 * shade)},${Math.round(156 * shade)},${Math.round(140 * shade)},1)`;
      g2.fillRect(x + 2, row * 64 + 2, w - 4, 60);
      x += w;
    }
  }
  g2.strokeStyle = "#5e584e"; g2.lineWidth = 3;                   // slab joints
  for (let row = 0; row <= 4; row++) { g2.beginPath(); g2.moveTo(0, row * 64); g2.lineTo(256, row * 64); g2.stroke(); }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(TW / 4, TD / 4); tex.colorSpace = THREE.SRGBColorSpace;
  const pave = new THREE.Mesh(new THREE.PlaneGeometry(TW, TD),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
  pave.rotation.x = -Math.PI / 2; pave.position.set(0, 0.06, 0); pave.receiveShadow = true; pave.userData.keep = true; group.add(pave);

  // Its retaining edge: dressed stone, 1.0 m high (estimated; photo 3 shows the coping course).
  const eh = 1.0, et = 0.8;
  const edge = (E, N, w, d) => { const p = L(E, N); box(group, w, eh, d, M.stone, p.x, 0, p.z); };
  edge(0, TD / 2 + et / 2, TW + 2 * et, et);
  edge(0, -(TD / 2 + et / 2), TW + 2 * et, et);
  edge(-(TW / 2 + et / 2), 0, et, TD);
  edge(TW / 2 + et / 2, 0, et, TD);

  // Minor stupas: square stepped bases 2 to 4 m, mostly ruined down to the base, a few with a low drum; no domes.
  // Positions avoid the stair (north of the plinth, within 4 m of the axis) and stay inside the terrace.
  const shades = [0x8f877a, 0xa39a88, 0x7b7467, 0xb0a695];
  const minor = [[-12, -5, 3.0, false], [12, -5, 2.6, true], [-12, 6, 3.4, true], [12, 7, 2.2, false],
    [-6, -13, 2.8, true], [6, -13, 3.6, false], [-13, -12, 2.4, false], [14, -11, 3.2, true]];
  minor.forEach(([E, N, s, drum], i) => {
    const p = L(E, N), y = G(E, N), m = ctx.mat(shades[i % shades.length], { roughness: 1 });
    const bh = 0.5 + (i % 3) * 0.2;                          // 0.5 to 0.9 m high bases
    ctx.box(group, s, bh, s, m, p.x, y, p.z);
    ctx.box(group, s * 0.8, 0.45, s * 0.8, m, p.x, y + bh, p.z);
    if (drum) ctx.cyl(group, s * 0.3, s * 0.34, 0.6, m, p.x, y + bh + 0.45, p.z, 12);
  });

  batch(group);
}
