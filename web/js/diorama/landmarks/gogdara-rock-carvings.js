// Gogdara Rock Carvings: a weathered granite boulder, leaning back, seated on the real DEM ground at the place point.
// Its size is estimated (no source gives one): about 12 x 6 x 8 m. The shape is an icosahedron pushed toward a box,
// with low-frequency noise, its carved face flattened and tilted back about 30 degrees, and its base sunk 1 m.
// The incised figures are drawn after the reference photos (animal outlines with horns, human-like figures, a
// spoked wheeled form, rings and dots) as pale thin lines only ~18% lighter than the rock. The sources give
// animals, humans, geometric patterns and inscriptions, and "animals and chariots" (Livius). The sixth-century CE
// Buddhist relief is not drawn.
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

const W = 12, H = 6;            // face width and height, metres (estimated)
const PX_W = 1024, PX_H = 512;  // carving texture, same aspect as the face
const GRANITE = "#8e8a80", LINE = "#a7a296";
const OFF_X = -4, OFF_Z = 4;   // the boulder's centre: 4 m west and 4 m south of the place point (5.7 m away)

/** Carvings in viewer coordinates: mx to the viewer's right (-W/2 .. W/2), my up (-H/2 .. H/2), metres. */
function drawCarvings(c) {
  const x = (mx) => ((mx + W / 2) / W) * PX_W, y = (my) => ((H / 2 - my) / H) * PX_H, s = PX_W / W;
  const paths = [];
  const stroke = (fn) => paths.push(fn);
  // an animal outline, body centred at (mx, my), length L, facing dir (-1 left, 1 right), with a horn
  const animal = (mx, my, L, dir, horn = true) => stroke((g) => {
    const cx = x(mx), cy = y(my), r = (L * s) / 2, hh = r * 0.42;
    g.beginPath(); g.ellipse(cx, cy, r * 0.9, hh, 0, 0, Math.PI * 2); g.stroke();
    const hx = cx + dir * r * 0.95, hy = cy - hh * 0.9;
    g.beginPath(); g.arc(hx, hy, hh * 0.55, 0, Math.PI * 2); g.stroke();
    if (horn) { g.beginPath(); g.moveTo(hx - dir * hh * 0.2, hy - hh * 0.4);
      g.quadraticCurveTo(hx - dir * hh * 1.4, hy - hh * 1.9, hx - dir * hh * 0.1, hy - hh * 1.5); g.stroke(); }
    for (const lx of [-0.6, -0.2, 0.3, 0.7]) {
      g.beginPath(); g.moveTo(cx + lx * r, cy + hh * 0.7); g.lineTo(cx + lx * r + dir * r * 0.05, cy + hh * 2.0); g.stroke();
    }
    g.beginPath(); g.moveTo(cx - dir * r * 0.9, cy - hh * 0.2); g.quadraticCurveTo(cx - dir * r * 1.3, cy - hh * 1.3, cx - dir * r * 1.1, cy - hh * 1.5); g.stroke();
  });
  // a human-like figure, head, bell-shaped body and arms raised
  const human = (mx, my, h) => stroke((g) => {
    const cx = x(mx), top = y(my + h / 2), bot = y(my - h / 2), hs = (bot - top) / 5;
    g.beginPath(); g.arc(cx, top + hs * 0.5, hs * 0.45, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(cx - hs * 0.9, bot); g.lineTo(cx - hs * 0.35, top + hs * 1.1);
    g.lineTo(cx + hs * 0.35, top + hs * 1.1); g.lineTo(cx + hs * 0.9, bot); g.stroke();
    g.beginPath(); g.moveTo(cx - hs * 0.35, top + hs * 1.2); g.lineTo(cx - hs * 1.1, top - hs * 0.2);
    g.moveTo(cx + hs * 0.35, top + hs * 1.2); g.lineTo(cx + hs * 1.1, top - hs * 0.2); g.stroke();
  });
  // a two-wheeled chariot with spoked wheels (after Livius: "animals and chariots")
  const chariot = (mx, my, w) => stroke((g) => {
    const cx = x(mx), cy = y(my), r = (w * s) / 2, wr = r * 0.42;
    g.beginPath(); g.moveTo(cx - r * 0.6, cy - wr * 0.5); g.lineTo(cx + r * 0.6, cy - wr * 0.5);
    g.lineTo(cx + r * 0.3, cy - wr * 1.6); g.lineTo(cx - r * 0.3, cy - wr * 1.6); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(cx + r * 0.6, cy - wr * 0.9); g.lineTo(cx + r * 1.4, cy - wr * 1.0); g.stroke();
    for (const wx of [-0.5, 0.4]) {
      const ex = cx + wx * r, ey = cy + wr * 0.9;
      g.beginPath(); g.arc(ex, ey, wr, 0, Math.PI * 2); g.stroke();
      for (let k = 0; k < 4; k++) { const a = (k * Math.PI) / 4; g.beginPath(); g.moveTo(ex - Math.cos(a) * wr, ey - Math.sin(a) * wr); g.lineTo(ex + Math.cos(a) * wr, ey + Math.sin(a) * wr); g.stroke(); }
    }
  });
  const rings = (mx, my, r) => stroke((g) => { g.beginPath(); g.arc(x(mx), y(my), r * s, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(x(mx), y(my), r * s * 0.45, 0, Math.PI * 2); g.stroke(); });
  const dots = (mx0, mx1, my, n) => stroke((g) => { for (let i = 0; i < n; i++) { const mx = mx0 + ((mx1 - mx0) * i) / (n - 1); g.beginPath(); g.arc(x(mx), y(my), 3, 0, Math.PI * 2); g.stroke(); } });

  animal(-3.6, 1.5, 1.5, 1, true);
  animal(-1.7, 1.8, 1.2, -1, true);
  dots(-4.6, -0.8, 2.4, 6);
  chariot(0.4, 1.0, 2.0);
  animal(1.2, 1.9, 1.1, 1, false);
  human(3.4, 0.9, 1.4);
  human(4.3, 0.8, 1.1);
  animal(-3.2, -1.2, 1.3, 1, true);
  rings(-4.4, -2.0, 0.35);
  rings(0.4, -1.8, 0.28);
  animal(2.6, -1.8, 1.2, -1, true);
  rings(4.5, -1.3, 0.3);

  c.strokeStyle = LINE; c.lineWidth = 2.2; c.lineCap = "round"; c.lineJoin = "round";
  try { c.filter = "blur(0.6px)"; } catch (e) { /* no canvas filter: lines stay sharp */ }
  for (const p of paths) p(c);
  try { c.filter = "none"; } catch (e) { /* ignore */ }
}

function rockTexture(THREE) {
  const cv = document.createElement("canvas"); cv.width = PX_W; cv.height = PX_H;
  const c = cv.getContext("2d");
  c.fillStyle = GRANITE; c.fillRect(0, 0, PX_W, PX_H);
  let r = 4217;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 3000; i++) {                       // granite grain: tiny light and dark specks
    c.fillStyle = rnd() > 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)";
    c.fillRect(rnd() * PX_W, rnd() * PX_H, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  drawCarvings(c);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

export default function build(ctx) {
  const { THREE, group, ground } = ctx;
  const tanTilt = Math.tan(THREE.MathUtils.degToRad(30));
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    // toward a box: a cube-like boulder with rounded edges (blend 0.8 of the way to the cube surface)
    const m = Math.max(Math.abs(px), Math.abs(py), Math.abs(pz));
    let dx = px + (px / m - px) * 0.8, dy = py + (py / m - py) * 0.8, dz = pz + (pz / m - pz) * 0.8;
    let X = dx * (W / 2), Y = dy * (H / 2), Z = dz * 4;
    // low-frequency noise, about 0.4 m, along the surface
    const n = 0.4 * (0.5 * Math.sin(dx * 1.3 + dy * 0.7) + 0.3 * Math.sin(dy * 1.1 - dz * 1.7) + 0.2 * Math.sin(dz * 1.9 + dx * 0.9));
    const len = Math.hypot(dx, dy, dz) || 1;
    X += (n * dx) / len; Y += (n * dy) / len; Z += (n * dz) / len;
    // the carved face: everything in front of a plane tilted back about 30 degrees is flattened onto it
    if (Z < 0) {
      const zf = -3.8 + Y * tanTilt;
      Z = zf + 0.08 * Math.sin(X * 2.1 + Y * 3.3);
    }
    // seat the base 1 m into the real slope
    const sx = X + OFF_X, sz = Z + OFF_Z;
    const g = ground(sx, sz);
    pos.setXYZ(i, sx, Y + H / 2 + g - 1, sz);
    // planar uv for the carved face (viewer's right is -x); the back and sides use a plain corner of the texture
    if (Z < -0.2) { uv[i * 2] = (W / 2 - X) / W; uv[i * 2 + 1] = (Y + H / 2) / H; }
    else { uv[i * 2] = 0.01; uv[i * 2 + 1] = 0.01; }
    // granite colour with vertex variation and lichen-ochre patches
    const v = 0.92 + 0.12 * (0.5 + 0.5 * Math.sin(X * 0.9 + Y * 1.3) * Math.cos(Z * 0.7));
    const o = Math.sin(X * 0.6 - Z * 0.5 + 1.7) * Math.sin(Y * 1.1 + X * 0.3) > 0.55 ? 0.3 : 0;
    col[i * 3] = v * (1 + 0.1 * o); col[i * 3 + 1] = v * (1 - 0.04 * o); col[i * 3 + 2] = v * (1 - 0.25 * o);
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const smooth = mergeVertices(geo);                      // shared vertices: smooth shading (the carved face stays flat)
  smooth.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ map: rockTexture(THREE), vertexColors: true, roughness: 0.95, metalness: 0 });
  const rock = new THREE.Mesh(smooth, mat);
  rock.castShadow = true; rock.receiveShadow = false;    // self-shadowing of the bulged face made a diamond acne
  rock.userData.keep = true;                              // keep out of ctx.batch: it carries its own uv and colour
  group.add(rock);
}
