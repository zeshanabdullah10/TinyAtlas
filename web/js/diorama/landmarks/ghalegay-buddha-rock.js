// Ghalegay Buddha: a rock mass with a seated Buddha in relief on its road face (the front, -z).
// Geometry is estimated from the photos and the DOAM boulder size (6.80 m x 3.20 m); see landmark.edits.
export default function build(ctx) {
  const { THREE, group, ground, hash, batch } = ctx;
  const rockM = ctx.mat(0x7d7463, { roughness: 1 });
  const stoneM = ctx.mat(0xc9bfa6, { roughness: 0.95 });   // carved panel reads paler than the rock, as in the photos

  // The rock: an ellipsoid of about 9.2 m x 8.4 m x 7.2 m, its road face flattened to a plane at z = 0,
  // displaced for a rough outline, and sunk into the real slope at its foot.
  const rock = new THREE.IcosahedronGeometry(1, 3);
  const p = rock.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i) * 4.6, y = p.getY(i) * 4.2 + 4.2, z = p.getZ(i) * 3.6 + 3.6;
    if (z < 1.4) z *= 0.3;                                 // flatten the road face
    const nx = x / 4.6, ny = (y - 4.2) / 4.2, nz = (z - 3.6) / 3.6;
    const len = Math.hypot(nx, ny, nz) || 1;
    const k = (hash(i, 3, 1) - 0.5) * 1.1;                 // rough outline, metres
    x += (k * nx) / len; y += (k * ny) / len; z += (k * nz) / len;
    y = Math.max(y, ground(x, z) - 0.4);                   // seat the foot on the ground
    p.setXYZ(i, x, y, z);
  }
  rock.computeVertexNormals();
  const rockMesh = new THREE.Mesh(rock, rockM);
  rockMesh.castShadow = rockMesh.receiveShadow = true;
  group.add(rockMesh);

  // The relief: raised geometry on the road face, feet about 1.2 m above the ground at the origin (estimated).
  const base = ground(0, 0) + 1.2;
  const sph = new THREE.SphereGeometry(1, 16, 12);
  const add = (geo, m, x, y, z, s = [1, 1, 1]) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z); o.scale.set(s[0], s[1], s[2]);
    o.castShadow = o.receiveShadow = true; group.add(o);
  };
  add(sph, stoneM, 0, base + 0.5, -0.35, [1.55, 0.5, 0.45]);     // crossed legs (lap)
  add(sph, stoneM, 0, base + 0.85, -0.5, [1.25, 0.28, 0.32]);    // upper foot
  add(sph, stoneM, 0, base + 1.9, -0.3, [0.9, 1.0, 0.42]);       // torso
  add(sph, stoneM, -0.95, base + 1.75, -0.45, [0.3, 0.8, 0.3]);  // arms
  add(sph, stoneM, 0.95, base + 1.75, -0.45, [0.3, 0.8, 0.3]);
  add(sph, stoneM, 0, base + 1.3, -0.6, [0.32, 0.22, 0.28]);     // hands in the lap
  add(sph, stoneM, 0, base + 2.7, -0.35, [1.15, 0.3, 0.35]);     // shoulders
  add(sph, stoneM, 0, base + 3.0, -0.35, [0.25, 0.25, 0.25]);    // neck
  add(sph, stoneM, 0, base + 3.5, -0.35, [0.55, 0.62, 0.45]);    // head
  add(sph, stoneM, 0, base + 4.2, -0.3, [0.2, 0.2, 0.2]);        // ushnisha
  add(new THREE.TorusGeometry(1.45, 0.1, 8, 40), stoneM, 0, base + 3.5, -0.2);  // halo

  ctx.batch(group);
}
