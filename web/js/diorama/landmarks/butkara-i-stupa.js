// Butkara I (Mingora, Swat): the excavated sacred area, drawn from the Atlas photos 01 (front view of the main stupa),
// 02 (drum courses), 03-04 (the votive stupa court: rings of square stone platforms, some with small stupas, column
// bases, flagged paving) and 06 (the stages of the stupa). No published dimensions were found for this stupa, so every
// size here is ESTIMATED from the photos (see landmark.edits in backend/tools/diorama_sites/butkara-i-stupa.json).
// Local metres: x right, -z front (the drive), y up. Everything is seated on ctx.ground.
import * as THREE from "three";

export default function build(ctx) {
  const { group, M, mat, box, cyl, lathe, ground, hash } = ctx;
  const FLAG = mat(0x9a978c, { roughness: 1 });       // excavated paving, pale grey schist flags
  const STONE = mat(0xc2bba8, { roughness: 1 });      // dressed platforms and column bases (lighter than the rubble)
  const SCHIST = mat(0x8c8677, { roughness: 1 });     // rubble masonry, drums, walls
  const PLASTER = M.plaster;                          // the whitewashed lower drum (photo 02)
  const y0 = ground(0, 0);

  // Paving: the court is a flat disc of flags, with a few lighter slabs to break it up (photos 01, 04).
  cyl(group, 40, 40, 0.06, FLAG, 0, y0 + 0.01, 0, 48);
  for (let i = 0; i < 60; i++) {
    const a = hash(i, 3, 1) * Math.PI * 2, r = Math.sqrt(hash(i, 3, 2)) * 36;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    box(group, 1.6 + hash(i, 3, 3) * 1.2, 0.04, 1.1 + hash(i, 3, 4) * 0.8, STONE, x, y0 + 0.06, z, hash(i, 3, 5) * 3);
  }

  // The main stupa (estimated): a stepped circular plinth of outer radius 9.5 m, a drum of radius 8 m rising
  // about 6 m, the lower part whitewashed on the front, and a broken top of rubble (photos 01, 02, 03).
  lathe(group, [[0, 0], [9.5, 0], [9.5, 0.6], [8.6, 0.6], [8.6, 1.2], [8.0, 1.2], [8.0, 1.5], [0, 1.5]], SCHIST, 0, y0, 0, 40);
  // The drum: rubble courses (a 0.18 m step every metre, photo 02), topped at 6.2 m.
  const drum = [[8.0, 0]];
  for (let k = 0; k < 6; k++) drum.push([8.18, k + 0.12], [8.18, k + 0.95], [8.0, k + 1.0]);
  drum.push([7.8, 6.2], [0, 6.2]);
  lathe(group, drum, SCHIST, 0, y0 + 1.5, 0, 40);
  // Whitewash on the lower drum, the front quarter (-z is front, so phi = pi at the centre).
  const plaster = new THREE.Mesh(new THREE.LatheGeometry(
    [new THREE.Vector2(8.06, 0.2), new THREE.Vector2(8.06, 2.6)], 24, Math.PI * 0.62, Math.PI * 0.76), PLASTER);
  plaster.position.set(0, y0 + 1.5, 0); plaster.castShadow = plaster.receiveShadow = true; group.add(plaster);
  // The broken dome: a partial lathe on the back half, the rest rubble.
  const dome = new THREE.Mesh(new THREE.LatheGeometry(
    [new THREE.Vector2(7.8, 0), new THREE.Vector2(7.2, 0.9), new THREE.Vector2(5.6, 1.6), new THREE.Vector2(3.4, 2.0)], 28, 0, Math.PI * 1.05), SCHIST);
  dome.position.set(0, y0 + 7.7, 0); dome.castShadow = dome.receiveShadow = true; group.add(dome);
  for (let i = 0; i < 26; i++) {
    const a = hash(i, 7, 1) * Math.PI * 2, r = 5 + hash(i, 7, 2) * 3.2, k = 0.5 + hash(i, 7, 3) * 0.9;
    box(group, k, k * 0.6, k * 0.8, SCHIST, Math.cos(a) * r, y0 + 6.2 + hash(i, 7, 4) * 1.2, Math.sin(a) * r, hash(i, 7, 5) * 3);
  }

  // Low court wall on the front, a 240 degree arc of rubble at radius 16 m (photo 01, 03).
  for (let i = 0; i < 10; i++) {
    const a = Math.PI * (0.5 + i * 0.13), x = Math.cos(a) * 16, z = Math.sin(a) * 16;
    box(group, 4.2, 0.9, 0.7, SCHIST, x, ground(x, z), z, -(a + Math.PI / 2));   // ry turns the box's length onto the tangent
  }

  // The votive stupa rings (photos 03, 04): square stone platforms, most with a small stupa (a drum and a dome).
  // Radius, count, platform side and height, and the chance of a stupa on each are estimates.
  const rings = [
    { r: 21, n: 10, side: 3.0, h: 0.8, p: 0.9, dr: 0.9, dh: 1.2, seed: 11 },
    { r: 31, n: 16, side: 2.6, h: 0.6, p: 0.6, dr: 0.8, dh: 1.0, seed: 23 },
    { r: 41, n: 18, side: 2.2, h: 0.45, p: 0.3, dr: 0.7, dh: 0.8, seed: 37 },
  ];
  for (const R of rings) {
    for (let i = 0; i < R.n; i++) {
      const a = (i / R.n) * Math.PI * 2 + hash(i, R.seed, 1) * 0.2;
      const rr = R.r + (hash(i, R.seed, 2) - 0.5) * 1.2;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const side = R.side * (0.9 + hash(i, R.seed, 3) * 0.2);
      box(group, side, R.h, side, STONE, x, ground(x, z), z, hash(i, R.seed, 4) * 0.2);
      if (hash(i, R.seed, 5) < R.p) {
        const py = ground(x, z) + R.h, dr = R.dr * (0.9 + hash(i, R.seed, 6) * 0.2);
        lathe(group, [[dr, 0], [dr, R.dh], [dr * 0.92, R.dh + 0.12]], SCHIST, x, py, z, 16);
        lathe(group, [[dr, R.dh + 0.12], [dr * 0.8, R.dh + dr * 0.45], [dr * 0.45, R.dh + dr * 0.8], [0, R.dh + dr * 0.92]], STONE, x, py, z, 16);
      }
    }
  }

  // Outer ring of column bases (photo 04: the round bases beside the platforms), and a broken wall at radius 52.
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2 + 0.07, x = Math.cos(a) * 52, z = Math.sin(a) * 52;
    cyl(group, 0.55, 0.6, 0.35, STONE, x, ground(x, z), z, 12);
    cyl(group, 0.34, 0.34, 0.22, SCHIST, x, ground(x, z) + 0.35, z, 10);
  }
  for (let i = 0; i < 12; i++) {
    const a = Math.PI * (0.1 + i * 0.12) + 0.4, x = Math.cos(a) * 60, z = Math.sin(a) * 60;
    box(group, 6.0, 0.8, 0.6, SCHIST, x, ground(x, z), z, -(a + Math.PI / 2));
  }

  ctx.batch(group);
  return {};
}
