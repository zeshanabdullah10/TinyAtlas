// Sun path for the site's latitude in the July visiting season, sky dome, and the light rig that follows it.
import * as THREE from "three";

const DECL = THREE.MathUtils.degToRad(21);        // mid July

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
    this.uni = { uSun: { value: new THREE.Vector3() }, uHor: { value: new THREE.Color() }, uZen: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uni, side: THREE.BackSide, depthWrite: false, depthTest: false,
      vertexShader: `varying vec3 vD; void main() { vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
      fragmentShader: `varying vec3 vD; uniform vec3 uSun, uHor, uZen, uSunCol;
        void main() {
          vec3 d = normalize(vD); float h = max(d.y, 0.0);
          vec3 c = mix(uHor, uZen, pow(h, 0.55));
          c = mix(c, uHor * 0.8, smoothstep(0.0, -0.2, d.y));
          float s = max(dot(d, uSun), 0.0);
          c += uSunCol * (pow(s, 9.0) * 0.35 + pow(s, 90.0) * 0.6) + uSunCol * smoothstep(0.9993, 0.9997, s) * 3.0;
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
    this.dome.renderOrder = -10; this.dome.frustumCulled = false; this.dome.scale.setScalar(1000);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.6;
    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x6b5a3a, 0.8);
    scene.add(this.dome, this.sun, this.sun.target, this.hemi);
    this.horizon = new THREE.Color();
    this.set(16.9);
  }
  set(hour) {
    this.hour = hour;
    const { dir, el } = sunAt(this.lat, hour);
    this.dir = dir; this.el = el;
    const t = (el + 2) / 30, night = Math.min(Math.max((-el + 1) / 7, 0), 1);
    const sunCol = mix(new THREE.Color(1.0, 0.5, 0.25), new THREE.Color(1.0, 0.95, 0.88), t);
    const hor = mix(mix(new THREE.Color(0.98, 0.7, 0.5), new THREE.Color(0.78, 0.85, 0.95), t), new THREE.Color(0.1, 0.12, 0.2), night);
    const zen = mix(mix(new THREE.Color(0.32, 0.42, 0.7), new THREE.Color(0.24, 0.45, 0.82), t), new THREE.Color(0.02, 0.03, 0.08), night);
    this.uni.uSun.value.copy(dir); this.uni.uHor.value.copy(hor); this.uni.uZen.value.copy(zen); this.uni.uSunCol.value.copy(sunCol).multiplyScalar(1 - night);
    this.sun.color.copy(sunCol);
    this.sun.intensity = 3.4 * Math.min(Math.max((el + 1) / 6, 0), 1);
    this.hemi.color.copy(mix(hor, zen, 0.5)); this.hemi.groundColor.setRGB(0.42, 0.34, 0.22).multiplyScalar(1 - night * 0.8);
    this.hemi.intensity = 0.55 + 0.55 * (1 - night) * Math.min(t, 1);
    this.horizon.copy(hor);
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
    }
  }
}
