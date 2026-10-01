// Sky background, golden-hour sun with a camera-following shadow map, hemisphere fill, and the haze colour.
import * as THREE from "three";
import { shared } from "./material.js";
import { loadBitmap } from "./terrain.js";

const rad = (d) => (d * Math.PI) / 180;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function sunVec(az, el, out = new THREE.Vector3()) {
  const a = rad(az), e = rad(el);
  return out.set(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a));
}

export class Sky {
  constructor(scene, pack, { tier = "high" } = {}) {
    this.scene = scene; this.pack = pack; this.tier = tier;
    const d = pack.meta.sun_default;
    this.az = d.azimuth_deg; this.el = d.elevation_deg;
    this.baseColor = new THREE.Color().setRGB(...d.color, THREE.LinearSRGBColorSpace);
    this.hemi = new THREE.HemisphereLight(0x9cb0d8, 0xa08a66, 1.8);
    this.sun = new THREE.DirectionalLight(0xffffff, 4.5);
    this.sun.castShadow = true;
    this.mapSize = tier === "high" ? 4096 : 2048;
    this.sun.shadow.mapSize.set(this.mapSize, this.mapSize);
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 3;
    this.sun.shadow.camera.near = 1;
    scene.add(this.hemi, this.sun, this.sun.target);
    scene.fog = new THREE.Fog(0xe9d3bf, 8000, 70000);
    this.haze = new THREE.Color(0xe9d3bf);
    this.dir = new THREE.Vector3();
    this.R = 3000;
    this.setSun(this.az, this.el);
  }

  async load() {
    try {
      const bm = await loadBitmap(this.pack.base + "sky.jpg", true);
      const tex = new THREE.Texture(bm); tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace;
      tex.mapping = THREE.EquirectangularReflectionMapping; tex.needsUpdate = true;
      this.scene.background = tex;
      // haze colour: the horizon band of the sky itself, as displayed (fog mixes in display space)
      const c = document.createElement("canvas"); c.width = 64; c.height = 8;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(bm, 0, bm.height * 0.5, bm.width, bm.height * 0.06, 0, 0, 64, 8);
      const px = g.getImageData(0, 0, 64, 8).data; let r = 0, gr = 0, b = 0;
      for (let i = 0; i < px.length; i += 4) { r += px[i]; gr += px[i + 1]; b += px[i + 2]; }
      const n = px.length / 4 * 255;
      this.haze.setRGB(r / n, gr / n, b / n, THREE.LinearSRGBColorSpace).lerp(new THREE.Color().setRGB(1.0, 0.78, 0.6, THREE.LinearSRGBColorSpace), 0.7);
    } catch { this.scene.background = new THREE.Color(0xe9d3bf); }
    this.scene.fog.color.copy(this.haze);
    shared.uSkyCol.value.copy(this.haze);
  }

  setSun(az, el) {
    this.az = az; this.el = el;
    sunVec(az, el, this.dir);
    const white = smooth(8, 45, el);
    const c = this.baseColor.clone().lerp(new THREE.Color(1, 0.96, 0.9), white * 0.8);
    this.sun.color.copy(c);
    this.sun.intensity = 4.5 * (0.35 + 0.65 * smooth(0, 6, el));
    this.hemi.intensity = 1.4 + 0.3 * smooth(0, 20, el);
    shared.uSunDir.value.copy(this.dir); shared.uSunCol.value.copy(c);
  }

  /** time 0..1: sunrise in the east, noon in the south, sunset in the southwest. */
  setTime(s) { this.setSun(80 + 144 * s, Math.max(1.5, 62 * Math.sin(Math.PI * s))); }
  get time() { const a = Math.asin(Math.min(1, this.el / 62)) / Math.PI; return this.az >= 150 ? 1 - a : a; }

  /** Fit the shadow frustum to the visible near area around the orbit target. */
  update(target, dist) {
    const R = Math.min(7000, Math.max(900, 1.15 ** Math.ceil(Math.log(dist * 0.9) / Math.log(1.15))));
    const sh = this.sun.shadow, cam = sh.camera, dir = this.dir;
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();
    const texel = (2 * R) / this.mapSize;
    const a = target.dot(right), b = target.dot(up);
    const t = target.clone().addScaledVector(right, Math.round(a / texel) * texel - a).addScaledVector(up, Math.round(b / texel) * texel - b);
    const D = R * 2 + 5000;
    this.sun.target.position.copy(t);
    this.sun.position.copy(t).addScaledVector(dir, D);
    this.sun.target.updateMatrixWorld();
    if (R !== this.R || cam.far !== D * 2) {
      Object.assign(cam, { left: -R, right: R, top: R, bottom: -R, far: D * 2 });
      cam.updateProjectionMatrix(); this.R = R;
    }
  }

  /** Haze ramp: clear up to ~8 km, strong by ~70 km, scaled up when the camera is far out. */
  updateHaze(camDist) {
    const f = this.scene.fog;
    f.near = Math.max(10000, camDist * 0.75); f.far = f.near + 55000;
  }

  setTier(tier) {
    this.tier = tier;
    const s = tier === "high" ? 4096 : 2048;
    if (s !== this.mapSize) { this.mapSize = s; this.sun.shadow.mapSize.set(s, s); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
  }
}
