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

// Value noise with its gradient (for the detail normal), two octaves, rotated so the lattice never lines up.
const BUMP = /* glsl */ `
vec3 tnd(vec2 x) { vec2 i = floor(x), f = fract(x), u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
  float a = th(i), b = th(i + vec2(1, 0)), c = th(i + vec2(0, 1)), d = th(i + vec2(1, 1));
  return vec3(a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y, du * (vec2(b - a, c - a) + (a - b - c + d) * u.yx)); }
const mat2 ROT = mat2(0.8, -0.6, 0.6, 0.8);
vec3 bump2(vec2 p) { vec3 a = tnd(p); vec3 b = tnd(ROT * p * 2.7 + 3.1); b.yz = b.yz * ROT * 2.7;
  return a * vec3(1.0, 1.0, 1.0) + b * vec3(0.45, 0.45, 0.45); }`;

const GROUND = /* glsl */ `
  vec3 N0 = normalize(vNt);
  float g_dist = distance(vW, cameraPosition);
  vec3 g_col = diffuseColor.rgb;
  if (uAlbOn > 0.5) {                        // Sentinel-2 cloudless 2016 ground colour (diorama_albedo.py)
    g_col = texture2D(uAlb, ((vW.xz - uAlbO) / uAlbP + 0.5) / uAlbN).rgb;
    float l0 = dot(g_col, vec3(0.2126, 0.7152, 0.0722));
    // the mosaic is darker and flatter than the ground: lift the darks (forest, meadow) more than pale towns and snow
    g_col = max(mix(vec3(l0), g_col, 1.15), 0.0) * mix(1.5, 1.08, smoothstep(0.12, 0.4, l0));
    // The pack's albedo was graded toward the poster's ochre; where WorldCover maps meadow or forest, take the hue
    // back toward the green the visitors' photos show, keeping the satellite's brightness and every patch in it.
    float bare = smoothstep(0.30, 0.55, l0);                      // bright: snow, scree, fields in stubble keep their colour
    vec3 meadow = vec3(0.62, 0.78, 0.30) * (l0 / 0.708), forest = vec3(0.30, 0.52, 0.36) * (l0 / 0.474);
    g_col = mix(g_col, meadow * 1.5 * 1.1, vVeg.x * 0.55 * (1.0 - bare));
    g_col = mix(g_col, forest * 1.5, vVeg.y * 0.5 * (1.0 - bare));
    // Within ~3 km the satellite's soft ochre would dominate: where WorldCover says meadow/crop or forest, the colour
    // is the visitors' photos' (uRefM, uRefF) and the satellite only says how much lighter or darker each patch is.
    float nearT = 1.0 - smoothstep(1200.0, 4500.0, g_dist);
    vec3 refM = uRefM * mix(1.0, clamp(l0 / uMeanM, 0.6, 1.35), 0.85);
    vec3 refF = uRefF * mix(1.0, clamp(l0 / uMeanF, 0.6, 1.35), 0.85);
    g_col = mix(g_col, refM, vVeg.x * 0.9 * (1.0 - bare) * nearT);
    g_col = mix(g_col, refF, vVeg.y * 0.85 * (1.0 - bare) * nearT);
  }
  float g_lum = dot(g_col, vec3(0.2126, 0.7152, 0.0722));
  float g_sat = (max(g_col.r, max(g_col.g, g_col.b)) - min(g_col.r, min(g_col.g, g_col.b))) / max(max(g_col.r, max(g_col.g, g_col.b)), 1e-3);
  // snow: what the satellite saw white, plus high gentle ground above the site's snow line (season.js adds winter)
  snowT = smoothstep(0.38, 0.6, g_lum) * (1.0 - smoothstep(0.12, 0.3, g_sat));
  snowT = max(snowT, smoothstep(uSnowY, uSnowY + 300.0, vW.y) * smoothstep(0.72, 0.9, N0.y) * smoothstep(0.12, 0.3, g_lum));
  // rock where the real slope passes ~35 degrees: the local colour, greyed and lightened, with strata across the face
  rockT = smoothstep(0.84, 0.74, N0.y) * (1.0 - snowT) * (1.0 - 0.75 * max(vVeg.x, vVeg.y));   // grass and trees hold on steep ground too
  float g_green = clamp((g_col.g - max(g_col.r, g_col.b)) / max(g_lum, 0.02) * 2.5, 0.0, 1.0);
  float g_fine = 1.0 - smoothstep(30.0, 320.0, g_dist), g_mid = 1.0 - smoothstep(200.0, 2600.0, g_dist);
#ifndef DIO_FAR
  vec3 g_w3 = pow(abs(N0), vec3(4.0)); g_w3 /= dot(g_w3, vec3(1.0));
  if (g_mid > 0.0) {
    // triplanar on steep faces: the top-down albedo stretches there, the strata and cracks do not
    float strata = g_w3.x * fbm(vW.zy * vec2(0.09, 0.45)) + g_w3.z * fbm(vW.xy * vec2(0.09, 0.45)) + g_w3.y * fbm(vW.xz * 0.12);
    vec3 rock = vec3(g_lum) * vec3(1.06, 1.0, 0.92) * 1.25 + 0.03;
    g_col = mix(g_col, rock * (0.72 + 0.56 * strata), rockT * (0.35 + 0.35 * g_mid));
    float scree = smoothstep(0.93, 0.84, N0.y) * (1.0 - g_green) * (1.0 - snowT) * (1.0 - rockT);
    g_col *= 1.0 + g_mid * ((0.22 + 0.16 * g_fine) * (fbm(vW.xz * 0.07 + 11.0) - 0.5) + scree * 0.25 * (tn(vW.xz * 0.9) - 0.5));
  }
  if (g_fine > 0.0) {                           // what you see from the jeep: tufts, bare patches, stones
    float tuft = tn(vW.xz * 1.3) * 0.5 + tn(ROT * vW.xz * 3.9) * 0.3 + tn(vW.xz * 0.37 + 5.0) * 0.2;
    vec3 grassy = g_col * mix(vec3(0.74, 0.86, 0.62), vec3(1.2, 1.14, 0.84), tuft);
    g_col = mix(g_col, grassy, g_fine * g_green * (1.0 - rockT));
    float stones = smoothstep(0.86, 0.93, tn(ROT * vW.xz * 3.1)) * (1.0 - g_green) * (1.0 - snowT) * (1.0 - max(vVeg.x, vVeg.y));
    g_col = mix(g_col, vec3(g_lum * 1.3 + 0.03), g_fine * stones * 0.3);
    g_col *= 1.0 + g_fine * 0.16 * (tn(vW.xz * 6.1) - 0.5);
  }
  dN = vec3(0.0);
  // detail normal: hummocks (~9 m) out to a few km, tufts and ruts (~2 m) close up; triplanar strata on rock faces
  if (g_mid > 0.0) {
    vec3 hm = bump2(vW.xz * 0.11) * 0.11, tf = bump2(ROT * vW.xz * 0.45) * 0.45;
    vec2 gxz = hm.yz * 0.55 * g_mid + (tf.yz * ROT) * 0.16 * g_fine;
    dN = vec3(gxz.x, 0.0, gxz.y) * g_w3.y * (1.0 - 0.7 * snowT);
    if (rockT > 0.01) {
      vec3 bx = bump2(vW.zy * vec2(0.12, 0.5)), bz = bump2(vW.xy * vec2(0.12, 0.5));
      dN += (vec3(0.0, bx.z * 0.5, bx.y * 0.12) * g_w3.x + vec3(bz.y * 0.12, bz.z * 0.5, 0.0) * g_w3.z) * rockT * 0.35 * g_mid;
    }
  }
#else
  dN = vec3(0.0);
#endif
  g_col = mix(g_col, vec3(0.84, 0.87, 0.93) * (0.94 + 0.08 * tn(vW.xz * 0.05)), snowT * 0.85);
  diffuseColor.rgb = g_col;`;

// Ground colours sampled from the sites' Commons photos (sunlit pixels where G > R and G > B; data/shots/wave2/terrain/
// photo_samples.json): meadow from Mahodand 2015 and three Kalam photos, sRGB (100, 117, 57); forest from the least hazy
// stand, "Swat kalam 16" at Mahodand, sRGB (60, 71, 55). Scaled to a material colour that renders back to about them.
// Saturation is raised 1.2x around the luminance: tone mapping and haze take that much back on screen.
const refColour = (rgb) => { const c = rgb.map((v) => lin(v) * 1.15), y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return new THREE.Color().setRGB(...c.map((v) => Math.max(0, y + (v - y) * 1.2))); };
const REF = { meadow: refColour([100, 117, 57]), forest: refColour([60, 71, 55]) };

function terrainMaterial({ hole = null } = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const uni = { uAlb: { value: null }, uAlbOn: { value: 0 }, uAlbO: { value: new THREE.Vector2() }, uAlbP: { value: 5 },
    uAlbN: { value: new THREE.Vector2(1, 1) }, uSnowY: { value: snowY },
    uRefM: { value: REF.meadow }, uRefF: { value: REF.forest }, uMeanM: { value: 0.1 }, uMeanF: { value: 0.06 } };
  m.userData.uni = uni;
  m.customProgramCacheKey = () => (hole ? "dio-far2" : "dio-near2");   // same source, different closure: keep the programs apart
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vW; varying vec3 vNt; attribute vec2 aVeg; varying vec2 vVeg;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz; vNt = mat3(modelMatrix) * objectNormal; vVeg = aVeg;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\n${hole ? "#define DIO_FAR" : ""}\n${DETAIL}\n${BUMP}
varying vec3 vNt; varying vec2 vVeg; uniform sampler2D uAlb; uniform float uAlbOn, uAlbP, uSnowY, uMeanM, uMeanF; uniform vec2 uAlbO, uAlbN; uniform vec3 uRefM, uRefF;`)
      .replace("#include <color_fragment>", `#include <color_fragment>
  ${hole ? `if (abs(vW.x) < ${hole[0].toFixed(1)} && abs(vW.z) < ${hole[1].toFixed(1)}) discard;` : ""}
  float snowT, rockT; vec3 dN;
  ${GROUND}`)
      // after season.js's terms: winter snow at a snow-like 0.75, so the sun still models it instead of blowing it out
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.72, max(snowT, uWinter));\n  diffuseColor.rgb *= 1.0 - 0.2 * uWinter;")
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
  normal = normalize((viewMatrix * vec4(normalize(N0 - dN), 0.0)).xyz);`);
  };
  return m;
}

// ---- real ground colour: web/data/diorama/<site>/albedo.webp (near, 5 m/px) and albedo_far.webp (far ring, 30 m/px)
export const ALBEDO_SOURCE = { name: "Sentinel-2 cloudless 2016 by EOX IT Services GmbH", use: "ground colour (via the Atlas pack)",
  licence: "CC BY 4.0, contains modified Copernicus Sentinel data 2016", url: "https://s2maps.eu" };
const albedoCache = new Map();
/** Both albedo images for a site, or null when the files are missing. Credits EOX in meta.sources (and the About list). */
export function albedo(site) {
  const key = site.meta.site;
  if (!albedoCache.has(key)) {
    const dir = new URL(`data/diorama/${key}/`, location.href).href;
    const img = (f) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = dir + f; });
    albedoCache.set(key, Promise.all([img("albedo.webp"), img("albedo_far.webp")]).then(([near, far]) => {
      const src = site.meta.sources;
      if (src && !src.some((s) => s.url === ALBEDO_SOURCE.url)) {
        src.push(ALBEDO_SOURCE);
        const ul = document.getElementById("about-sources");      // already drawn by hud.facts: add the line
        if (ul?.childElementCount) {
          const li = document.createElement("li"), a = document.createElement("a"), sp = document.createElement("span");
          a.href = ALBEDO_SOURCE.url; a.target = "_blank"; a.rel = "noopener"; a.textContent = ALBEDO_SOURCE.name;
          sp.textContent = ALBEDO_SOURCE.licence;
          li.append(a, `: ${ALBEDO_SOURCE.use}. `, sp); ul.append(li);
        }
      }
      // mean albedo luminance of the meadow and forest cells: the reference for "lighter or darker than usual"
      const g = site.meta.grid, cv = document.createElement("canvas"); cv.width = g.cols; cv.height = g.rows;
      const cx = cv.getContext("2d", { willReadFrequently: true }); cx.drawImage(near, 0, 0, g.cols, g.rows);
      const px = cx.getImageData(0, 0, g.cols, g.rows).data, sum = [0, 0], n = [0, 0];
      for (let i = 0; i < site.C.length; i++) {
        const c = site.C[i], k = c === 1 ? 1 : c === 2 || c === 6 || c === 7 ? 0 : -1;
        if (k < 0) continue;
        sum[k] += 0.2126 * lin(px[i * 4]) + 0.7152 * lin(px[i * 4 + 1]) + 0.0722 * lin(px[i * 4 + 2]); n[k]++;
      }
      const means = [n[0] ? sum[0] / n[0] : 0.1, n[1] ? sum[1] / n[1] : 0.06];
      return { near, far, means };
    }, () => null));
  }
  return albedoCache.get(key);
}

function texFrom(img) {
  const t = new THREE.Texture(img);
  t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
  return t;
}
function useAlbedo(mesh, site, which, x0, z0, px) {
  albedo(site).then((a) => {
    if (!a) return;
    const u = mesh.material.userData.uni, img = a[which];
    u.uAlb.value = texFrom(img); u.uAlbO.value.set(x0, z0); u.uAlbP.value = px; u.uAlbN.value.set(img.width, img.height);
    u.uMeanM.value = Math.max(a.means[0], 0.01); u.uMeanF.value = Math.max(a.means[1], 0.01); u.uAlbOn.value = 1;
  });
}

function gridGeometry(cols, rows, cell, x0, z0, heights, covers, yOff = 0) {
  const n = cols * rows, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), veg = new Uint8Array(n * 2);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, h = heights[i];
    pos[i * 3] = x0 + c * cell; pos[i * 3 + 1] = h + yOff; pos[i * 3 + 2] = z0 + r * cell;
    const hx = heights[r * cols + Math.min(c + 1, cols - 1)] - heights[r * cols + Math.max(c - 1, 0)];
    const hz = heights[Math.min(r + 1, rows - 1) * cols + c] - heights[Math.max(r - 1, 0) * cols + c];
    colourAt(covers[i], h, Math.hypot(hx, hz) / (2 * cell), col, i * 3);
    const cv = covers[i];                                   // WorldCover: meadow (grass, moss, shrub) and forest, for the grade
    veg[i * 2] = cv === 2 || cv === 6 || cv === 7 ? 255 : 0; veg[i * 2 + 1] = cv === 1 ? 255 : 0;
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
  geo.setAttribute("aVeg", new THREE.BufferAttribute(veg, 2, true));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  return geo;
}

export function nearTerrain(site) {
  snowY = Math.max(1550, 3400 - site.Y0);
  const g = site.meta.grid;
  const mesh = new THREE.Mesh(gridGeometry(g.cols, g.rows, g.cell, site.x0, site.z0, site.H, site.C), seasonize(terrainMaterial(), "ground"));
  mesh.receiveShadow = true; mesh.castShadow = true;
  useAlbedo(mesh, site, "near", site.x0, site.z0, g.cell / 2);
  return mesh;
}

export function farTerrain(site) {
  snowY = Math.max(1550, 3400 - site.Y0);
  const f = site.meta.far, g = site.meta.grid;
  const mesh = new THREE.Mesh(gridGeometry(f.cols, f.rows, f.cell, f.x0, f.z0, site.FH, site.FC, -2),
    seasonize(terrainMaterial({ hole: [g.width / 2 - 4, g.height / 2 - 4] }), "ground"));
  mesh.receiveShadow = false;
  useAlbedo(mesh, site, "far", f.x0, f.z0, f.cell / 2);
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
