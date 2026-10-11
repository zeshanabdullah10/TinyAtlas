// The lake (outline from ESA WorldCover, level from the DEM) and the OSM streams as flowing ribbons.
// The lake's colour is measured: the mean Sentinel-2 colour of its open water (albedo.webp), shallower and lighter
// toward the shore by the distance to it. Glacial lakes come out milky turquoise because the satellite saw them so.
import * as THREE from "three";
import { seasonU } from "./season.js";
import { albedo } from "./land.js";

export const waterUniforms = { uTime: { value: 0 }, uSky: { value: new THREE.Color(0.75, 0.8, 0.9) }, uSun: { value: new THREE.Vector3(0, 1, 0) } };

const WAVES = /* glsl */ `
float wh(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec3 wn(vec2 x) { vec2 p = floor(x), f = fract(x), u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
  float a = wh(p), b = wh(p + vec2(1, 0)), c = wh(p + vec2(0, 1)), d = wh(p + vec2(1, 1));
  return vec3(a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y, du * (vec2(b - a, c - a) + (a - b - c + d) * u.yx)); }
vec2 waveGrad(vec2 p, float t) {
  vec2 g = wn(p / 9.0 + vec2(t * 0.09, t * 0.05)).yz / 9.0 * 0.7;
  g += wn(p / 2.7 - vec2(t * 0.19, -t * 0.12)).yz / 2.7 * 0.22;
  g += wn(p / 0.9 + vec2(-t * 0.35, t * 0.3)).yz / 0.9 * 0.05;
  return g;
}`;

function lakeMaterial(maskTex, grid, uni) {
  const m = new THREE.MeshStandardMaterial({ color: 0x1d6f74, roughness: 0.06, metalness: 0, transparent: true });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, waterUniforms, seasonU, uni, { uMask: { value: maskTex } });
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vW;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vW; uniform sampler2D uMask; uniform float uTime, uWinter; uniform vec3 uSky, uSun, uDeep, uShallow;
${WAVES}
vec2 lakeMask(vec2 xz) { return texture2D(uMask, vec2((xz.x + ${(grid.width / 2).toFixed(1)}) / ${grid.cell.toFixed(1)} + 0.5, (xz.y + ${(grid.height / 2).toFixed(1)}) / ${grid.cell.toFixed(1)} + 0.5) / vec2(${grid.cols}.0, ${grid.rows}.0)).rg; }`)
      .replace("#include <color_fragment>", `#include <color_fragment>
  vec2 lm = lakeMask(vW.xz);
  float mk = lm.r + (wn(vW.xz / 6.0).x - 0.5) * 0.12;
  if (mk < 0.5) discard;
  float shore = 1.0 - smoothstep(0.5, 0.8, mk);
  float deep = smoothstep(0.0, 0.85, lm.g + (wn(vW.xz / 23.0).x - 0.5) * 0.15);   // distance to shore, broken up a little
  diffuseColor.rgb = mix(uShallow, uDeep, deep);
  diffuseColor.rgb = mix(diffuseColor.rgb, uShallow * vec3(1.1, 1.05, 0.9), shore * 0.4);  // the silty margin
  diffuseColor.a = mix(0.72, 0.97, smoothstep(0.0, 0.4, deep));
  vec3 ice = mix(vec3(0.78, 0.86, 0.9), vec3(0.93, 0.95, 0.97), wn(vW.xz / 14.0).x);
  diffuseColor.rgb = mix(diffuseColor.rgb, ice, uWinter);
  diffuseColor.a = mix(diffuseColor.a, 1.0, uWinter);`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
  // ripples flatten out with distance (as a mip of them would), so grazing views mirror the far shore, not the sky
  float wd = distance(vW, cameraPosition);
  vec2 wg = waveGrad(vW.xz, uTime) * (1.0 - uWinter * 0.97) * (0.55 + 0.45 * deep) * mix(1.0, 0.25, smoothstep(15.0, 250.0, wd));
  vec3 nW = normalize(vec3(-wg.x, 1.0, -wg.y));
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);`)
      .replace("#include <opaque_fragment>", `
  vec3 V = normalize(cameraPosition - vW);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(V, nW), 0.0), 5.0);
  vec3 R = reflect(-V, nW);
  vec3 sky = mix(uSky, uSky * vec3(0.55, 0.7, 1.0), clamp(R.y * 1.6, 0.0, 1.0)) * vec3(0.85, 0.95, 0.95);
  // low reflections hit the valley walls, not the sky: darker, greener, as in the photos from the shore
  vec3 walls = mix(uDeep, vec3(0.15, 0.17, 0.13), 0.6) + uSky * 0.1;
  vec3 refl = mix(walls, sky, smoothstep(0.06, 0.45, R.y));
  outgoingLight = mix(outgoingLight, refl, fres * 0.8 * (1.0 - uWinter * 0.6));
  float lap = sin(uTime * 1.1 + mk * 40.0 + wn(vW.xz / 4.0).x * 6.0);
  float foam = smoothstep(0.58, 0.51, mk + 0.02 * lap) * smoothstep(0.45, 0.8, wn(vW.xz / 1.3 + uTime * 0.05).x + 0.2);
  outgoingLight = mix(outgoingLight, vec3(0.85, 0.86, 0.82) * (0.5 + 0.5 * uSky), foam * 0.5 * (1.0 - uWinter));
  #include <opaque_fragment>`);
  };
  return m;
}

const lin = (v) => Math.pow(v / 255, 2.2);
/** Deep and shallow water colours. The satellite gives the HUE only (water absorbs, so its brightness says little):
 *  turquoise for glacial flour, dark green for peaty water. The brightness is set to read like the lakes' own photos
 *  (open water sRGB ~(98, 107, 94) at Mahodand, ~(77, 88, 94) at Pari, sampled from their Commons photos). */
function lakeColours(rgb, uni) {
  const L = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const t = rgb.map(lin), l = Math.max(L(t), 0.004);
  const hue = t.map((v) => 0.35 + 0.65 * Math.min(v / l, 2.2));            // unit-luminance hue, chroma tempered
  const k = L(hue);
  const deep = hue.map((v) => (v / k) * 0.16), shallow = hue.map((v, i) => (v / k) * 0.28 + [0.03, 0.028, 0.018][i]);
  uni.uDeep.value.setRGB(...deep); uni.uShallow.value.setRGB(...shallow);
}

export function lake(site) {
  const g = site.meta.grid, C = site.C;
  const mask = new Uint8Array(g.cols * g.rows * 2), dist = new Float32Array(g.cols * g.rows);
  let minC = 1e9, maxC = -1, minR = 1e9, maxR = -1;
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const i = r * g.cols + c;
    if (C[i] !== 5) continue;
    mask[i * 2] = 255; dist[i] = 1e9;
    minC = Math.min(minC, c); maxC = Math.max(maxC, c); minR = Math.min(minR, r); maxR = Math.max(maxR, r);
  }
  // distance to the shore in cells (two-pass chamfer 1 / 1.41), for the shallow-to-deep gradient
  const D = (r, c) => (r < 0 || c < 0 || r >= g.rows || c >= g.cols ? 0 : dist[r * g.cols + c]);
  for (let r = minR; r <= maxR; r++) for (let c = minC; c <= maxC; c++) {
    const i = r * g.cols + c; if (!dist[i]) continue;
    dist[i] = Math.min(dist[i], D(r - 1, c) + 1, D(r, c - 1) + 1, D(r - 1, c - 1) + 1.41, D(r - 1, c + 1) + 1.41);
  }
  let maxD = 0;
  for (let r = maxR; r >= minR; r--) for (let c = maxC; c >= minC; c--) {
    const i = r * g.cols + c; if (!dist[i]) continue;
    dist[i] = Math.min(dist[i], D(r + 1, c) + 1, D(r, c + 1) + 1, D(r + 1, c + 1) + 1.41, D(r + 1, c - 1) + 1.41);
    maxD = Math.max(maxD, dist[i]);
  }
  const span = Math.min(Math.max(maxD * 0.8, 3), 14);       // ~140 m of shelving at a big lake, less at a small one
  for (let i = 0; i < dist.length; i++) if (dist[i]) mask[i * 2 + 1] = Math.min(255, (dist[i] - 0.5) / span * 255);
  for (let pass = 0; pass < 2; pass++) {              // soften the 10 m pixel steps of the WorldCover outline
    const src = mask.slice();
    for (let r = 1; r < g.rows - 1; r++) for (let c = 1; c < g.cols - 1; c++) {
      let t = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) t += src[((r + dr) * g.cols + c + dc) * 2];
      mask[(r * g.cols + c) * 2] = t / 9;
    }
  }
  const tex = new THREE.DataTexture(mask, g.cols, g.rows, THREE.RGFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  const uni = { uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() } };
  lakeColours([30, 66, 64], uni);                     // until the albedo arrives: a dark mountain-lake green
  albedo(site).then((a) => {                          // the satellite's colour of the open water (cells >= 2 from shore)
    if (!a) return;
    const want = Math.min(2, maxD * 0.5);
    const x = minC * 2, y = minR * 2, w = (maxC - minC) * 2 + 1, h = (maxR - minR) * 2 + 1;
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const cx = cv.getContext("2d", { willReadFrequently: true }); cx.drawImage(a.near, x, y, w, h, 0, 0, w, h);
    const px = cx.getImageData(0, 0, w, h).data, sum = [0, 0, 0];
    let n = 0;
    for (let r = minR; r <= maxR; r++) for (let c = minC; c <= maxC; c++) {
      if (dist[r * g.cols + c] < want || !dist[r * g.cols + c]) continue;
      const k = ((r - minR) * 2 * w + (c - minC) * 2) * 4;
      sum[0] += px[k]; sum[1] += px[k + 1]; sum[2] += px[k + 2]; n++;
    }
    if (n > 3) lakeColours(sum.map((v) => v / n), uni);
  });
  const x0 = site.x0 + (minC - 3) * g.cell, x1 = site.x0 + (maxC + 3) * g.cell;
  const z0 = site.z0 + (minR - 3) * g.cell, z1 = site.z0 + (maxR + 3) * g.cell;
  const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 1, 1).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, lakeMaterial(tex, g, uni));
  mesh.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  mesh.userData.box = { x0, x1, z0, z1 };
  return mesh;
}

function streamMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x5fa8a4, roughness: 0.14, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, waterUniforms, seasonU);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 aFlow; varying vec3 vFlow;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFlow = aFlow;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vFlow; uniform float uTime, uWinter;\n${WAVES}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
  // vFlow: x across (-1 bank, 0 middle, 1 bank), y metres downstream, z how steep the bed is here (rapids)
  float a = abs(vFlow.x), steep = vFlow.z;
  float streak = wn(vec2(vFlow.x * 1.7, vFlow.y * 0.11 - uTime * 0.9)).x * 0.6 + wn(vec2(vFlow.x * 4.0, vFlow.y * 0.5 - uTime * 2.2)).x * 0.4;
  float churn = wn(vec2(vFlow.x * 6.0 + 3.0, vFlow.y * 0.9 - uTime * 3.4)).x;
  float white = smoothstep(0.62 - 0.25 * steep, 0.9 - 0.2 * steep, streak * 0.75 + churn * 0.25) * (0.35 + 0.65 * steep);
  white = max(white, smoothstep(0.62, 0.92, a) * (0.25 + 0.5 * churn));          // foam caught along the banks
  vec3 water = mix(vec3(0.045, 0.15, 0.16), vec3(0.1, 0.25, 0.24), smoothstep(0.2, 0.85, a));   // milky glacial melt
  diffuseColor.rgb = mix(water, vec3(0.7, 0.76, 0.74), clamp(white, 0.0, 0.8));
  diffuseColor.a = 1.0 - smoothstep(0.45, 1.0, a);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.9, 0.93), uWinter * 0.8);`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
  vec2 fg = wn(vec2(vFlow.x * 2.2, vFlow.y * 0.35 - uTime * 1.8)).yz * (0.25 + 0.35 * steep) * (1.0 - uWinter);
  normal = normalize(normal + (viewMatrix * vec4(fg.x, 0.0, fg.y, 0.0)).xyz);`);
  };
  return m;
}

export function streams(site) {
  const group = new THREE.Group(), mat = streamMaterial();
  for (const st of site.meta.streams) {
    const half = st.kind === "river" ? 4.5 : 1.6;
    const runs = [];
    let run = [];
    for (const p of st.pts) {
      if (site.coverAt(p[0], p[1]) === 5) { if (run.length > 1) runs.push(run); run = []; } else run.push(p);
    }
    if (run.length > 1) runs.push(run);
    for (const r of runs) {
      const n = r.length, pos = new Float32Array(n * 3 * 3), flow = new Float32Array(n * 3 * 3);
      let s = 0;
      const hs = r.map((p) => site.heightAt(p[0], p[1]));
      for (let i = 0; i < n; i++) {
        const a = r[Math.max(i - 1, 0)], b = r[Math.min(i + 1, n - 1)];
        const dx = b[0] - a[0], dz = b[1] - a[1], d = Math.hypot(dx, dz) || 1;
        if (i) s += Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]);
        const i0 = Math.max(i - 3, 0), i1 = Math.min(i + 3, n - 1);   // grade over ~6 points: 0 still, 1 at 25% and steeper
        let len = 0;
        for (let k = i0; k < i1; k++) len += Math.hypot(r[k + 1][0] - r[k][0], r[k + 1][1] - r[k][1]);
        const steep = Math.min(1, Math.max(0, (Math.abs(hs[i1] - hs[i0]) / (len || 1) - 0.03) / 0.22));
        for (let j = 0; j < 3; j++) {
          const l = (j - 1) * half, x = r[i][0] - (dz / d) * l, z = r[i][1] + (dx / d) * l, k = i * 3 + j;
          pos.set([x, site.heightAt(x, z) + 0.9, z], k * 3);
          flow.set([j - 1, s, steep], k * 3);
        }
      }
      const idx = [];
      for (let i = 0; i < n - 1; i++) for (let j = 0; j < 2; j++) { const a = i * 3 + j; idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("aFlow", new THREE.BufferAttribute(flow, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 2;
      group.add(mesh);
    }
  }
  return group;
}
