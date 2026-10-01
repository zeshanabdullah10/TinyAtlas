import * as THREE from "three";

// Real sunlight on the miniature. The painted textures carry a baked "studio" hillshade from the northwest
// (az 315, alt 42: paint.py), so relighting divides that light out and multiplies the real sun in.
// Normals and shadows use the true-scale terrain, so the light stays physically right whatever the vertical scale.

const rad = (d) => (d * Math.PI) / 180;
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Unit vector towards the sun in world space (x east, y up, z south). */
export function sunDir(az, alt) {
  const a = rad(az), e = rad(alt);
  return new THREE.Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a));
}
export const STUDIO = sunDir(315, 42);

/** Light colours for a sun `alt` degrees up: warm and low at golden hour, blue at dusk, dim at night. */
export function sunColors(alt) {
  const day = smoothstep(-8, 3, alt), white = smoothstep(3, 28, alt), up = smoothstep(-1.5, 2.5, alt);
  const direct = new THREE.Color(1.0, 0.6, 0.34).lerp(new THREE.Color(1.0, 0.97, 0.92), white).multiplyScalar(0.72 * up);
  const amb = new THREE.Color(0.13, 0.16, 0.27).lerp(new THREE.Color(0.47, 0.5, 0.56), day);
  if (alt > -8 && alt < 6) amb.lerp(new THREE.Color(0.42, 0.36, 0.44), 0.35 * (1 - Math.abs(alt + 1) / 7));   // twilight glow
  return { direct, amb, day };
}

export class LightMap {
  /** hm: Float32Array rows*cols of metres (row 0 = north); widthM/heightM: map size. Works at half resolution. */
  constructor(hm, rows, cols, widthM, heightM, step = 2) {
    this.R = Math.ceil(rows / step); this.C = Math.ceil(cols / step);
    const R = this.R, C = this.C;
    this.h = new Float32Array(R * C);
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) this.h[r * C + c] = hm[Math.min(rows - 1, r * step) * cols + Math.min(cols - 1, c * step)];
    this.dx = widthM / (C - 1); this.dz = heightM / (R - 1);
    this.max = this.h.reduce((m, v) => Math.max(m, v), -Infinity);
    this.data = new Uint8Array(R * C * 4);
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {         // normals from central differences
      const g = (rr, cc) => this.h[Math.min(R - 1, Math.max(0, rr)) * C + Math.min(C - 1, Math.max(0, cc))];
      const hx = (g(r, c + 1) - g(r, c - 1)) / (2 * this.dx), hz = (g(r + 1, c) - g(r - 1, c)) / (2 * this.dz);
      const n = new THREE.Vector3(-hx, 1, -hz).normalize(), o = this.idx(r, c);
      this.data[o] = (n.x * 0.5 + 0.5) * 255; this.data[o + 1] = (n.y * 0.5 + 0.5) * 255; this.data[o + 2] = (n.z * 0.5 + 0.5) * 255; this.data[o + 3] = 255;
    }
    this.texture = new THREE.DataTexture(this.data, C, R, THREE.RGBAFormat);
    this.texture.magFilter = this.texture.minFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
  }
  /** Texture row 0 is the bottom of the image (south): flip so the map's north stays at the top. */
  idx(r, c) { return ((this.R - 1 - r) * this.C + c) * 4; }

  /** Cast shadows for a sun at (az, alt): march from each cell towards the sun until the ray clears the relief. */
  shade(az, alt) {
    const { R, C, h } = this;
    if (alt <= 0) { for (let i = 3; i < this.data.length; i += 4) this.data[i] = 0; this.texture.needsUpdate = true; return; }
    const tanA = Math.tan(rad(alt)), a = rad(az);
    const stepM = Math.min(this.dx, this.dz);
    const sc = (Math.sin(a) * stepM) / this.dx, sr = (-Math.cos(a) * stepM) / this.dz, rise = tanA * stepM;
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const h0 = h[r * C + c] + 2;
      let lit = 255, y = h0, fr = r, fc = c;
      for (let k = 1; y < this.max; k++) {
        fr += sr; fc += sc; y += rise;
        const ir = Math.round(fr), ic = Math.round(fc);
        if (ir < 0 || ir >= R || ic < 0 || ic >= C) break;          // the relief beyond the map casts nothing
        const t = h[ir * C + ic] - y;
        if (t > 0) { lit = k < 3 ? 110 : 0; break; }               // a soft edge right at the ridge line
      }
      this.data[this.idx(r, c) + 3] = lit;
    }
    this.texture.needsUpdate = true;
  }
}

/** The terrain's material: the painted texture, relit when `uReal` is 1 (0 shows the studio texture untouched). */
export function terrainMaterial(map, lightMap) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map }, uHasMap: { value: map ? 1 : 0 }, nsh: { value: lightMap.texture }, uReal: { value: 0 },
      uSun: { value: STUDIO.clone() }, uStudio: { value: STUDIO.clone() },
      uDirect: { value: new THREE.Color(1, 1, 1) }, uAmb: { value: new THREE.Color(0.5, 0.5, 0.5) },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D map; uniform sampler2D nsh; uniform float uHasMap, uReal;
      uniform vec3 uSun, uStudio, uDirect, uAmb;
      varying vec2 vUv;
      void main() {
        vec4 base = uHasMap > 0.5 ? texture2D(map, vUv) : vec4(0.6, 0.52, 0.36, 1.0);
        if (uReal > 0.0) {
          vec4 ns = texture2D(nsh, vUv);
          vec3 n = normalize(ns.rgb * 2.0 - 1.0);
          float studio = 0.5 + 0.7 * clamp(dot(n, uStudio), 0.0, 1.0);      // the light paint.py baked in
          vec3 lit = uAmb + uDirect * max(dot(n, uSun), 0.0) * ns.a;
          vec3 c = pow(base.rgb, vec3(1.0 / 2.2)) / studio * lit;           // the bake happened in display space
          base.rgb = mix(base.rgb, pow(clamp(c, 0.0, 1.0), vec3(2.2)), uReal);
        }
        gl_FragColor = base;
        #include <colorspace_fragment>
      }`,
  });
}
