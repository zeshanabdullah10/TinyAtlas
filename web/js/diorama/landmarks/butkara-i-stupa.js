// Butkara I (Mingora, Swat): the excavated sacred court, drawn from the Atlas photos 01 (the main stupa behind the
// court), 03 (its drum courses), 02 and 04 (the votive court: square stepped plinths in rows, most ruined, a few with
// a drum and dome; flagged paving) and 06 (the stages of the stupa). No published dimensions were found, so every size is ESTIMATED from the
// photos (see landmark.edits in backend/tools/diorama_sites/butkara-i-stupa.json). Local metres: x right, -z front
// (the drive), y up. The court is at ground level: the terrain is the build's, and a landmark cannot cut it (the photos
// do not show a measured sinking, so none is modelled). A low wall edges it.
import * as THREE from "three";

const COURT = { w: 60, d: 50, wall: 0.8 };          // estimated: a rectangular court with a low kerb wall

export default function build(ctx) {
  const { group, M, mat, box, lathe, ground, hash } = ctx;
  const y0 = ground(0, 0);
  const FLOOR = y0 + 0.04;                          // the court floor, at the ground (see the header: not sunk)

  const SCHIST = mat(0x7d786e, { roughness: 1 });   // grey schist rubble
  const LIGHT = mat(0x9b968a, { roughness: 1 });    // lighter courses in the drum
  const WALL = mat(0x8f8a7e, { roughness: 1 });     // retaining wall, the same stone, weathered
  const SHADES = [0xbab3a6, 0xaca597, 0xc6bfb2, 0xb3ac9f].map((c) => mat(c, { roughness: 1 })); // +-8% plinth shades

  // The low wall round the court (estimated 0.8 m high, 0.8 m thick) edging the paving.
  box(group, 0.8, COURT.wall, COURT.d + 0.8, WALL, -COURT.w / 2 - 0.4, FLOOR, 0);
  box(group, 0.8, COURT.wall, COURT.d + 0.8, WALL, COURT.w / 2 + 0.4, FLOOR, 0);
  box(group, COURT.w + 0.8, COURT.wall, 0.8, WALL, 0, FLOOR, -COURT.d / 2 - 0.4);
  box(group, COURT.w + 0.8, COURT.wall, 0.8, WALL, 0, FLOOR, COURT.d / 2 + 0.4);

  // The main stupa (estimated): a stepped circular core of about 19 m across, built of stacked courses with
  // slightly irregular radii (photos 01-03), a lighter band every other course, and a broken top of rubble.
  const K = 7, course = 0.9;
  const prof = [[0, 0]];
  const radii = [];
  for (let k = 0; k < K; k++) {
    const R = 8.8 - k * 0.2 + (hash(k, 1, 9) - 0.5) * 0.5;
    radii.push(R);
    prof.push([R, k * course], [R, k * course + 0.85], [R - 0.25, k * course + course]);
  }
  prof.push([0, K * course]);
  lathe(group, prof, SCHIST, 0, FLOOR, 0, 40);
  for (let k = 1; k < K; k += 2) {
    const R = radii[k] + 0.12, y = k * course;
    lathe(group, [[0, y + 0.05], [R, y + 0.05], [R, y + 0.5], [0, y + 0.5]], LIGHT, 0, FLOOR, 0, 40);
  }
  for (let i = 0; i < 30; i++) {                    // broken top: rubble, heavier to the back
    const a = hash(i, 7, 1) * Math.PI * 2, r = 3.5 + hash(i, 7, 2) * 3.6, k = 0.5 + hash(i, 7, 3) * 0.9;
    box(group, k, k * 0.6, k * 0.8, SCHIST, Math.cos(a) * r, FLOOR + K * course - 0.2 + hash(i, 7, 4) * 1.0,
      Math.sin(a) * r, hash(i, 7, 5) * 3);
  }

  // The votive court (photos 03-04): square stepped plinths in rows round the main stupa. Most are ruined to the
  // plinth; about one in six carries a small drum and dome. Sizes 2-5 m, 0.6-1.5 m high (estimated).
  for (let gx = -24; gx <= 24; gx += 6) {
    for (let gz = -18; gz <= 18; gz += 6) {
      const x = gx + (hash(gx, gz, 1) - 0.5) * 2.0, z = gz + (hash(gx, gz, 2) - 0.5) * 2.0;
      if (Math.hypot(x, z) < 13 || hash(gx, gz, 3) < 0.25) continue;
      const size = 2 + hash(gx, gz, 4) * 3, h = 0.6 + hash(gx, gz, 5) * 0.9;
      const m = SHADES[Math.floor(hash(gx, gz, 6) * SHADES.length)];
      const rot = (hash(gx, gz, 7) - 0.5) * 0.2;
      box(group, size, h * 0.5, size, m, x, FLOOR, z, rot);                                   // the plinth
      box(group, size * 0.72, h * 0.5, size * 0.72, m, x, FLOOR + h * 0.5, z, rot);           // its upper step
      if (hash(gx, gz, 8) < 0.17) {
        const dr = size * 0.18, top = FLOOR + h;
        lathe(group, [[dr, 0], [dr, 0.9], [dr * 0.92, 1.0]], SCHIST, x, top, z, 16);
        lathe(group, [[dr, 1.0], [dr * 0.8, 1.0 + dr * 0.45], [dr * 0.45, 1.0 + dr * 0.8], [0, 1.0 + dr * 0.92]],
          LIGHT, x, top, z, 16);
      }
    }
  }

  // The plaster patch of photo 03: a whitewashed band on the lower front of the drum (phi = pi is the front, -z).
  // Its points run top to bottom so the faces point outward.
  const plaster = new THREE.Mesh(new THREE.LatheGeometry(
    [new THREE.Vector2(8.1, 2.6), new THREE.Vector2(8.1, 0.2)], 24, Math.PI * 0.62, Math.PI * 0.76), M.plaster);
  plaster.position.set(0, FLOOR + 1.5, 0); plaster.castShadow = plaster.receiveShadow = true; group.add(plaster);

  ctx.batch(group);

  // The paving: one rectangle of slabs in running bond, drawn on a canvas texture. It is kept out of the batch
  // (a merge drops texture coordinates), so it is added after it.
  const cv = document.createElement("canvas");
  cv.width = cv.height = 256;
  const g2 = cv.getContext("2d");
  g2.fillStyle = "#ffffff"; g2.fillRect(0, 0, 256, 256);
  g2.strokeStyle = "#cfcac0"; g2.lineWidth = 4;
  for (let row = 0; row < 4; row++) {
    const y = row * 64, off = row % 2 ? 32 : 0;
    g2.beginPath(); g2.moveTo(0, y); g2.lineTo(256, y); g2.stroke();
    for (let c = 0; c <= 4; c++) {
      const x = off + c * 64;
      g2.beginPath(); g2.moveTo(x, y); g2.lineTo(x, y + 64); g2.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(COURT.w / 4, COURT.d / 4);          // one 4 m tile = 4 x 4 slabs of about 1 m
  const paving = new THREE.Mesh(new THREE.PlaneGeometry(COURT.w, COURT.d),
    new THREE.MeshStandardMaterial({ map: tex, color: 0xa9a39a, roughness: 1 }));
  paving.rotation.x = -Math.PI / 2;
  paving.position.set(0, FLOOR + 0.03, 0);
  paving.castShadow = false; paving.receiveShadow = true;
  paving.userData.keep = true;
  group.add(paving);
  return {};
}
