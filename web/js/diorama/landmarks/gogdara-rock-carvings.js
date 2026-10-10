// Gogdara Rock Carvings: a cliff face at the foot of a slope, seated on the real DEM ground at the place point.
// The face is a box with a bulged front (no source gives its size: 11 m wide, 6 m high are estimates). The incised
// figures are drawn on a CanvasTexture after the reference photos (animal outlines, human-like figures, a spoked
// wheeled form, rings and dots); the sources give the rock's carvings as animals, humans, geometric patterns and
// inscriptions, and "animals and chariots" (Livius). The sixth-century CE Buddhist relief is not drawn.
const W = 11, H = 6;          // face width and height, metres (estimated)
const PX_W = 1024, PX_H = 560; // texture size, same aspect as the face

/** Carvings in viewer coordinates: mx to the viewer's right (-W/2 .. W/2), my up (-H/2 .. H/2), metres. */
function drawCarvings(THREE, c) {
  const x = (mx) => ((mx + W / 2) / W) * PX_W, y = (my) => ((H / 2 - my) / H) * PX_H, s = PX_W / W;
  const paths = [];                       // each entry draws one carving; stroked twice (shadow, then the pale line)
  const stroke = (fn) => paths.push(fn);
  // an animal outline, body centred at (mx, my), length L, facing left (-1) or right (1), horned
  const animal = (mx, my, L, dir, horn = true) => stroke((g) => {
    const cx = x(mx), cy = y(my), r = (L * s) / 2, hh = r * 0.42;
    g.beginPath(); g.ellipse(cx, cy, r * 0.9, hh, 0, 0, Math.PI * 2); g.stroke();
    const hx = cx + dir * r * 0.95, hy = cy - hh * 0.9;           // head
    g.beginPath(); g.arc(hx, hy, hh * 0.55, 0, Math.PI * 2); g.stroke();
    if (horn) { g.beginPath(); g.moveTo(hx - dir * hh * 0.2, hy - hh * 0.4);
      g.quadraticCurveTo(hx - dir * hh * 1.4, hy - hh * 1.9, hx - dir * hh * 0.1, hy - hh * 1.5); g.stroke(); }
    for (const lx of [-0.6, -0.2, 0.3, 0.7]) {                     // four legs
      g.beginPath(); g.moveTo(cx + lx * r, cy + hh * 0.7); g.lineTo(cx + lx * r + dir * r * 0.05, cy + hh * 2.0); g.stroke();
    }
    g.beginPath(); g.moveTo(cx - dir * r * 0.9, cy - hh * 0.2); g.quadraticCurveTo(cx - dir * r * 1.3, cy - hh * 1.3, cx - dir * r * 1.1, cy - hh * 1.5); g.stroke();
  });
  // a human-like figure: head, bell-shaped body, arms raised
  const human = (mx, my, h) => stroke((g) => {
    const cx = x(mx), top = y(my + h / 2), bot = y(my - h / 2), hs = (bot - top) / 5;
    g.beginPath(); g.arc(cx, top + hs * 0.5, hs * 0.45, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(cx - hs * 0.9, bot); g.lineTo(cx - hs * 0.35, top + hs * 1.1);
    g.lineTo(cx + hs * 0.35, top + hs * 1.1); g.lineTo(cx + hs * 0.9, bot); g.stroke();
    g.beginPath(); g.moveTo(cx - hs * 0.35, top + hs * 1.2); g.lineTo(cx - hs * 1.1, top - hs * 0.2); g.moveTo(cx + hs * 0.35, top + hs * 1.2); g.lineTo(cx + hs * 1.1, top - hs * 0.2); g.stroke();
  });
  // a two-wheeled chariot, its frame and a spoked wheel each side (after Livius: "animals and chariots")
  const chariot = (mx, my, w) => stroke((g) => {
    const cx = x(mx), cy = y(my), r = (w * s) / 2, wr = r * 0.42;
    g.beginPath(); g.moveTo(cx - r * 0.6, cy - wr * 0.5); g.lineTo(cx + r * 0.6, cy - wr * 0.5); g.lineTo(cx + r * 0.3, cy - wr * 1.6); g.lineTo(cx - r * 0.3, cy - wr * 1.6); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(cx + r * 0.6, cy - wr * 0.9); g.lineTo(cx + r * 1.4, cy - wr * 1.0); g.stroke();
    for (const wx of [-0.5, 0.4]) {
      const ex = cx + wx * r, ey = cy + wr * 0.9;
      g.beginPath(); g.arc(ex, ey, wr, 0, Math.PI * 2); g.stroke();
      for (let k = 0; k < 4; k++) { const a = (k * Math.PI) / 4; g.beginPath(); g.moveTo(ex - Math.cos(a) * wr, ey - Math.sin(a) * wr); g.lineTo(ex + Math.cos(a) * wr, ey + Math.sin(a) * wr); g.stroke(); }
    }
  });
  const rings = (mx, my, r) => stroke((g) => { g.beginPath(); g.arc(x(mx), y(my), r * s, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(x(mx), y(my), r * s * 0.45, 0, Math.PI * 2); g.stroke(); });
  const dots = (mx0, mx1, my, n) => stroke((g) => { for (let i = 0; i < n; i++) { const mx = mx0 + ((mx1 - mx0) * i) / (n - 1); g.beginPath(); g.arc(x(mx), y(my), 3.5, 0, Math.PI * 2); g.fill(); } });

  // the upper row: animals and geometric marks; the centre: a chariot with its horse; the right: humans
  animal(-3.6, 1.7, 1.5, 1, true);
  animal(-1.7, 2.0, 1.2, -1, true);
  dots(-4.6, -0.8, 2.6, 6);
  chariot(0.4, 1.2, 2.0);
  animal(1.2, 2.0, 1.1, 1, false);
  human(3.4, 1.0, 1.4);
  human(4.3, 0.9, 1.1);
  animal(-3.2, -1.2, 1.3, 1, true);
  rings(-4.4, -2.1, 0.35);
  rings(0.4, -1.8, 0.28);
  animal(2.6, -1.9, 1.2, -1, true);
  rings(4.5, -1.4, 0.3);

  c.strokeStyle = "rgba(38,34,28,0.55)"; c.fillStyle = "rgba(38,34,28,0.55)"; c.lineWidth = 9; c.lineCap = "round";
  for (const p of paths) { c.save(); c.translate(3, 3); p(c); c.restore(); }      // shadow of the incision
  c.strokeStyle = "#e6dfcc"; c.fillStyle = "#e6dfcc"; c.lineWidth = 5;
  for (const p of paths) p(c);                                                   // the pale incised line
}

function rockTexture(THREE, seed) {
  const cv = document.createElement("canvas"); cv.width = PX_W; cv.height = PX_H;
  const c = cv.getContext("2d");
  const g = c.createLinearGradient(0, 0, 0, PX_H);
  g.addColorStop(0, "#7c786e"); g.addColorStop(1, "#8a867b");
  c.fillStyle = g; c.fillRect(0, 0, PX_W, PX_H);
  let r = seed;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) {                     // grain, pits and a few lichen spots
    const light = rnd() > 0.5;
    c.fillStyle = light ? `rgba(200,196,184,${0.05 + rnd() * 0.08})` : `rgba(50,48,42,${0.05 + rnd() * 0.1})`;
    c.fillRect(rnd() * PX_W, rnd() * PX_H, 1 + rnd() * 3, 1 + rnd() * 2);
  }
  for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(150,140,90,${0.15 + rnd() * 0.15})`; c.beginPath(); c.arc(rnd() * PX_W, rnd() * PX_H, 4 + rnd() * 10, 0, 7); c.fill(); }
  drawCarvings(THREE, c);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

export default function build(ctx) {
  const { THREE, group, ground, M, rocks } = ctx;
  // the box: 3 m deep, front layer bulged toward the visitor (-z) and roughened; back layers stay behind it
  const geo = new THREE.BoxGeometry(W, H, 3, 60, 34, 4);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const t = (y + H / 2) / H, nx = x / (W / 2);
    const bulge = 1.05 * Math.sqrt(Math.max(0, 1 - nx * nx)) * (0.65 + 0.35 * (1 - t));
    const rough = 0.16 * Math.sin(x * 3.1 + y * 1.7) + 0.09 * Math.sin(x * 7.3 - y * 5.9) + 0.05 * Math.sin(x * 13.7 + y * 11.1);
    const k = (1.5 - z) / 3;                           // 1 at the front layer, 0 at the back
    const front = z < 0 ? 1 : 0;
    const fx = x + front * 0.08 * Math.sin(y * 9.3 + x * 4.1);
    const zz = z - (bulge + rough * front) * k;
    const gy = ground(fx, zz);                          // seat each vertex on the real slope, sunk 0.8 m
    pos.setXYZ(i, fx, gy - 0.8 + t * H * (1 + 0.04 * Math.sin(x * 1.3)), zz);
  }
  geo.computeVertexNormals();
  // material order of BoxGeometry: +x, -x, +y, -y, +z, -z (the front, toward the visitor, is -z)
  const rockMat = M.schist;
  const face = new THREE.MeshStandardMaterial({ map: rockTexture(THREE, 4217), roughness: 0.95, color: 0xffffff });
  const rock = new THREE.Mesh(geo, [rockMat, rockMat, rockMat, rockMat, rockMat, face]);
  rock.castShadow = rock.receiveShadow = true;
  group.add(rock);

  // loose blocks and scree at the foot, on the front and the sides
  rocks(9, 0, -2.2, 6.5, 0.45, M.schist, 3);
  rocks(5, -5.2, -0.8, 2.6, 0.35, M.stone, 9);
  rocks(4, 5.4, -0.6, 2.2, 0.35, M.stone, 11);
}
