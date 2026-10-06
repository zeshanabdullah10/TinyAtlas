// Traffic on the drive (illustrative; vehicle kinds as seen on Swat roads, not counted): painted Bedford trucks,
// Suzuki Bolan vans, Mehran cars, CD70 motorbikes, Qingqi rickshaws, jeeps and Hilux pickups.
// Road rules as they work on a one-lane mountain road: keep left (Pakistan drives on the left); oncoming vehicles slow
// and squeeze to their edge, and stop with the horn if you are not on your side; a slower vehicle ahead holds you back
// until you sound the horn (H), then it pulls to the left edge and lets you by; drivers sound the horn into blind bends.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });
const mats = {
  dark: M(0x24211e, { roughness: 0.85 }), tyre: M(0x151515, { roughness: 0.95 }), glass: M(0x7d98a2, { roughness: 0.15, metalness: 0.3 }),
  chrome: M(0xd8d4cc, { roughness: 0.25, metalness: 0.8 }), lamp: M(0xfff1cc, { emissive: 0xffd58a, emissiveIntensity: 0.4 }),
  skin: M(0x8a5a3c), shalwar: M(0xd9d2c0), cloth: M(0x4b5a6a), red: M(0xc0392b), white: M(0xf2f0ea, { roughness: 0.45 }),
  canvas: M(0x6f7a3a, { roughness: 0.95 }), rack: M(0x3a3a3a, { metalness: 0.5 }),
};

/** Truck art: the painted panels of a Pakistani Bedford (flowers, borders, "Horn OK Please"), drawn once. */
function truckArt() {
  const c = document.createElement("canvas"); c.width = 512; c.height = 256;
  const x = c.getContext("2d"), cols = ["#e63946", "#f4a261", "#2a9d8f", "#e9c46a", "#7b2cbf", "#06d6a0", "#ff006e", "#3a86ff"];
  x.fillStyle = "#f1c40f"; x.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 16; i++) { x.fillStyle = cols[i % 8]; x.fillRect(i * 32, 0, 32, 26); x.fillRect(i * 32, 230, 32, 26); }
  for (let i = 0; i < 6; i++) {                                  // flower medallions
    const cx = 45 + i * 84, cy = 128; x.fillStyle = cols[(i + 3) % 8]; x.beginPath(); x.arc(cx, cy, 34, 0, 7); x.fill();
    for (let p = 0; p < 8; p++) { x.fillStyle = cols[(i + p) % 8]; x.beginPath(); x.arc(cx + Math.cos(p) * 22, cy + Math.sin(p) * 22, 11, 0, 7); x.fill(); }
    x.fillStyle = "#fff"; x.beginPath(); x.arc(cx, cy, 9, 0, 7); x.fill();
  }
  x.fillStyle = "#1d3557"; x.font = "bold 30px sans-serif"; x.textAlign = "center"; x.fillText("HORN OK PLEASE", 256, 214);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return M(0xffffff, { map: t, roughness: 0.5 });
}

// ---- models: box lists, merged into one mesh per material. Forward is -z, the ground at y = 0.
function build(parts) {
  const by = new Map();
  for (const [geo, mat, x, y, z, rx = 0, ry = 0, rz = 0] of parts) {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone());
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
    (by.get(mat) || by.set(mat, []).get(mat)).push(g);
  }
  const root = new THREE.Group();
  for (const [mat, list] of by) { const m = new THREE.Mesh(mergeGeometries(list), mat); m.castShadow = true; root.add(m); }
  return root;
}
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const wheel = (r, w) => new THREE.CylinderGeometry(r, r, w, 12).rotateZ(Math.PI / 2);
function wheels(p, r, w, xs, zs) { for (const x of xs) for (const z of zs) p.push([wheel(r, w), mats.tyre, x, r, z]); }
function person(p, x, y, z, shirt = mats.shalwar) {
  p.push([B(0.42, 0.62, 0.3), shirt, x, y + 0.31, z], [new THREE.SphereGeometry(0.13, 8, 6), mats.skin, x, y + 0.75, z],
    [new THREE.CylinderGeometry(0.15, 0.15, 0.08, 8), mats.white, x, y + 0.87, z]);    // a white cap
}

const MODELS = {
  truck(art) {          // Bedford with the wooden crown over the cab and painted body
    const p = [], body = M(0x2a6f97);
    p.push([B(2.4, 0.5, 7.4), mats.dark, 0, 0.75, 0.3]);
    p.push([B(2.3, 1.9, 1.9), body, 0, 1.0, -2.6], [B(2.2, 0.9, 0.05), mats.glass, 0, 2.0, -3.56]);
    p.push([B(2.36, 0.85, 0.12), art, 0, 3.05, -3.5], [B(2.36, 0.12, 1.2), art, 0, 3.4, -2.9]);         // the crown
    p.push([B(2.5, 2.2, 5.0), art, 0, 1.0, 1.4], [B(2.52, 0.2, 5.02), mats.chrome, 0, 3.2, 1.4]);
    p.push([B(1.8, 0.5, 0.1), mats.chrome, 0, 0.75, -3.62]);
    for (const s of [-1, 1]) p.push([new THREE.CylinderGeometry(0.16, 0.16, 0.08, 10).rotateX(Math.PI / 2), mats.lamp, s * 0.8, 1.25, -3.6]);
    wheels(p, 0.5, 0.35, [-1.0, 1.0], [-2.6, 1.0, 2.4]);
    return { g: build(p), len: 7.6, width: 2.5, vmax: 5.5, horn: "truck" };
  },
  van() {               // Suzuki Bolan "dabba", a roof rack with luggage
    const p = [], c = M([0xf0efe9, 0xdcdcd4, 0x9fb8c8][Math.floor(Math.random() * 3)], { roughness: 0.4 });
    p.push([B(1.4, 1.5, 3.3), c, 0, 0.35, 0], [B(1.3, 0.6, 0.05), mats.glass, 0, 1.15, -1.66]);
    for (const s of [-1, 1]) p.push([B(0.05, 0.5, 2.4), mats.glass, s * 0.71, 1.2, 0.1]);
    p.push([B(1.3, 0.08, 2.2), mats.rack, 0, 1.92, 0.2], [B(1.0, 0.35, 1.2), mats.canvas, 0, 2.0, 0.3]);
    wheels(p, 0.3, 0.2, [-0.62, 0.62], [-1.1, 1.1]);
    return { g: build(p), len: 3.4, width: 1.45, vmax: 7.5, horn: "car" };
  },
  car() {               // Suzuki Mehran
    const p = [], c = M([0xb8bcc2, 0xffffff, 0x9b1d20, 0x26466d][Math.floor(Math.random() * 4)], { roughness: 0.35 });
    p.push([B(1.45, 0.6, 3.5), c, 0, 0.3, 0], [B(1.3, 0.55, 1.8), c, 0, 0.9, 0.2], [B(1.25, 0.45, 0.05), mats.glass, 0, 0.95, -0.72, -0.4]);
    for (const s of [-1, 1]) p.push([B(0.05, 0.38, 1.4), mats.glass, s * 0.66, 0.98, 0.2]);
    wheels(p, 0.28, 0.18, [-0.65, 0.65], [-1.1, 1.15]);
    return { g: build(p), len: 3.5, width: 1.45, vmax: 8.5, horn: "car" };
  },
  bike() {              // Honda CD70, a rider and a pillion
    const p = [];
    p.push([new THREE.CylinderGeometry(0.3, 0.3, 0.08, 12).rotateZ(Math.PI / 2), mats.tyre, 0, 0.3, -0.65]);
    p.push([new THREE.CylinderGeometry(0.3, 0.3, 0.08, 12).rotateZ(Math.PI / 2), mats.tyre, 0, 0.3, 0.65]);
    p.push([B(0.3, 0.3, 1.1), mats.red, 0, 0.45, 0], [B(0.6, 0.05, 0.05), mats.chrome, 0, 0.95, -0.55]);
    person(p, 0, 0.62, -0.05, mats.cloth); if (Math.random() < 0.7) person(p, 0, 0.62, 0.4);
    return { g: build(p), len: 1.9, width: 0.7, vmax: 9, horn: "bike" };
  },
  rickshaw() {          // Qingqi: three wheels, a canopy, open sides
    const p = [], c = M(0x1f7a4d);
    p.push([B(1.3, 0.3, 2.6), c, 0, 0.35, 0.1], [B(1.36, 0.08, 2.2), M(0x111111), 0, 1.75, 0.3]);
    for (const s of [-1, 1]) p.push([B(0.06, 1.1, 0.06), mats.chrome, s * 0.62, 0.65, -0.6], [B(0.06, 1.1, 0.06), mats.chrome, s * 0.62, 0.65, 1.3]);
    p.push([B(1.2, 0.4, 0.5), M(0x7a1f1f), 0, 0.65, 0.8]);
    person(p, 0, 0.62, -0.75, mats.cloth); person(p, -0.3, 0.7, 0.9); person(p, 0.3, 0.7, 0.9, M(0x6a3d9a));
    wheels(p, 0.24, 0.14, [0], [-1.05]); wheels(p, 0.24, 0.14, [-0.6, 0.6], [1.0]);
    return { g: build(p), len: 2.7, width: 1.35, vmax: 6, horn: "bike" };
  },
  jeep() {              // Willys, the Kalam and Mahodand track jeep, people standing at the back
    const p = [], c = M([0x3e6b3a, 0x2f4f6f, 0xb4492a, 0x8a8a7a][Math.floor(Math.random() * 4)], { roughness: 0.5 });
    p.push([B(1.5, 0.6, 3.4), c, 0, 0.45, 0], [B(1.5, 0.06, 1.8), mats.canvas, 0, 1.7, 0.4]);
    for (const s of [-1, 1]) p.push([B(0.05, 1.1, 0.05), mats.dark, s * 0.7, 1.0, 1.2], [B(0.05, 1.1, 0.05), mats.dark, s * 0.7, 1.0, -0.4]);
    p.push([B(1.3, 0.5, 0.05), mats.glass, 0, 1.1, -0.45, -0.2]);
    person(p, -0.35, 1.0, 0.9); person(p, 0.35, 1.0, 1.2, mats.cloth);
    wheels(p, 0.38, 0.24, [-0.72, 0.72], [-1.05, 1.05]);
    return { g: build(p), len: 3.5, width: 1.6, vmax: 7, horn: "car" };
  },
  pickup() {            // Hilux with a crowd in the back
    const p = [], c = M(0xe8e6e0, { roughness: 0.4 });
    p.push([B(1.75, 0.7, 4.9), c, 0, 0.45, 0], [B(1.65, 0.7, 1.9), c, 0, 1.15, -0.8], [B(1.55, 0.5, 0.05), mats.glass, 0, 1.3, -1.76, -0.3]);
    for (let i = 0; i < 4; i++) person(p, (i % 2 ? 0.4 : -0.4), 1.15, 0.6 + Math.floor(i / 2) * 0.8, i % 2 ? mats.cloth : mats.shalwar);
    wheels(p, 0.36, 0.24, [-0.8, 0.8], [-1.55, 1.5]);
    return { g: build(p), len: 4.9, width: 1.8, vmax: 7.5, horn: "car" };
  },
};

const MIX = {
  track: ["jeep", "jeep", "jeep", "pickup", "bike", "bike"],                          // a jeep track (Mahodand)
  road: ["truck", "van", "van", "car", "car", "bike", "bike", "rickshaw", "jeep"],     // a valley road (Marghazar)
};

const LANE = 1.15;          // a vehicle's distance left of the centre line, on its own side

export class Traffic {
  /** kind: "track" (jeeps) or "road" (valley traffic). */
  constructor(scene, path, kind, sound) {
    this.path = path; this.sound = sound; this.cars = []; this.note = ""; this.hornT = 0;
    this.group = new THREE.Group(); scene.add(this.group);
    const art = truckArt(), list = MIX[kind] || MIX.road, n = list.length;
    list.forEach((k, i) => {
      const m = MODELS[k](art);
      const dir = i % 2 ? -1 : 1;                                  // half come up with you, half come down
      const car = { kind: k, ...m, dir, s: (path.length * (i + 0.5)) / n, v: m.vmax * 0.8, lat: -dir * LANE, yield: 0, honk: 0, id: i };
      car.vmax *= 0.75 + 0.2 * ((i * 37) % 10) / 10;
      this.group.add(car.g); this.cars.push(car);
    });
    this._p = {};
  }
  /** Step the traffic and hold the player's jeep to the road rules. Returns a hint for the HUD ("" when none). */
  update(dt, ride, driving) {
    const P = this.path, me = { s: ride.s, lat: ride.lat, v: ride.v };
    let hint = "", block = Infinity, crash = false;
    this.hornT -= dt;
    for (const c of this.cars) {
      const ahead = (c.s - me.s) * c.dir;                          // > 0: the car is ahead of the player along its own travel
      const gapAlong = (c.s - me.s);                               // > 0: the car is further up the road than the player
      let want = c.vmax, lane = -c.dir * LANE;
      // oncoming (coming down while you go up): slow and squeeze over near you; stop and honk if you are on its side
      if (driving && c.dir < 0 && gapAlong > -3 && gapAlong < 45) {
        want = Math.min(want, 2.2); lane = 1.45;
        if (gapAlong < 30) hint = "Oncoming: keep left (A)";
        c.wait = Math.abs(me.v) < 0.4 && gapAlong < 14 ? (c.wait || 0) + dt : 0;
        if (c.wait > 3) { want = 1.0; lane = 1.65; }                 // you waited: it squeezes past along its edge
        else if (gapAlong < 14 && Math.abs(me.lat - c.lat) < (c.width + 1.55) / 2 - 0.1) {
          want = 0; this.honk(c, dt);
          if (gapAlong < (c.len + 3.5) / 2 + 1.5) { block = Math.min(block, c.s - (c.len + 3.5) / 2 - 0.6); crash = gapAlong < (c.len + 3.5) / 2; }
        }
      }
      // going your way, in front of you: you are held behind it until you sound the horn, then it pulls over
      if (driving && c.dir > 0 && gapAlong > 0 && gapAlong < 40) {
        if (c.yield > 0) { lane = -1.55; want = Math.min(want, 2.5); hint = hint || "It is letting you pass: keep right (D)"; }
        else if (gapAlong < 18) hint = hint || "Slow traffic ahead: sound the horn (H) to pass";
        const clear = Math.abs(me.lat - c.lat) > (c.width + 1.55) / 2 - 0.1;     // side by side, by the vehicles' real widths
        if (!clear || c.yield <= 0) block = Math.min(block, c.s - (c.len + 3.5) / 2 - 0.8);
      }
      // the car ahead of this one in the same direction sets its pace (no ghosting through each other)
      for (const o of this.cars) if (o !== c && o.dir === c.dir) {
        const d = (o.s - c.s) * c.dir;
        if (d > 0 && d < (o.len + c.len) / 2 + 6) want = Math.min(want, o.v * 0.9);
      }
      // and the player's jeep, for a car behind you
      if (driving && c.dir > 0 && gapAlong < 0 && -gapAlong < (c.len + 3.5) / 2 + 5) want = Math.min(want, Math.max(me.v, 0));
      c.v += Math.max(-4, Math.min(1.5, (want - c.v) * 1.5)) * dt;
      c.s += c.v * c.dir * dt;
      c.lat += (lane - c.lat) * Math.min(1, dt * 1.2);
      c.yield = Math.max(0, c.yield - dt);
      // blind bends: a horn going in
      const q1 = P.at(c.s, this._p), tx = q1.tx, tz = q1.tz, q2 = P.at(c.s + 25 * c.dir, this._p);
      if (Math.abs(tx * q2.tz - tz * q2.tx) > 0.5 && Math.random() < dt * 0.6) this.honk(c, 1);
      // ends of the road: turn round out of sight
      if (c.s > P.length - 3 || c.s < 3) {
        const far = Math.abs(me.s - (c.dir > 0 ? 3 : P.length - 3)) > 120;
        if (far) { c.dir = -c.dir; c.s = c.dir > 0 ? 4 : P.length - 4; c.lat = -c.dir * LANE; }
        else { c.s = Math.min(Math.max(c.s, 3), P.length - 3); c.v = 0; }
      }
      this.pose(c);
    }
    if (driving && block < Infinity && ride.s > block) {           // held: the jeep stops at the gap
      if (crash || ride.v > 3) this.sound?.knock(Math.min(1, ride.v / 4));
      ride.s = Math.max(block, 2.5); ride.v = Math.min(ride.v, 0);
    }
    return hint;
  }
  /** The player sounds the horn: a slower car ahead pulls over. */
  horn(ride) {
    this.sound?.horn?.("car");
    for (const c of this.cars) if (c.dir > 0 && c.s > ride.s && c.s - ride.s < 40) c.yield = 6;
  }
  honk(c, dt) {
    if (c.honk > 0) { c.honk -= dt; return; }
    c.honk = 3 + Math.random() * 3;
    this.sound?.horn?.(c.horn);
  }
  pose(c) {                  // c.lat is measured to the right of the drive direction (+s), as the player's jeep
    const p = this.path.at(c.s, this._p), y = this.path.surface(c.s, c.lat), fwd = c.dir;
    c.g.position.set(p.x - p.tz * c.lat, y, p.z + p.tx * c.lat);
    c.g.rotation.set(Math.atan(p.grade) * fwd, Math.atan2(-p.tx * fwd, -p.tz * fwd), 0, "YXZ");
  }
}

/** People waiting by the road (illustrative). Stop beside one and they climb into the back of the jeep. */
export class Riders {
  constructor(scene, path, jeep) {
    this.path = path; this.jeep = jeep; this.waiting = []; this.aboard = 0; this.t = 0;
    const shirts = [mats.shalwar, mats.cloth, M(0x6b4f2a), M(0x2f5d50)];
    [0.3, 0.55, 0.8].forEach((f, i) => {
      const s = path.length * f, g = new THREE.Group(), body = [];
      person(body, 0, 0, 0, shirts[i % 4]);
      g.add(build(body));
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.55, 0.1).translate(0, 0.27, 0), shirts[i % 4]);
      arm.position.set(0.24, 0.6, 0); g.add(arm);
      const q = path.at(s), l = -3.1;                                // on the left verge, your side of the road
      g.position.set(q.x - q.tz * l, path.surface(s, -2.2), q.z + q.tx * l);
      g.rotation.y = Math.atan2(q.tz, -q.tx);                         // facing the road
      scene.add(g);
      this.waiting.push({ s, g, arm });
    });
  }
  /** Returns a message when someone boards. */
  update(dt, ride, driving) {
    this.t += dt;
    let msg = "";
    for (const w of this.waiting) {
      if (!w.g.parent || w.aboard) continue;
      const d = w.s - ride.s;
      w.arm.rotation.z = d > -5 && d < 60 ? 2.6 + Math.sin(this.t * 7) * 0.5 : 0.1;   // waving you down
      if (driving && d > -6 && d < 14 && Math.abs(ride.v) < 0.6) {
        w.aboard = true; this.aboard++;
        w.g.parent.remove(w.g);
        w.arm.rotation.z = 0.1;
        w.g.position.set(this.aboard % 2 ? -0.35 : 0.35, 0.95, 0.75 + (this.aboard > 2 ? 0.35 : 0)); w.g.rotation.set(0, Math.PI, 0); w.g.scale.setScalar(0.95);
        this.jeep.body.add(w.g);
        msg = ["Salaam! A ride up the hill, thank you.", "Jazakallah. I'll get off at the top.", "Shukriya! Mind the bends."][this.aboard - 1] || "Shukriya!";
      } else if (driving && d > 0 && d < 30) msg = msg || "";
    }
    return msg;
  }
  near(ride) { return this.waiting.some((w) => !w.aboard && w.s - ride.s > 0 && w.s - ride.s < 35); }
}
