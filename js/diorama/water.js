// The lake (outline from ESA WorldCover, level from the DEM) and the OSM streams as flowing ribbons.
import * as THREE from "three";

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

function lakeMaterial(maskTex, grid) {
  const m = new THREE.MeshStandardMaterial({ color: 0x1d6f74, roughness: 0.08, metalness: 0, transparent: true });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, waterUniforms, { uMask: { value: maskTex } });
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vW;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vW; uniform sampler2D uMask; uniform float uTime; uniform vec3 uSky, uSun;
${WAVES}
float lakeMask(vec2 xz) { return texture2D(uMask, vec2((xz.x + ${(grid.width / 2).toFixed(1)}) / ${grid.cell.toFixed(1)} + 0.5, (xz.y + ${(grid.height / 2).toFixed(1)}) / ${grid.cell.toFixed(1)} + 0.5) / vec2(${grid.cols}.0, ${grid.rows}.0)).r; }`)
      .replace("#include <color_fragment>", `#include <color_fragment>
  float mk = lakeMask(vW.xz) + (wn(vW.xz / 6.0).x - 0.5) * 0.12;
  if (mk < 0.5) discard;
  float shore = 1.0 - smoothstep(0.5, 0.8, mk);
  diffuseColor.rgb = mix(vec3(0.03, 0.26, 0.27), vec3(0.2, 0.55, 0.47), shore * 0.9);
  diffuseColor.a = 0.9 + 0.1 * (1.0 - shore);`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
  vec2 wg = waveGrad(vW.xz, uTime);
  vec3 nW = normalize(vec3(-wg.x, 1.0, -wg.y));
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);`)
      .replace("#include <opaque_fragment>", `
  vec3 V = normalize(cameraPosition - vW);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(V, nW), 0.0), 5.0);
  vec3 R = reflect(-V, nW);
  vec3 sky = mix(uSky, uSky * vec3(0.55, 0.7, 1.0), clamp(R.y * 1.6, 0.0, 1.0)) * vec3(0.85, 0.95, 0.95);
  outgoingLight = mix(outgoingLight, sky, fres * 0.55);
  float foam = smoothstep(0.62, 0.5, mk) * (0.55 + 0.45 * sin(uTime * 1.3 + wn(vW.xz / 3.0).x * 9.0));
  outgoingLight = mix(outgoingLight, vec3(0.92, 0.9, 0.84), foam * 0.6);
  #include <opaque_fragment>`);
  };
  return m;
}

export function lake(site) {
  const g = site.meta.grid, C = site.C;
  const mask = new Uint8Array(g.cols * g.rows);
  let minC = 1e9, maxC = -1, minR = 1e9, maxR = -1;
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    if (C[r * g.cols + c] !== 5) continue;
    mask[r * g.cols + c] = 255;
    minC = Math.min(minC, c); maxC = Math.max(maxC, c); minR = Math.min(minR, r); maxR = Math.max(maxR, r);
  }
  for (let pass = 0; pass < 2; pass++) {              // soften the 10 m pixel steps of the WorldCover outline
    const src = mask.slice();
    for (let r = 1; r < g.rows - 1; r++) for (let c = 1; c < g.cols - 1; c++) {
      let t = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) t += src[(r + dr) * g.cols + c + dc];
      mask[r * g.cols + c] = t / 9;
    }
  }
  const tex = new THREE.DataTexture(mask, g.cols, g.rows, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  const x0 = site.x0 + (minC - 3) * g.cell, x1 = site.x0 + (maxC + 3) * g.cell;
  const z0 = site.z0 + (minR - 3) * g.cell, z1 = site.z0 + (maxR + 3) * g.cell;
  const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 1, 1).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, lakeMaterial(tex, g));
  mesh.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  mesh.userData.box = { x0, x1, z0, z1 };
  return mesh;
}

function streamMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x5fa8a4, roughness: 0.2, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, waterUniforms);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 aFlow; varying vec2 vFlow;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFlow = aFlow;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec2 vFlow; uniform float uTime;\n${WAVES}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
  float a = abs(vFlow.x);
  float streak = wn(vec2(vFlow.x * 1.7, vFlow.y * 0.11 - uTime * 0.9)).x * 0.6 + wn(vec2(vFlow.x * 4.0, vFlow.y * 0.5 - uTime * 2.2)).x * 0.4;
  float white = smoothstep(0.58, 0.85, streak) * 0.55;
  diffuseColor.rgb = mix(vec3(0.24, 0.5, 0.5), vec3(0.88, 0.94, 0.92), white);
  diffuseColor.a = 1.0 - smoothstep(0.55, 1.0, a);`);
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
      const n = r.length, pos = new Float32Array(n * 3 * 3), flow = new Float32Array(n * 3 * 2);
      let s = 0;
      for (let i = 0; i < n; i++) {
        const a = r[Math.max(i - 1, 0)], b = r[Math.min(i + 1, n - 1)];
        const dx = b[0] - a[0], dz = b[1] - a[1], d = Math.hypot(dx, dz) || 1;
        if (i) s += Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]);
        for (let j = 0; j < 3; j++) {
          const l = (j - 1) * half, x = r[i][0] - (dz / d) * l, z = r[i][1] + (dx / d) * l, k = i * 3 + j;
          pos.set([x, site.heightAt(x, z) + 0.9, z], k * 3);
          flow.set([j - 1, s], k * 2);
        }
      }
      const idx = [];
      for (let i = 0; i < n - 1; i++) for (let j = 0; j < 2; j++) { const a = i * 3 + j; idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("aFlow", new THREE.BufferAttribute(flow, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 2;
      group.add(mesh);
    }
  }
  return group;
}
