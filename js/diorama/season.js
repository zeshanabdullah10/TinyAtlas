// Seasons (illustrative): golden meadows in autumn, snow on every gentle surface and ice on the lake in winter,
// and dawn mist over the valley floor. One set of uniforms drives every material.
import * as THREE from "three";

export const seasonU = { uAutumn: { value: 0 }, uWinter: { value: 0 } };
export const SEASONS = [
  { name: "Summer", autumn: 0, winter: 0, note: "" },
  { name: "Autumn", autumn: 1, winter: 0, note: "Autumn colours are illustrative." },
  { name: "Winter", autumn: 0.35, winter: 1, note: "Snow and ice are illustrative. Check road conditions locally before travelling." },
];

const CODE = {
  ground: `
    float grassy = smoothstep(0.95, 1.3, diffuseColor.g / (diffuseColor.r + 0.01));
    vec3 gold = vec3(dot(diffuseColor.rgb, vec3(0.45, 0.45, 0.1))) * vec3(1.6, 1.08, 0.42);
    diffuseColor.rgb = mix(diffuseColor.rgb, gold, uAutumn * grassy * 0.85);
    float snowy = smoothstep(0.42, 0.82, vNW.y);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.9, 0.95), uWinter * snowy * 0.96);`,
  pine: `
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.92, 0.96), uWinter * smoothstep(0.15, 0.6, vNW.y) * 0.9);`,
  shrub: `
    float l = dot(diffuseColor.rgb, vec3(0.33));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(l) * vec3(2.2, 0.85, 0.3), uAutumn * 0.8);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.92, 0.96), uWinter * smoothstep(0.2, 0.7, vNW.y) * 0.9);`,
  rock: `
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.92, 0.96), uWinter * smoothstep(0.45, 0.8, vNW.y));`,
};

/** Add the season terms to a MeshStandardMaterial, keeping any onBeforeCompile it already has. */
export function seasonize(m, kind) {
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => `${prevKey ? prevKey() : ""}|season-${kind}`;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    Object.assign(sh.uniforms, seasonU);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vNW;")
      .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nvNW = normalize(mat3(modelMatrix) * objectNormal);");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vNW; uniform float uAutumn, uWinter;")
      .replace("#include <roughnessmap_fragment>", `${CODE[kind]}\n#include <roughnessmap_fragment>`);
  };
  m.needsUpdate = true;
  return m;
}

/** Two drifting mist sheets over the lake basin; strength follows the hour (dawn) and winter. */
export function mist(centre) {
  const group = new THREE.Group(), uni = { uT: { value: 0 }, uMist: { value: 0 } };
  for (const [y, s] of [[7, 1], [19, 1.6]]) {
    const m = new THREE.MeshBasicMaterial({ color: 0xf3efe8, transparent: true, depthWrite: false });
    m.customProgramCacheKey = () => "dio-mist";
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vXZ;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvXZ = (modelMatrix * vec4(position, 1.0)).xz;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
varying vec2 vXZ; uniform float uT, uMist;
float mh(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float mn(vec2 x) { vec2 i = floor(x), f = fract(x), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mh(i), mh(i + vec2(1, 0)), u.x), mix(mh(i + vec2(0, 1)), mh(i + vec2(1, 1)), u.x), u.y); }`)
        .replace("#include <color_fragment>", `#include <color_fragment>
  vec2 p = vXZ / 140.0 + vec2(uT * 0.004, uT * 0.002);
  float n = mn(p) * 0.6 + mn(p * 2.7 - uT * 0.003) * 0.4;
  float edge = 1.0 - smoothstep(900.0, 1700.0, length(vXZ - vec2(${centre.x.toFixed(1)}, ${centre.z.toFixed(1)})));
  diffuseColor.a = uMist * smoothstep(0.35, 0.8, n) * edge * ${(0.55 / s).toFixed(2)};`);
    };
    const p = new THREE.Mesh(new THREE.PlaneGeometry(3600, 3600).rotateX(-Math.PI / 2), m);
    p.position.set(centre.x, y, centre.z);
    p.renderOrder = 6;
    group.add(p);
  }
  group.userData.uni = uni;
  return group;
}
