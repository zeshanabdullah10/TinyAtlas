// Map-style camera: damped orbit with clamped pitch/distance, bounded pan, ground-following target, fly-to.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const rad = (d) => (d * Math.PI) / 180;
const ease = (t) => 1 - Math.pow(1 - t, 3);

export class MapControls {
  constructor(camera, dom, pack) {
    this.camera = camera; this.pack = pack;
    const c = this.c = new OrbitControls(camera, dom);
    Object.assign(c, {
      enableDamping: true, dampingFactor: 0.08, screenSpacePanning: false, zoomToCursor: true, zoomSpeed: 0.9, rotateSpeed: 0.6, panSpeed: 0.9,
      minDistance: 1000, maxDistance: 90000, minPolarAngle: rad(10), maxPolarAngle: rad(75),     // pitch -80 ... -15 degrees
    });
    c.listenToKeyEvents(dom);
    this.tween = null;
    this.home = pack.meta.home_camera;
    this.bounds = { x0: -0.04 * pack.W, x1: 1.04 * pack.W, z0: -0.04 * pack.H, z1: 1.04 * pack.H };
    this.goHome(true);
    c.addEventListener("start", () => { this.tween = null; });
  }

  dispose() { this.c.stopListenToKeyEvents?.(); this.c.dispose(); }

  get target() { return this.c.target; }
  get distance() { return this.camera.position.distanceTo(this.c.target); }
  /** Camera heading in degrees clockwise from north (the direction it looks along). */
  get heading() {
    const d = this.c.target.clone().sub(this.camera.position);
    return ((Math.atan2(d.x, -d.z) * 180) / Math.PI + 360) % 360;
  }

  pose(target, headingDeg, pitchDeg, dist) {
    const H = rad(headingDeg), P = rad(pitchDeg);
    const f = new THREE.Vector3(Math.sin(H) * Math.cos(P), Math.sin(P), -Math.cos(H) * Math.cos(P));
    this.c.target.copy(target);
    this.camera.position.copy(target).addScaledVector(f, -dist);
    this.camera.lookAt(target);
    this.c.update();
  }

  goHome(instant = false) {
    const h = this.home, p = this.pack;
    const t = new THREE.Vector3(h.target[0], p.yOf(h.target[1]), h.target[2]);
    if (instant) return this.pose(t, h.heading_deg, h.pitch_deg, h.distance_m);
    this.flyTo(t, h.distance_m, h.heading_deg, h.pitch_deg);
  }

  /** Tween target, distance and (optionally) heading/pitch. */
  flyTo(target, dist = this.distance, heading = this.heading, pitch = null, ms = 1300) {
    const from = { t: this.c.target.clone(), d: this.distance, hd: this.heading, p: pitch == null ? null : this.pitchDeg() };
    this.tween = { t0: performance.now(), ms, from, to: { t: target.clone(), d: dist, hd: heading, p: pitch } };
  }
  pitchDeg() { const d = this.camera.position.clone().sub(this.c.target); return -(Math.atan2(d.y, Math.hypot(d.x, d.z)) * 180) / Math.PI; }
  resetNorth() { this.flyTo(this.c.target.clone(), this.distance, 0, this.pitchDeg(), 700); }

  /** Double-click / tap target: ground point under the pointer. */
  pick(ndc) {
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
    return this.pack.raycastGround(ray.ray.origin, ray.ray.direction);
  }
  flyToPoint(pt) {
    const t = pt.clone(); t.y = this.pack.groundY(t.x, t.z);
    this.flyTo(t, Math.max(2500, Math.min(this.distance * 0.45, 12000)));
  }

  update() {
    const c = this.c, cam = this.camera, p = this.pack;
    if (this.tween) {
      const { t0, ms, from, to } = this.tween, k = Math.min(1, (performance.now() - t0) / ms), e = ease(k);
      const t = from.t.clone().lerp(to.t, e), d = from.d + (to.d - from.d) * e;
      let dh = ((to.hd - from.hd + 540) % 360) - 180;
      const hd = from.hd + dh * e, pt = to.p == null ? this.pitchDeg() : from.p + (to.p - from.p) * e;
      this.pose(t, hd, pt, d);
      if (k >= 1) this.tween = null;
    } else {
      // follow the terrain under the target (smoothly), keeping the camera offset
      const g = p.groundY(c.target.x, c.target.z), dy = (g - c.target.y) * 0.12;
      c.target.y += dy; cam.position.y += dy;
      c.target.x = Math.min(this.bounds.x1, Math.max(this.bounds.x0, c.target.x));
      c.target.z = Math.min(this.bounds.z1, Math.max(this.bounds.z0, c.target.z));
      c.update();
    }
    const floor = p.groundY(cam.position.x, cam.position.z) + 150;
    if (cam.position.y < floor) cam.position.y = floor;
    cam.near = Math.max(8, this.distance * 0.012); cam.far = this.distance * 6 + 160000;
    cam.updateProjectionMatrix();
  }
}
