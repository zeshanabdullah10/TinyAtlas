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
uniform float uExag, uDetail, uHasTile, uTexPx, uHmin, uClose;
${NOISE}

vec3 gradeAlbedo(vec3 a, float alt) {          // poster grade: ochre rock, deep blue-green forest, cool bright snow
  float mx = max(a.r, max(a.g, a.b)), mn = min(a.r, min(a.g, a.b));
  float lum = dot(a, vec3(0.299, 0.587, 0.114)), sat = (mx - mn) / (mx + 1e-3);
  float snow = smoothstep(0.30, 0.55, lum) * (1.0 - smoothstep(0.10, 0.30, sat));
  float forest = smoothstep(0.72, 1.0, a.g / (a.r + 0.002)) * (1.0 - snow);
  float meadow = (1.0 - snow) * (1.0 - forest) * (1.0 - smoothstep(2900.0, 3700.0, alt));
  float rock = (1.0 - snow) * (1.0 - forest) * (1.0 - meadow);
  vec3 grass = lum * 1.45 * vec3(0.92, 1.38, 0.52);
  vec3 ochre = pow(lum * 1.7, 0.85) * vec3(1.8, 0.82, 0.36);
  vec3 pine = a * vec3(0.45, 0.72, 0.62) * 0.7;
  vec3 ice = mix(a, vec3(lum) * vec3(0.93, 0.98, 1.08), 0.6) * 1.1;
  ochre = mix(a * vec3(1.0, 1.0, 0.9) * 1.25, ochre, smoothstep(0.04, 0.16, lum));   // keep the original hue in dark ground (fields, shade)
  return ochre * rock + pine * forest + ice * snow + grass * meadow;
}`)
      .replace("#include <map_fragment>", `
  vec2 guv = (vWPos.xz * uGridUV.x + uGridUV.y) / uGridUV.zw;
  vec4 G = texture2D(uGrad, guv);
  float camD = length(cameraPosition - vWPos);
  float fadeD = (1.0 - smoothstep(500.0, 3500.0, camD)) * uDetail;
  vec2 dn = vec2(0.0); float dvar = 0.0;
  if (fadeD > 0.0) {
    vec3 n1 = noised(vWPos.xz / 5.0), n2 = noised(vWPos.xz / 19.0 + 17.0);
    dn = fadeD * (n1.yz * (0.9 / 5.0) + n2.yz * (3.2 / 19.0));
    dvar = fadeD * ((n1.x - 0.5) * 0.10 + (n2.x - 0.5) * 0.10);
  }
  vec3 tN = normalize(vec3(-(G.x * uExag) - dn.x, 1.0, -(G.y * uExag) - dn.y));
  vec2 tuv = (vWPos.xz - uTile.xy) / uTile.zw;
  tuv = (clamp(tuv, 0.0, 1.0) * (uTexPx - 1.0) + 0.5) / uTexPx;
  vec3 albT = texture2D(uAlb, tuv).rgb, albO = texture2D(uOv, vWPos.xz / uGridSize).rgb;
  vec3 alb = mix(albO, albT, uHasTile);
  float conc = smoothstep(0.02, 0.45, G.z), conv = smoothstep(0.02, 0.4, -G.z);
  float steep = 1.0 - smoothstep(0.35, 0.8, tN.y);
  float aoT = 1.0 - 0.45 * conc * (0.5 + steep) + 0.10 * conv;
  diffuseColor.rgb = alb * aoT * (1.0 + dvar);
  float hLit = texture2D(uShadow, guv).r;`)
      .replace("#include <normal_fragment_begin>", `
  float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
  vec3 normal = normalize((viewMatrix * vec4(tN, 0.0)).xyz);
  vec3 nonPerturbedNormal = normal;`)
      .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
  {
    vec3 lit0 = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
    reflectedLight.directDiffuse *= hLit; reflectedLight.directSpecular *= hLit;
    float flo = mix(0.45, 0.66, uClose);                              // close views: shade keeps more of its lit luminance
    float def = max(0.0, flo * dot(lit0, vec3(0.299, 0.587, 0.114)) - dot(reflectedLight.directDiffuse + reflectedLight.indirectDiffuse, vec3(0.299, 0.587, 0.114)));
    vec3 chroma = diffuseColor.rgb / max(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)), 0.01);   // keep the ground's own saturation in the lift
    vec3 tealC = mix(chroma * vec3(0.70, 1.0, 1.45), vec3(0.45, 1.0, 1.45), 0.25); tealC /= dot(tealC, vec3(0.299, 0.587, 0.114));
    reflectedLight.indirectDiffuse += def * mix(vec3(0.92, 1.03, 1.1), tealC, uClose);   // sky-tinted; close: albedo chroma shifted toward teal-blue
    float ndl = dot(tN, uSunDir), away = 1.0 - smoothstep(0.0, 0.3, ndl);
    reflectedLight.indirectDiffuse += uClose * 0.12 * max(1.0 - hLit, away) * diffuseColor.rgb * vec3(0.7, 1.0, 1.25);   // albedo-keyed teal fill in cast shadow and on sun-averted slopes
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
