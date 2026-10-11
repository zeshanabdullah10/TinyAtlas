// Sun path for the site's latitude in the July visiting season, sky dome, and the light rig that follows it.
import * as THREE from "three";

const DECL = THREE.MathUtils.degToRad(21);        // mid July

// Aerial perspective: exponential haze (FogExp2's density read as 1 / metres, not squared), in the same tone-mapped
// output colour as the sky's horizon so distant ridges sink into it instead of turning a flat grey.
THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  vec3 fogC = fogColor;
  #ifdef TONE_MAPPING
    fogC = toneMapping(fogC);
  #endif
  fogC = linearToOutputTexel(vec4(fogC, 1.0)).rgb;
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp(-fogDensity * vFogDepth);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogC, fogFactor);
#endif`;

/** Sun direction (world, x east, z south, y up) and elevation in degrees at local solar hour h. */
export function sunAt(latDeg, hour) {
  const phi = THREE.MathUtils.degToRad(latDeg), H = THREE.MathUtils.degToRad((hour - 12) * 15);
  const sinEl = Math.sin(phi) * Math.sin(DECL) + Math.cos(phi) * Math.cos(DECL) * Math.cos(H);
  const el = Math.asin(sinEl);
  const cosAz = (Math.sin(DECL) - sinEl * Math.sin(phi)) / (Math.cos(el) * Math.cos(phi));
  let az = Math.acos(Math.min(Math.max(cosAz, -1), 1));    // from north, clockwise
  if (H > 0) az = 2 * Math.PI - az;
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  return { dir, el: THREE.MathUtils.radToDeg(el) };
}

const mix = (a, b, t) => a.clone().lerp(b, Math.min(Math.max(t, 0), 1));

export class Sky {
  constructor(scene, lat) {
    this.lat = lat;
    this.uni = { uT: { value: 0 }, uNight: { value: 0 }, uSun: { value: new THREE.Vector3() }, uHor: { value: new THREE.Color() }, uZen: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uni, side: THREE.BackSide, depthWrite: false, depthTest: false,
      vertexShader: `varying vec3 vD; void main() { vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
      fragmentShader: `varying vec3 vD; uniform vec3 uSun, uHor, uZen, uSunCol; uniform float uT, uNight;
        float sh(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float sn(vec2 x) { vec2 i = floor(x), f = fract(x), u = f * f * (3.0 - 2.0 * f);
          return mix(mix(sh(i), sh(i + vec2(1, 0)), u.x), mix(sh(i + vec2(0, 1)), sh(i + vec2(1, 1)), u.x), u.y); }
        float sf(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * sn(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; } return s; }
        void main() {
          vec3 d = normalize(vD); float h = max(d.y, 0.0);
          vec3 c = mix(uHor, uZen, pow(h, 0.5));
          c = mix(c, uHor * 1.06 + 0.02, exp(-h * 14.0) * 0.6);                    // the haze band along the horizon
          c = mix(c, uHor * 0.8, smoothstep(0.0, -0.2, d.y));
          float s = max(dot(d, uSun), 0.0);
          c += uSunCol * (pow(s, 8.0) * 0.3 + pow(s, 90.0) * 0.5) + uSunCol * smoothstep(0.9993, 0.9997, s) * 3.0;
          // a few soft fair-weather clouds (illustrative), thinning toward the zenith and lost in the haze low down
          if (d.y > 0.0) {
            vec2 p = d.xz / (d.y + 0.12) * 1.6 + vec2(uT * 0.004, uT * 0.0015);
            float n = sf(p), cov = smoothstep(0.52, 0.78, n) * smoothstep(0.02, 0.16, d.y) * (1.0 - 0.5 * smoothstep(0.5, 0.95, d.y));
            float lit = 0.75 + 0.35 * sf(p * 1.7 + 4.0) + pow(s, 4.0) * 0.6;
            vec3 cloud = mix(uHor, vec3(1.0, 0.98, 0.95), 0.6) * lit * (1.0 - uNight * 0.85) + uSunCol * pow(s, 6.0) * 0.4;
            c = mix(c, cloud, cov * 0.75);
          }
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
    this.dome.renderOrder = -10; this.dome.frustumCulled = false; this.dome.scale.setScalar(1000);
    this.dome.onBeforeRender = () => { this.uni.uT.value = performance.now() / 1000; };
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0003; this.sun.shadow.normalBias = 0.6;
    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x6b5a3a, 0.8);
    this.haze = new THREE.Color();
    scene.add(this.dome, this.sun, this.sun.target, this.hemi);
    this.horizon = new THREE.Color();
    this.set(16.9);
  }
  set(hour) {
    this.hour = hour;
    const { dir, el } = sunAt(this.lat, hour);
    this.dir = dir; this.el = el;
    const t = (el + 2) / 30, night = Math.min(Math.max((-el + 1) / 7, 0), 1);
    const sunCol = mix(new THREE.Color(1.0, 0.48, 0.22), new THREE.Color(1.0, 0.9, 0.76), t);   // a warm key, even at noon
    const hor = mix(mix(new THREE.Color(0.98, 0.7, 0.5), new THREE.Color(0.74, 0.83, 0.94), t), new THREE.Color(0.1, 0.12, 0.2), night);
    const zen = mix(mix(new THREE.Color(0.3, 0.4, 0.7), new THREE.Color(0.2, 0.4, 0.8), t), new THREE.Color(0.02, 0.03, 0.08), night);
    this.uni.uSun.value.copy(dir); this.uni.uHor.value.copy(hor); this.uni.uZen.value.copy(zen); this.uni.uSunCol.value.copy(sunCol).multiplyScalar(1 - night);
    this.uni.uNight.value = night;
    this.sun.color.copy(sunCol);
    this.sun.intensity = 3.9 * Math.min(Math.max((el + 1) / 6, 0), 1);
    // a cool sky fill from above, a dim warm bounce from the ground: shadows read blue, sunlit slopes gold
    this.hemi.color.copy(mix(hor, zen, 0.65)).lerp(new THREE.Color(0.55, 0.68, 0.95), 0.2);
    this.hemi.groundColor.setRGB(0.36, 0.3, 0.2).multiplyScalar(1 - night * 0.8);
    this.hemi.intensity = 0.5 + 1.7 * (1 - night) * Math.min(t, 1);
    this.horizon.copy(hor);
    this.haze.copy(hor).lerp(zen, 0.12);
    this.night = night;
  }
  /** Aim the shadow camera at `target` covering `radius` metres. */
  frame(target, radius, mapSize) {
    const s = this.sun;
    s.target.position.copy(target);
    s.position.copy(target).addScaledVector(this.dir.y > 0.02 ? this.dir : new THREE.Vector3(0, 1, 0), radius * 3);
    const c = s.shadow.camera;
    if (c.right !== radius || s.shadow.mapSize.x !== mapSize) {
      c.left = -radius; c.right = radius; c.top = radius; c.bottom = -radius; c.near = radius * 0.5; c.far = radius * 6;
      c.updateProjectionMatrix();
      if (s.shadow.mapSize.x !== mapSize) { s.shadow.mapSize.set(mapSize, mapSize); s.shadow.map?.dispose(); s.shadow.map = null; }
      s.shadow.normalBias = Math.max(0.3, (2 * radius / mapSize) * 0.7);   // about one texel: no acne, no peter-panning
    }
  }
}
