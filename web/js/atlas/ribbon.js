// Ribbons draped on the terrain (rivers, roads, routes): geometry builder and the shared ribbon shader.
// Width is widened in the vertex shader with distance (legibility), within a clamp and a pixel floor.
import * as THREE from "three";
import { shared, NOISE, LIFT_GLSL } from "./material.js";

/** Display-space turquoise from the posters, with a sky-tinted Fresnel sheen and a sun glint. */
export const WATER_GLSL = /* glsl */ `
uniform vec3 uSkyCol, uSunCol, uSunDir; uniform float uTime;
${NOISE}
vec3 waterShade(float shore, vec3 wp, float lit) {
  vec3 deep = vec3(0.01, 0.28, 0.32), shallow = vec3(0.10, 0.55, 0.55);
  vec3 col = mix(deep, shallow, clamp(shore, 0.0, 1.0));
  vec3 V = normalize(cameraPosition - wp);
  float d = length(cameraPosition - wp), fade = 1.0 - smoothstep(1500.0, 9000.0, d);
  vec3 n1 = noised(wp.xz / 7.0 + vec2(uTime * 0.12, uTime * 0.05)), n2 = noised(wp.xz / 23.0 - vec2(uTime * 0.04, 0.0));
  vec3 N = normalize(vec3((n1.y * 0.5 + n2.y * 1.5) * 0.12 * fade, 1.0, (n1.z * 0.5 + n2.z * 1.5) * 0.12 * fade));
  float F = 0.04 + 0.7 * pow(1.0 - max(dot(V, N), 0.0), 4.0);
  col = mix(col, uSkyCol * 0.92, F);
  vec3 R = reflect(-uSunDir, N);
  col += uSunCol * pow(max(dot(R, V), 0.0), 160.0) * 0.8 * lit;
  return col * (0.72 + 0.28 * lit);
}`;

export const PALETTE = {
  paved: [0.86, 0.76, 0.58], jeep: [0.74, 0.60, 0.42], track: [0.66, 0.54, 0.38], path: [0.80, 0.70, 0.52], route: [0.84, 0.24, 0.16],
};

/** Resample a polyline to <= maxSeg metre segments and build ribbon attributes draped on the ground. */
export function buildRibbon(pack, items, maxSeg = 45) {
  const P = [], perp = [], side = [], along = [], idx = [], half = [];
  for (const { pts, half: hw } of items) {
    if (!pts || pts.length < 2) continue;
    const s = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(d / maxSeg);
      for (let k = 1; k <= n; k++) s.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    const base = P.length / 3;
    let dist = 0;
    for (let i = 0; i < s.length; i++) {
      const a = s[Math.max(0, i - 1)], b = s[Math.min(s.length - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      if (i) dist += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
      const y = pack.groundY(s[i][0], s[i][1]);
      for (const sd of [-1, 1]) { P.push(s[i][0], y, s[i][1]); perp.push(-tz, tx); side.push(sd); along.push(dist); half.push(hw); }
      if (i) { const q = base + (i - 1) * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute("aPerp", new THREE.Float32BufferAttribute(perp, 2));
  g.setAttribute("aSide", new THREE.Float32BufferAttribute(side, 1));
  g.setAttribute("aAlong", new THREE.Float32BufferAttribute(along, 1));
  g.setAttribute("aHalf", new THREE.Float32BufferAttribute(half, 1));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(pack.W / 2, 2000, pack.H / 2), Math.max(pack.W, pack.H));
  return g;
}

/**
 * kind: "river" | "road". minPx: pixel floor for the full width.
 * color: display-space rgb (roads/routes).
 */
export function ribbonMaterial({ kind, minPx = 1, color = [1, 1, 1], maxK = 3, legibD = 4000, dash = 0, opacity = 1, maxD = 1e9 }) {
  const m = new THREE.ShaderMaterial({
    fog: true, transparent: opacity < 1, toneMapped: false, depthWrite: kind === "river",
    side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uMinPx: { value: minPx }, uMaxK: { value: maxK }, uLegibD: { value: legibD },
      uColor: { value: new THREE.Color().setRGB(...color, THREE.LinearSRGBColorSpace) }, uDash: { value: dash }, uOpacity: { value: opacity }, uMaxD: { value: maxD },
    }]),
    defines: { RIVER: kind === "river" ? 1 : 0 },
    vertexShader: /* glsl */ `
      attribute vec2 aPerp; attribute float aSide, aAlong, aHalf;
      uniform float uMinPx, uMaxK, uLegibD, uPx;
      varying float vSide, vAlong, vD; varying vec3 vWP;
      #include <fog_pars_vertex>
      ${LIFT_GLSL}
      void main() {
        vec4 mv0 = modelViewMatrix * vec4(position, 1.0);
        float d = length(mv0.xyz);
        float hw = max(aHalf * clamp(d / uLegibD, 1.0, uMaxK), uMinPx * uPx * d * 0.5);
        vec3 p = position + vec3(aPerp.x, 0.0, aPerp.y) * aSide * hw;
        vec4 mvPosition = liftToward(modelViewMatrix * vec4(p, 1.0));
        vSide = aSide; vAlong = aAlong; vD = d; vWP = p;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uDash, uPx, uOpacity, uMaxD; uniform sampler2D uShadow; uniform vec4 uGridUV;
      varying float vSide, vAlong, vD; varying vec3 vWP;
      #include <fog_pars_fragment>
      ${WATER_GLSL}
      void main() {
        float lit = 1.0;
        if (vD > uMaxD) discard;
        #if RIVER
          float s = abs(vSide);
          vec3 col = waterShade(pow(s, 2.2), vWP, lit);
          gl_FragColor = vec4(col, 1.0);
        #else
          if (uDash > 0.0) {
            float per = max(uDash, vD * uPx * 9.0);
            if (fract(vAlong / per) > 0.55) discard;
          }
          gl_FragColor = vec4(uColor * (0.8 + 0.2 * texture2D(uShadow, (vWP.xz * uGridUV.x + uGridUV.y) / uGridUV.zw).r), uOpacity);
        #endif
        #include <fog_fragment>
      }`,
  });
  for (const k of ["uPx", "uShadow", "uGridUV", "uSkyCol", "uSunCol", "uSunDir", "uTime"]) m.uniforms[k] = shared[k];   // shared by reference
  return m;
}
