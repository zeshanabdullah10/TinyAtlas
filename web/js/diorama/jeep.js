// A low-poly Willys-type jeep (the kind that runs the Kalam to Mahodand track) and its ride: four wheels sample the
// real track profile plus the drawn bumps; the body rides them on a soft, underdamped spring.
import * as THREE from "three";

const WB = 2.1, TR = 1.44, R = 0.38, RIDE = 0.55;   // wheelbase, track width, wheel radius, body height above axles

function box(w, h, d, mat, x, y, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; return m; }

export function jeepModel() {
  const root = new THREE.Group(), body = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: 0xc4602a, roughness: 0.5, metalness: 0.15 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.8 });
  const canvas = new THREE.MeshStandardMaterial({ color: 0xe6d8b8, roughness: 0.95, side: THREE.DoubleSide });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd9d4ca, roughness: 0.25, metalness: 0.9 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fc4cf, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.35 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xfff1cc, emissive: 0xffd58a, emissiveIntensity: 0.3 });
  // body tub, bonnet, grille, wings
  body.add(box(1.5, 0.55, 2.3, paint, 0, 0.35, 0.35));
  body.add(box(1.32, 0.42, 1.25, paint, 0, 0.45, -1.35));
  body.add(box(1.24, 0.5, 0.08, dark, 0, 0.42, -1.99));
  for (let i = -3; i <= 3; i++) body.add(box(0.06, 0.4, 0.1, chrome, i * 0.15, 0.42, -2.0));
  for (const s of [-1, 1]) {
    body.add(box(0.32, 0.08, 1.15, paint, s * 0.8, 0.28, -1.38));          // wings
    body.add(box(0.32, 0.08, 0.9, paint, s * 0.8, 0.28, 1.05));
    const hl = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 12).rotateX(Math.PI / 2), lamp);
    hl.position.set(s * 0.42, 0.52, -2.02); body.add(hl);
  }
  body.add(box(1.7, 0.12, 0.14, chrome, 0, 0.12, -2.1));                    // bumper
  // windscreen frame and glass
  const ws = new THREE.Group();
  ws.add(box(1.36, 0.06, 0.06, dark, 0, 0.62, 0)); ws.add(box(0.06, 0.62, 0.06, dark, -0.66, 0.31, 0)); ws.add(box(0.06, 0.62, 0.06, dark, 0.66, 0.31, 0));
  const g = new THREE.Mesh(new THREE.PlaneGeometry(1.26, 0.56), glass); g.position.set(0, 0.31, 0); ws.add(g);
  ws.position.set(0, 0.63, -0.72); ws.rotation.x = -0.18; body.add(ws);
  // canvas top over a roll frame
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.06, 1.75), canvas); top.position.set(0, 1.62, 0.35); top.castShadow = true; body.add(top);
  for (const s of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.55), canvas); side.rotation.y = Math.PI / 2; side.position.set(s * 0.73, 1.33, 0.75); body.add(side);
    body.add(box(0.05, 1.05, 0.05, dark, s * 0.7, 1.1, 1.2)); body.add(box(0.05, 1.0, 0.05, dark, s * 0.7, 1.1, -0.48));
  }
  const back = new THREE.Mesh(new THREE.PlaneGeometry(1.44, 0.6), canvas); back.position.set(0, 1.3, 1.23); body.add(back);
  // seats, steering wheel, spare tyre, jerry can
  body.add(box(1.2, 0.18, 0.5, dark, 0, 0.7, -0.15)); body.add(box(1.2, 0.5, 0.12, dark, 0, 0.95, 0.12));
  body.add(box(1.2, 0.18, 0.55, dark, 0, 0.7, 0.75)); body.add(box(1.2, 0.5, 0.12, dark, 0, 0.95, 1.03));
  const sw = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.02, 6, 16), dark); sw.position.set(-0.35, 1.05, -0.5); sw.rotation.x = -1.1; body.add(sw);
  const spare = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.12, 8, 18), dark); spare.position.set(0, 0.72, 1.6); body.add(spare);
  body.add(box(0.22, 0.4, 0.14, new THREE.MeshStandardMaterial({ color: 0x4f6a3a, roughness: 0.7 }), 0.55, 0.85, 1.55));
  // luggage on the roof, as the Kalam jeeps carry it
  body.add(box(0.9, 0.22, 0.6, new THREE.MeshStandardMaterial({ color: 0x6b4a8c, roughness: 0.9 }), -0.15, 1.76, 0.15));
  body.add(box(0.5, 0.18, 0.45, new THREE.MeshStandardMaterial({ color: 0x2f5f8a, roughness: 0.9 }), 0.35, 1.74, 0.75));
  body.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  root.add(body);

  const wheels = [];
  const tyre = new THREE.MeshStandardMaterial({ color: 0x1d1b19, roughness: 0.9 });
  const hub = new THREE.MeshStandardMaterial({ color: 0x8a8f80, roughness: 0.4, metalness: 0.6 });
  for (const [x, z] of [[-TR / 2, -WB / 2 - 0.2], [TR / 2, -WB / 2 - 0.2], [-TR / 2, WB / 2 - 0.2], [TR / 2, WB / 2 - 0.2]]) {
    const steer = new THREE.Group(), spin = new THREE.Group();
    const t = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.26, 18).rotateZ(Math.PI / 2), tyre);
    const tread = new THREE.Mesh(new THREE.TorusGeometry(R - 0.02, 0.05, 4, 14).rotateY(Math.PI / 2), tyre);
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.28, 10).rotateZ(Math.PI / 2), hub);
    for (const m of [t, tread, h]) { m.castShadow = true; spin.add(m); }
    steer.add(spin); steer.position.set(x, 0, z);
    root.add(steer);
    wheels.push({ steer, spin, x, z, y: 0, front: z < 0 });
  }
  // headlight beams for dusk
  const beam = new THREE.SpotLight(0xffe2a8, 0, 60, 0.5, 0.6, 1.2);
  beam.position.set(0, 0.9, -2.0); beam.target.position.set(0, -0.5, -12);
  body.add(beam, beam.target);
  return { root, body, wheels, beam, lamp };
}

/** Ride state along a Path. Controls: throttle, brake, steer in [-1, 1]. */
export class Ride {
  constructor(path, model) {
    this.path = path; this.m = model;
    this.s = 6; this.v = 0; this.lat = 0.2; this.latV = 0; this.steer = 0;
    this.heave = 0; this.heaveV = 0; this.pitch = 0; this.pitchV = 0; this.roll = 0; this.rollV = 0;
    this.jolt = 0; this.grade = 0; this.alt = 0; this.done = false; this.spin = 0;
    this._p = {}; this._init = false;
  }
  update(dt, input) {
    const P = this.path, p = P.at(this.s, this._p);
    this.grade = p.grade;
    // longitudinal: engine, brakes, gravity on the grade, rolling drag
    const vmax = 9.5;
    let a = input.throttle * (2.6 - 1.1 * Math.max(this.v / vmax, 0) ** 2) - input.brake * 6 - 9.81 * Math.sin(Math.atan(p.grade)) * 0.55;
    a -= 0.35 * Math.sign(this.v) + 0.04 * this.v * Math.abs(this.v);
    if (!input.throttle && Math.abs(this.v) < 0.25) { a = 0; this.v *= 0.8; }
    this.v = Math.min(Math.max(this.v + a * dt, -2), vmax);
    this.s = Math.min(Math.max(this.s + this.v * dt, 2.5), P.length - 2.5);
    if (this.s >= P.length - 2.6 && !this.done) this.done = true;
    // lateral: steer within the track, drifts back to the ruts when let go
    this.steer += (input.steer - this.steer) * Math.min(1, dt * 5);
    const target = input.steer ? this.lat + input.steer * 2 : 0.15;
    this.latV += ((target - this.lat) * (input.steer ? 1.2 : 0.6) - this.latV * 1.6) * dt * Math.min(Math.abs(this.v) / 3, 1.5);
    this.lat = Math.min(Math.max(this.lat + this.latV * dt, -1.45), 1.45);

    // wheels sample the surface where they actually are
    const W = this.m.wheels, contact = [];
    for (const w of W) {
      const y = P.surface(this.s - w.z, this.lat + w.x);
      contact.push(y);
    }
    const front = (contact[0] + contact[1]) / 2, rear = (contact[2] + contact[3]) / 2;
    const left = (contact[0] + contact[2]) / 2, right = (contact[1] + contact[3]) / 2;
    const tHeave = (front + rear) / 2, tPitch = Math.atan2(front - rear, WB), tRoll = Math.atan2(left - right, TR);
    if (!this._init) { this.heave = tHeave; this.pitch = tPitch; this.roll = tRoll; this._init = true; }
    const sub = 4, h = dt / sub;
    for (let i = 0; i < sub; i++) {                     // sub-steps keep the stiff springs stable at 30 fps
      this.heaveV += (190 * (tHeave - this.heave) - 9 * this.heaveV) * h;
      this.heave += this.heaveV * h;
      this.pitchV += (150 * (tPitch - this.pitch) - 8 * this.pitchV + a * 0.02) * h;
      this.pitch += this.pitchV * h;
      this.rollV += (130 * (tRoll - this.roll) - 7 * this.rollV - this.steer * this.v * 0.004) * h;
      this.roll += this.rollV * h;
    }
    this.jolt = Math.min(1, Math.abs(this.heaveV) * 0.6 + Math.abs(this.pitchV) * 0.8 + Math.abs(this.rollV) * 0.8);
    this.alt = p.y;

    // pose
    const yaw = Math.atan2(-p.tx, -p.tz) - this.latV * 0.08;
    const root = this.m.root;
    root.position.set(p.x - p.tz * this.lat, this.heave, p.z + p.tx * this.lat);
    root.rotation.set(0, yaw, 0);
    this.m.body.position.set(0, R + RIDE - 0.25, 0);
    this.m.body.rotation.set(this.pitch, 0, -this.roll, "YXZ");
    this.spin -= (this.v * dt) / R;
    W.forEach((w, i) => {
      w.steer.position.y = contact[i] - this.heave + R;
      w.steer.rotation.y = w.front ? -this.steer * 0.45 : 0;
      w.spin.rotation.x = this.spin;
    });
    return p;
  }
  /** World positions of the rear wheels' contact patches (for dust). */
  rearContacts(out) {
    const W = this.m.wheels;
    for (let i = 2; i < 4; i++) {
      const v = out[i - 2] || (out[i - 2] = new THREE.Vector3());
      W[i].steer.getWorldPosition(v); v.y -= R;
    }
    return out;
  }
}
