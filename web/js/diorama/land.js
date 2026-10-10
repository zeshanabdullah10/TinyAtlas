// Ground: the near terrain (10 m cells), the coarse horizon ring (60 m), and the tabletop pieces (cut walls, plinth,
// name plate). Colours follow the Atlas poster grade: ochre rock, golden-green meadow, deep blue-green forest, cream snow.
import * as THREE from "three";
import { seasonize } from "./season.js";

const PAL = {            // sRGB
  1: [52, 86, 64], 2: [158, 172, 74], 3: [180, 142, 96], 4: [242, 240, 232], 5: [64, 102, 96], 6: [138, 146, 92], 7: [116, 134, 62], 0: [158, 172, 74],
  8: [176, 164, 140],    // built-up (towns): packed earth, lanes and yards
};
// Heights here are relative to the site's y = 0 (the lake or the arrival). Snow lies above y = 1550 (about 4,400 m at
// Mahodand) but never below 3,400 m above sea level, so the low valleys (Mingora, about 930 m) are not white in summer.
let snowY = 1550;
const lin = (c) => Math.pow(c / 255, 2.2);

function colourAt(cover, alt, slope, out, i) {
  let c = PAL[cover] || PAL[2];
  let r = c[0], g = c[1], b = c[2];
  if (cover === 2 || cover === 6 || cover === 7) {          // meadows dry toward ochre with height
    const t = Math.min(Math.max((alt - 400) / 900, 0), 1);
    r += (186 - r) * t * 0.55; g += (164 - g) * t * 0.55; b += (94 - b) * t * 0.55;
  }
  const steep = Math.min(Math.max((slope - 0.62) / 0.5, 0), 1);   // tan(32°)..tan(48°)
  if (cover !== 4 && cover !== 5 && cover !== 1) { r += (150 - r) * steep; g += (116 - g) * steep; b += (86 - b) * steep; }
  if (cover !== 5 && alt > snowY) {                         // high, gentle ground holds snow late (about 4,400 m and up)
    const t = Math.min((alt - snowY) / 300, 1) * (1 - steep * 0.8);
    r += (238 - r) * t; g += (238 - g) * t; b += (232 - b) * t;
  }
  out[i] = lin(r); out[i + 1] = lin(g); out[i + 2] = lin(b);
}

const DETAIL = /* glsl */ `
varying vec3 vW;
float th(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float tn(vec2 x) { vec2 i = floor(x), f = fract(x), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(th(i), th(i + vec2(1, 0)), u.x), mix(th(i + vec2(0, 1)), th(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * tn(p); p *= 2.03; a *= 0.5; } return s; }`;

function terrainMaterial({ hole = null } = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  m.customProgramCacheKey = () => (hole ? "dio-far" : "dio-near");   // same source, different closure: keep the programs apart
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vW;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\n${DETAIL}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
  ${hole ? `if (abs(vW.x) < ${hole[0].toFixed(1)} && abs(vW.z) < ${hole[1].toFixed(1)}) discard;` : ""}
  // bare ground (ochre) gets the meadow's life: grass breaking through in patches, scree and stones, not flat sand
  float bare = smoothstep(1.05, 1.35, diffuseColor.r / max(diffuseColor.g, 0.01)) * (1.0 - smoothstep(0.5, 0.7, diffuseColor.b));
  if (bare > 0.0) {
    float turf = smoothstep(0.36, 0.6, fbm(vW.xz / 16.0 + 7.3));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.20, 0.27, 0.07), bare * turf * 0.85);
    float stones = smoothstep(0.78, 0.9, tn(vW.xz * 1.7)) * (1.0 - turf);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.26, 0.24, 0.22), bare * stones * 0.6);
  }
  float patchy = fbm(vW.xz / 55.0);
  float grain = tn(vW.xz * 0.9) * 0.6 + tn(vW.xz * 3.7) * 0.4;
  diffuseColor.rgb *= 0.82 + 0.3 * patchy + 0.14 * (grain - 0.5);
  float close = 1.0 - smoothstep(25.0, 260.0, distance(vW, cameraPosition));
  if (close > 0.0) {                              // ground detail you only see from the jeep
    float tuft = tn(vW.xz * 1.3) * 0.45 + tn(vW.xz * 4.1) * 0.35 + tn(vW.xz * 0.47) * 0.2;
    float clump = fbm(vW.xz * 0.21);
    diffuseColor.rgb *= 1.0 + close * (0.55 * (tuft - 0.5) + 0.35 * (clump - 0.5));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 1.0, 0.7), close * smoothstep(0.55, 0.8, clump) * 0.6);
  }
  float snow = smoothstep(0.75, 0.9, diffuseColor.g) * step(0.75, diffuseColor.b);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.88, 0.92), snow * 0.3);`);
  };
  return m;
}

function gridGeometry(cols, rows, cell, x0, z0, heights, covers, yOff = 0) {
  const n = cols * rows, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, h = heights[i];
    pos[i * 3] = x0 + c * cell; pos[i * 3 + 1] = h + yOff; pos[i * 3 + 2] = z0 + r * cell;
    const hx = heights[r * cols + Math.min(c + 1, cols - 1)] - heights[r * cols + Math.max(c - 1, 0)];
    const hz = heights[Math.min(r + 1, rows - 1) * cols + c] - heights[Math.max(r - 1, 0) * cols + c];
    colourAt(covers[i], h, Math.hypot(hx, hz) / (2 * cell), col, i * 3);
  }
  const idx = new Uint32Array((cols - 1) * (rows - 1) * 6);
  let k = 0;
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
    const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
    idx[k++] = a; idx[k++] = d; idx[k++] = b; idx[k++] = b; idx[k++] = d; idx[k++] = e;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  return geo;
}

export function nearTerrain(site) {
  snowY = Math.max(1550, 3400 - site.Y0);
  const g = site.meta.grid;
  const mesh = new THREE.Mesh(gridGeometry(g.cols, g.rows, g.cell, site.x0, site.z0, site.H, site.C), seasonize(terrainMaterial(), "ground"));
  mesh.receiveShadow = true; mesh.castShadow = true;
  return mesh;
}

export function farTerrain(site) {
  snowY = Math.max(1550, 3400 - site.Y0);
  const f = site.meta.far, g = site.meta.grid;
  const mesh = new THREE.Mesh(gridGeometry(f.cols, f.rows, f.cell, f.x0, f.z0, site.FH, site.FC, -2),
    seasonize(terrainMaterial({ hole: [g.width / 2 - 4, g.height / 2 - 4] }), "ground"));
  mesh.receiveShadow = false;
  return mesh;
}

/** The cut edge of the model, banded like exposed strata, plus a walnut plinth and a name plate. */
export function tabletop(site) {
  const g = site.meta.grid, group = new THREE.Group();
  const yb = g.hmin - site.Y0 - 180;
  const W = g.width / 2, D = g.height / 2;
  const pos = [], idx = [];
  const edges = [
    [g.cols, (i) => [site.x0 + i * g.cell, site.z0 + (g.rows - 1) * g.cell, (g.rows - 1) * g.cols + i]],   // south
    [g.rows, (i) => [site.x0 + (g.cols - 1) * g.cell, site.z0 + (g.rows - 1 - i) * g.cell, (g.rows - 1 - i) * g.cols + g.cols - 1]], // east
    [g.cols, (i) => [site.x0 + (g.cols - 1 - i) * g.cell, site.z0, g.cols - 1 - i]],                       // north
    [g.rows, (i) => [site.x0, site.z0 + i * g.cell, i * g.cols]],                                          // west
  ];
  for (const [n, at] of edges) {
    const base = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const [x, z, k] = at(i);
      pos.push(x, site.H[k], z, x, yb, z);
    }
    for (let i = 0; i < n - 1; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const wall = new THREE.MeshStandardMaterial({ roughness: 0.95, side: THREE.FrontSide });
  wall.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vW;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\n${DETAIL}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
  float yy = vW.y + 22.0 * fbm(vec2(vW.x + vW.z, vW.y) / 160.0);
  float band = fract(yy / 85.0);
  vec3 a = vec3(0.47, 0.33, 0.21), b = vec3(0.62, 0.47, 0.3), c = vec3(0.36, 0.26, 0.19);
  vec3 col = mix(mix(a, b, smoothstep(0.2, 0.5, band)), c, smoothstep(0.75, 0.95, band));
  col *= 0.85 + 0.25 * tn(vec2(vW.x + vW.z, vW.y) / 9.0);
  diffuseColor.rgb = col;`);
  };
  const wallMesh = new THREE.Mesh(geo, wall);
  wallMesh.receiveShadow = true;
  group.add(wallMesh);

  const P = 70, PH = 150;
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(2 * W + 2 * P, PH, 2 * D + 2 * P),
    new THREE.MeshStandardMaterial({ color: 0x3a2417, roughness: 0.55, metalness: 0.05 }));
  plinth.position.set(0, yb - PH / 2, 0);
  plinth.receiveShadow = true; plinth.castShadow = true;
  group.add(plinth);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(2 * W + 2 * P + 30, 18, 2 * D + 2 * P + 30),
    new THREE.MeshStandardMaterial({ color: 0x2a1910, roughness: 0.5 }));
  lip.position.set(0, yb - PH - 9, 0);
  group.add(lip);

  const cv = document.createElement("canvas"); cv.width = 1024; cv.height = 192;
  const cx = cv.getContext("2d");
  const grad = cx.createLinearGradient(0, 0, 0, 192);
  grad.addColorStop(0, "#e7c27a"); grad.addColorStop(1, "#b98a3e");
  cx.fillStyle = grad; cx.fillRect(0, 0, 1024, 192);
  cx.strokeStyle = "rgba(60,36,10,.55)"; cx.lineWidth = 6; cx.strokeRect(10, 10, 1004, 172);
  cx.fillStyle = "#3a2410"; cx.textAlign = "center";
  cx.font = "700 74px 'Cormorant SC', Georgia, serif"; cx.fillText(site.meta.title.toUpperCase(), 512, 98);
  cx.font = "italic 500 38px 'Cormorant Garamond', Georgia, serif";
  cx.fillText(`${site.meta.subtitle} · ${(site.meta.facts.lake_level_m ?? site.meta.facts.arrival_m).toLocaleString("en")} m`, 512, 152);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(1400, 262),
    new THREE.MeshStandardMaterial({ map: tex, metalness: 0.55, roughness: 0.35 }));
  plate.position.set(0, yb - PH / 2, D + P + 1.5);
  group.add(plate);
  group.userData.plate = { canvas: cv, tex };

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), new THREE.ShadowMaterial({ opacity: 0.38 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = yb - PH - 18; floor.receiveShadow = true;
  group.add(floor);
  group.userData.bottom = yb - PH - 18;
  return group;
}
