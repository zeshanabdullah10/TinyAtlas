// Terrain and backdrop shaders (MeshStandardMaterial + onBeforeCompile), shared uniforms, and the haze curve.
import * as THREE from "three";

/** Uniforms shared by every terrain-aware material (terrain, water, roads, trees). */
export const shared = {
  uGrad: { value: null },            // half-float (dh/dx, dh/dz, curvature)
  uShadow: { value: null },          // R8 sun shadow term
  uOv: { value: null },              // overview albedo
  uGridUV: { value: new THREE.Vector4(1 / 30, 0.5, 1, 1) },   // 1/cellMetres, half-texel, cols, rows of the texture
  uGridSize: { value: new THREE.Vector2(1, 1) },              // near grid extent in metres
  uExag: { value: 1.6 },
  uDetail: { value: 1 },
  uHmin: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunCol: { value: new THREE.Color(1, 0.8, 0.6) },
  uSkyCol: { value: new THREE.Color(0.8, 0.85, 0.95) },
  uTime: { value: 0 },
  uClose: { value: 0 },              // 1 in close views (orbit distance <= ~9 km), 0 from ~20 km: gates the shade lift
  uPx: { value: 1 },                 // world metres per pixel at distance 1 (2 tan(fov/2) / height)
};

// Haze: display-space mix with the sky horizon colour. fogNear/fogFar are driven by sky.js (start/end of the ramp).
THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  float hz = clamp((vFogDepth - fogNear) / (fogFar - fogNear), 0.0, 1.0);
  float fogFactor = 0.94 * pow(hz, 0.9) + 0.05 * smoothstep(0.0, fogNear, vFogDepth);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif`;
THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor; varying float vFogDepth; uniform float fogNear; uniform float fogFar;
#endif`;

/** GLSL helper: view-ray offset toward the camera, so draped ribbons never sink into a coarser LOD mesh. */
export const LIFT_GLSL = /* glsl */ `
vec4 liftToward(vec4 mv) { float l = length(mv.xyz); float k = 3.0 + 0.007 * l; return vec4(mv.xyz * (1.0 - min(k / l, 0.5)), 1.0); }`;

export const NOISE = /* glsl */ `
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec3 noised(vec2 x) {
  vec2 p = floor(x), f = fract(x);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0), du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  float a = hash21(p), b = hash21(p + vec2(1, 0)), c = hash21(p + vec2(0, 1)), d = hash21(p + vec2(1, 1));
  return vec3(a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y, du * (vec2(b - a, c - a) + (a - b - c + d) * u.yx));
}`;

/** One material per chunk (own tile uniforms), all sharing one compiled program. */
export function makeTerrainMaterial() {
  const tile = {
    uAlb: { value: null }, uHasTile: { value: 0 }, uTexPx: { value: 384 }, uTile: { value: new THREE.Vector4() },
  };
  const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, side: THREE.DoubleSide });
  m.userData.tile = tile;
  m.customProgramCacheKey = () => "atlas-terrain";
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, shared, tile);
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vWPos;
uniform sampler2D uGrad, uShadow, uOv, uAlb; uniform vec4 uGridUV, uTile; uniform vec3 uSunDir; uniform vec2 uGridSize;
uniform float uExag, uDetail, uHasTile, uTexPx, uHmin, uClose, uPx;
${NOISE}
// two-octave rock noise on one projection plane; value + gradient in that plane's (u, v), metres
vec3 rk(vec2 p, mat2 A, mat2 B, vec2 w) {          // w: per-octave weights (fade by on-screen size)
  vec3 a = noised(A * p / 6.0), b = noised(B * p / 23.0 + 3.7);
  vec2 ga = (a.yz * A) / 6.0, gb = (b.yz * B) / 23.0;
  return vec3(mix(0.5, a.x, w.x) * 0.45 + mix(0.5, b.x, w.y) * 0.55, ga * (0.45 * w.x) + gb * (0.55 * w.y));
}`)
      .replace("#include <map_fragment>", `
  vec2 guv = (vWPos.xz * uGridUV.x + uGridUV.y) / uGridUV.zw;
  vec4 G = texture2D(uGrad, guv);
  float camD = length(cameraPosition - vWPos);
  float slope = length(G.xy);                                        // tan of the REAL slope (30 m height field)
  vec3 mN = normalize(vec3(-G.x * uExag, 1.0, -G.y * uExag));        // macro normal (exaggerated, as drawn)
  float mpp = max(camD * uPx, 0.05);                                 // metres per pixel here
  float fadeD = 1.0 - smoothstep(3500.0, 9000.0, camD);              // close-range detail, all tiers; each octave also
  #define OCT(l) smoothstep(2.0, 5.0, (l) / mpp)                      // fades out once it is under ~3 px (no shimmer)
  float fadeM = 1.0 - smoothstep(1500.0, 7000.0, camD);              // mid-range: soft landcover edges, rock break-up
  // Landcover edges: two jittered taps of the albedo turn the 10 m texel staircase into an irregular, soft edge.
  vec2 wxz = vWPos.xz, j1 = vec2(0.0), j2 = vec2(0.0);
  if (fadeM > 0.0) {
    vec3 e1 = noised(wxz / 23.0 + 3.1), e2 = noised(wxz / 9.0 - 7.7);
    j1 = fadeM * (vec2(e1.x, e2.x) - 0.5) * 16.0;
    j2 = vec2(-j1.y, j1.x);
  }
  // On cliffs the planar 10 m albedo stretches over tall faces: read a blurrier mip there (detail comes back below).
  float cliff = smoothstep(0.62, 1.0, slope);                       // ~32 deg -> 45 deg real
  float bias = 2.4 * cliff * fadeM;
  vec2 tuv1 = (clamp((wxz + j1 - uTile.xy) / uTile.zw, 0.0, 1.0) * (uTexPx - 1.0) + 0.5) / uTexPx;
  vec2 tuv2 = (clamp((wxz + j2 - uTile.xy) / uTile.zw, 0.0, 1.0) * (uTexPx - 1.0) + 0.5) / uTexPx;
  vec3 albT = texture2D(uAlb, tuv1, bias).rgb;
  if (fadeM > 0.0) albT = 0.5 * (albT + texture2D(uAlb, tuv2, bias).rgb);   // second tap only where edges are seen up close
  vec3 albO = texture2D(uOv, (wxz + j1) / uGridSize).rgb;
  vec3 alb = mix(albO, albT, uHasTile);
  float aLum = dot(alb, vec3(0.299, 0.587, 0.114));
  float forest = smoothstep(1.12, 1.45, alb.g / max(alb.r, 1e-3)) * (1.0 - smoothstep(0.045, 0.10, aLum));
  // Wide views: forest canopy reads darker and cooler with a crown-scale mottle (the poster's dense conifers),
  // fading out where the instanced trees take over.
  float farF = smoothstep(7000.0, 15000.0, camD) * forest;
  if (farF > 0.0) {
    float amp = 1.0 - smoothstep(8.0, 24.0, mpp), crown = 0.5;
    if (amp > 0.0) crown = noised(wxz / 42.0).x * 0.6 + noised(wxz / 13.0 + 5.0).x * 0.4;   // sub-pixel at wide zoom: skip
    alb *= mix(vec3(1.0), vec3(0.74, 0.92, 1.06) * (0.84 + amp * 0.5 * (crown - 0.5)), farF);
  }
  vec2 dn = vec2(0.0); float dvar = 0.0; vec3 bump = vec3(0.0);
  if (fadeD > 0.0) {
    // fine colour variation (luminance + a slight warm/cool drift), isotropic so no bands (lesson 7)
    const mat2 RD = mat2(0.80, -0.60, 0.60, 0.80);
    vec3 n1 = noised(wxz / 4.0), n2 = noised(RD * wxz / 13.0 + 17.0), n3 = noised(wxz / 41.0 - 4.0), n4 = noised(RD * wxz / 130.0 + 9.0);
    float w1 = OCT(4.0), w2 = OCT(13.0), w3 = OCT(41.0), flat_ = 1.0 - cliff;
    dn = fadeD * flat_ * (w1 * n1.yz * (0.7 / 4.0) + w2 * (n2.yz * RD) * (2.2 / 13.0) + w3 * n3.yz * (3.5 / 41.0)) * mix(0.55, 1.0, uDetail);
    dvar = fadeD * (w1 * (n1.x - 0.5) * 0.08 + w2 * (n2.x - 0.5) * 0.11 + w3 * (n3.x - 0.5) * 0.12 + (n4.x - 0.5) * 0.12);
    n3 = n4;
    alb *= mix(vec3(1.0), mix(vec3(1.05, 1.0, 0.93), vec3(0.95, 1.0, 1.06), n3.x), 0.6 * fadeD * (1.0 - forest));
    // scree on steep (25-40 deg) non-forest slopes: pale speckle with dark gaps
    float scree = smoothstep(0.42, 0.7, slope) * (1.0 - cliff) * (1.0 - forest) * fadeD;
    scree *= OCT(2.5);
    if (scree > 0.0) { float sp = noised(wxz / 2.5 + 9.0).x; alb *= 1.0 + scree * (0.35 * smoothstep(0.55, 0.85, sp) - 0.18 * smoothstep(0.45, 0.15, sp)); }
  }
  float rockF = cliff * (1.0 - 0.7 * forest) * max(fadeM, 0.0);
  if (rockF > 0.0) {
    // triplanar rock: noise projected on the three axis planes (world y as drawn), blended by the macro normal, so
    // cliffs get crisp, unstretched detail; tone + a bump from the same noise
    vec3 tw = pow(abs(mN), vec3(4.0)); tw /= tw.x + tw.y + tw.z;
    // each plane's lattice is rotated (and the two octaves differently) so no axis-aligned grid shows through
    const mat2 R1 = mat2(0.80, -0.60, 0.60, 0.80), R2 = mat2(0.28, 0.96, -0.96, 0.28);
    vec2 wo = vec2(OCT(6.0), OCT(23.0));
    vec3 ax = rk(vWPos.zy, R1, R2, wo), ay = rk(vWPos.xz, R2, R1, wo), az = rk(vWPos.xy, R1, R2, wo);
    float r = ax.x * tw.x + ay.x * tw.y + az.x * tw.z;
    alb *= mix(1.0, 0.70 + 0.60 * r, rockF);                        // soft tone (value-noise lattice shows if contrast is pushed)
    bump = rockF * fadeD * 0.8 * (tw.x * vec3(0.0, ax.z, ax.y) + tw.y * vec3(ay.y, 0.0, ay.z) + tw.z * vec3(az.y, az.z, 0.0));
  }
  vec3 tN = normalize(vec3(-(G.x * uExag) - dn.x, 1.0, -(G.y * uExag) - dn.y));
  tN = normalize(tN - 5.0 * (bump - dot(bump, tN) * tN));
  float conc = smoothstep(0.02, 0.45, G.z), conv = smoothstep(0.02, 0.4, -G.z);
  float steep = 1.0 - smoothstep(0.35, 0.8, mN.y);
  float aoT = 1.0 - mix(0.45, 0.3, fadeM) * conc * (0.5 + steep) + 0.10 * conv;   // the 30 m curvature AO is too coarse to lean on up close
  diffuseColor.rgb = alb * aoT * (1.0 + dvar);
  float hLit = texture2D(uShadow, guv).r;`)
      .replace("#include <lights_fragment_begin>", THREE.ShaderChunk.lights_fragment_begin.replace(/\? getShadow\(/g, "? 0.42 + 0.58 * getShadow("))
      .replace("#include <normal_fragment_begin>", `
  float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
  vec3 normal = normalize((viewMatrix * vec4(tN, 0.0)).xyz);
  vec3 nonPerturbedNormal = normal;`)
      .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
  {
    vec3 lit0 = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
    reflectedLight.directDiffuse *= hLit; reflectedLight.directSpecular *= hLit;
    float flo = mix(0.45, 0.70, uClose);                              // close views: shade keeps more of its lit luminance
    float def = max(0.0, flo * dot(lit0, vec3(0.299, 0.587, 0.114)) - dot(reflectedLight.directDiffuse + reflectedLight.indirectDiffuse, vec3(0.299, 0.587, 0.114)));
    vec3 chroma = diffuseColor.rgb / max(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)), 0.01);   // keep the ground's own saturation in the lift
    vec3 tealC = mix(chroma * vec3(0.70, 1.0, 1.45), vec3(0.45, 1.0, 1.45), 0.25); tealC /= dot(tealC, vec3(0.299, 0.587, 0.114));
    reflectedLight.indirectDiffuse += def * mix(vec3(0.84, 1.02, 1.2), tealC, uClose);   // sky-tinted teal (poster shade); close: albedo chroma shifted toward teal-blue
    float ndl = dot(tN, uSunDir), away = 1.0 - smoothstep(0.0, 0.3, ndl);
    reflectedLight.indirectDiffuse += uClose * 0.12 * max(1.0 - hLit, away) * diffuseColor.rgb * vec3(0.7, 1.0, 1.25);   // albedo-keyed teal fill in cast shadow and on sun-averted slopes
    // close views look down on flat valley floors that a 15 deg sun barely lights: a gain brings them back toward the
    // baked albedo (the poster palette) without lifting the shade/lit ratio
    float gain = 1.0 + 0.32 * uClose;
    reflectedLight.directDiffuse *= gain; reflectedLight.indirectDiffuse *= gain;
  }`);
  };
  return m;
}

/** Backdrop: textured, lit by vertex normals, and discarded wherever the near grid exists. */
export function makeFarMaterial(map, nearRect) {
  const u = { uNear: { value: new THREE.Vector4(nearRect.o, nearRect.o, nearRect.w - 2 * nearRect.o, nearRect.h - 2 * nearRect.o) } };
  const m = new THREE.MeshStandardMaterial({ map, roughness: 1, metalness: 0 });
  m.customProgramCacheKey = () => "atlas-far";
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos; uniform vec4 uNear;")
      .replace("#include <map_fragment>", `#include <map_fragment>
  if (vWPos.x > uNear.x && vWPos.x < uNear.x + uNear.z && vWPos.z > uNear.y && vWPos.z < uNear.y + uNear.w) discard;`);
  };
  return m;
}
