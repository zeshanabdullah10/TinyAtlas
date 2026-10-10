// Ghalegay Buddha: a grey rock face with a seated Buddha carved in relief on its road face (front, -z).
// Stone colour and forms follow the photos; size from the DOAM boulder record (6.80 m x 3.20 m); see landmark.edits.
export default function build(ctx) {
  const { THREE, group, ground } = ctx;
  const stone = ctx.mat(0x8d8a84, { roughness: 0.95 }), rockMat = ctx.mat(0x8d8a84, { roughness: 1, flatShading: true });

  // The rock: a subdivided icosahedron about 7 m x 5 m x 4 m, its road face flattened to the plane z = 0,
  // roughened by displacement, its foot 0.8 m into the real ground.
  const rock = new THREE.IcosahedronGeometry(1, 3);
  const p = rock.attributes.position;
  // displacement from the vertex position, not its index: the geometry repeats each corner once per face, and an
  // index-based offset tore the faces apart into shards
  const lump = (x, y, z) => Math.sin(2.3 * x + 0.4) * Math.sin(2.9 * y + 1.1) * Math.sin(2.1 * z + 0.7)
    + 0.5 * Math.sin(5.1 * x + 2.0) * Math.sin(4.3 * y + 0.3) * Math.sin(4.7 * z + 1.9);
  for (let i = 0; i < p.count; i++) {
    const ux = p.getX(i), uy = p.getY(i), uz = p.getZ(i);
    let x = ux * 3.5, y = uy * 2.5 + 1.7, z = uz * 2 + 2;
    if (z < 0.6) z *= 0.2;                                          // flat road face
    const nx = x / 3.5, ny = (y - 1.7) / 2.5, nz = (z - 2) / 2;
    const len = Math.hypot(nx, ny, nz) || 1;
    const k = lump(ux, uy, uz) * (z < 0.6 ? 0.08 : 0.35);           // the carved face stays nearly flat
    x += (k * nx) / len; y += (k * ny) / len; z += (k * nz) / len;
    // shallow oval niche in the face: the figure sits on its floor
    if (z < 0.6 && (x / 2.1) ** 2 + ((y - 2.2) / 2.3) ** 2 < 1) z = Math.max(z, 0.25);
    y = Math.max(y, ground(x, z) - 0.8);                            // foot 0.8 m into the ground
    p.setXYZ(i, x, y, z);
  }
  rock.computeVertexNormals();
  const rockMesh = new THREE.Mesh(rock, rockMat);
  rockMesh.castShadow = rockMesh.receiveShadow = true;
  group.add(rockMesh);

  // The figure: rounded masses in the same stone, raised 0.3-0.6 m from the niche floor (z = 0.25).
  const base = ground(0, 0) + 0.3;
  const sph = new THREE.SphereGeometry(1, 20, 14);
  const add = (x, y, z, s) => {
    const o = new THREE.Mesh(sph, stone);
    o.position.set(x, base + y, z); o.scale.set(s[0], s[1], s[2]);
    o.castShadow = o.receiveShadow = true; group.add(o);
  };
  add(0, 0.55, -0.1, [1.9, 0.55, 0.5]);     // crossed legs, wide rounded base
  add(0, 0.95, -0.35, [1.3, 0.25, 0.3]);    // upper foot
  add(-0.9, 0.7, -0.2, [0.45, 0.4, 0.35]);  // knees
  add(0.9, 0.7, -0.2, [0.45, 0.4, 0.35]);
  add(0, 2.1, -0.15, [1.0, 1.2, 0.5]);      // torso
  add(0, 2.85, -0.2, [1.25, 0.35, 0.4]);    // shoulders
  add(-0.85, 2.0, -0.35, [0.3, 0.95, 0.3]); // arms
  add(0.85, 2.0, -0.35, [0.3, 0.95, 0.3]);
  add(0, 1.45, -0.5, [0.32, 0.22, 0.28]);   // hands in the lap
  add(0, 3.25, -0.2, [0.22, 0.25, 0.22]);   // neck
  add(0, 3.7, -0.2, [0.6, 0.72, 0.5]);      // head
  add(0, 4.35, -0.18, [0.2, 0.22, 0.2]);    // ushnisha
  for (let k = -2; k <= 2; k++) add(k * 0.45, 0.85, -0.42, [0.12, 0.12, 0.1]); // robe folds across the lap

  ctx.batch(group);
}
