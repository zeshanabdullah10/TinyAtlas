// Mighty 22 Falls: a cascade down a steep dark rock chute, beside the Mahodand jeep road. Local frame (kit.js): the
// front (-z) faces the road the visitor drives in on; the chute rises behind the foot at +z.
// The 30 m DEM cannot resolve the drop, so the chute is drawn at an estimated 60 m; ribbons lie on it and flow.
// Photo: one clear ribbon in a rock gully, with abandoned timber huts on the scree below (Commons 02).
import * as THREE from "three";

const DROP = 60;          // estimated height of the cascade above its foot (m); the 30 m DEM cannot resolve the step
const GULLY_RUN = 14;     // horizontal run of the chute from foot to lip (m), so it leans back at about 77 degrees
const GULLY_W = 12;       // width of the chute between its walls (m)

/** A soft vertical streak texture: white strands on a transparent field, scrolled to read as flowing water. */
function streaks() {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 256;
  const g = c.getContext("2d");
  g.clearRect(0, 0, 64, 256);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const x = rnd() * 64, w = 1 + rnd() * 4, a = 0.35 + rnd() * 0.5;
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, `rgba(255,255,255,${a})`);
    grd.addColorStop(0.5, `rgba(255,255,255,${a * 0.5})`);
    grd.addColorStop(1, `rgba(255,255,255,${a})`);
    g.fillStyle = grd;
    g.fillRect(x, 0, w, 256);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 3);
  return t;
}

/** A soft round spray puff. */
function puffTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, "rgba(255,255,255,0.9)");
  grd.addColorStop(0.5, "rgba(245,252,255,0.45)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export default function build(ctx) {
  const { THREE: T, group, ground, mat, rocks } = ctx;

  // The chute: a steep dark wet rock gully rising behind the foot, with side walls. It is a sloped plane, so the
  // face leans back over the foot and the DEM slope behind does not hide it. Drawn at the estimated height DROP.
  const phi = Math.atan2(GULLY_RUN, DROP);                         // tilt of the face from vertical
  const L = Math.hypot(DROP, GULLY_RUN);
  const base = ground(0, 0);
  const wet = new T.MeshStandardMaterial({ color: 0x4a443c, emissive: 0x2a2620, roughness: 0.4, side: T.DoubleSide });
  const face = new T.Mesh(new T.PlaneGeometry(GULLY_W, L), wet);
  face.rotation.x = phi;
  face.position.set(0, base + DROP / 2, GULLY_RUN / 2 + 0.3);
  group.add(face);
  for (const sx of [-1, 1]) {                                       // the two gully walls, rock on each side
    const wall = new T.Mesh(new T.PlaneGeometry(GULLY_RUN * 1.6, L), mat(0x5a5248, { emissive: 0x2e2a24, roughness: 0.9, side: T.DoubleSide }));
    wall.rotation.set(phi, sx * Math.PI / 2, 0);
    wall.position.set(sx * GULLY_W / 2, base + DROP / 2, GULLY_RUN / 2);
    group.add(wall);
  }
  // Wet boulders at the foot and a plunge pool (static, merged below).
  rocks(16, 0, 3, 7, 1.4, 0.8, mat(0x2b2723, { roughness: 0.35 }), 41);
  const pool = new T.Mesh(
    new T.CircleGeometry(5, 24),
    new T.MeshStandardMaterial({ color: 0x9fcad6, roughness: 0.1, transparent: true, opacity: 0.75 }),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0, base + 0.06, 3);
  group.add(pool);

  // The ribbons lie on the face (same tilt) and scroll downward; animated, so they stay out of the batch.
  const tex = streaks();
  const ribbons = [];
  const sheet = (w, h, x, opacity, speed) => {
    const t = tex.clone();
    t.needsUpdate = true;
    t.repeat.set(1, Math.max(2, h / 10));
    const m = new T.Mesh(
      new T.PlaneGeometry(w, h),
      new T.MeshBasicMaterial({ map: t, transparent: true, opacity, depthWrite: false, side: T.DoubleSide, color: 0xffffff }),
    );
    m.rotation.x = phi;
    const along = h / 2;                                            // centre of the run from the foot
    m.position.set(x, base + along * Math.cos(phi), along * Math.sin(phi) - 0.45);  // on the road side of the face
    m.userData.keep = true;
    m.userData.speed = speed;
    m.userData.tex = t;
    group.add(m);
    ribbons.push(m);
  };
  sheet(3.2, L, -1.6, 0.95, 1.1);               // the main ribbon, down the middle of the gully (plane length)
  sheet(1.4, L * 0.8, 2.6, 0.85, 0.9);          // a second strand to the right
  sheet(0.7, L * 0.92, -4.2, 0.75, 1.3);        // a fine thread on the left
  sheet(7.0, L * 0.95, 0, 0.18, 0.5);           // a faint veil of spray over the whole face

  // Spray at the foot: puffs that swell, fade and drift up.
  const pt = puffTexture();
  const puffs = [];
  for (let i = 0; i < 7; i++) {
    const s = new T.Sprite(new T.SpriteMaterial({ map: pt, transparent: true, opacity: 0.6, depthWrite: false }));
    const x = (i - 3) * 1.4, z = 2 + (i % 3) * 0.9;
    s.position.set(x, ground(x, z) + 1.5, z);
    s.scale.setScalar(4 + (i % 2) * 1.5);
    s.userData.phase = i * 0.9;
    s.userData.y0 = s.position.y;
    group.add(s);
    puffs.push(s);
  }

  ctx.batch(group);

  return {
    update(dt, t) {
      for (const m of ribbons) {
        const tx = m.userData.tex;
        tx.offset.y = (tx.offset.y + dt * m.userData.speed) % 1;   // water runs down the face
      }
      for (const s of puffs) {
        const k = (t * 1.3 + s.userData.phase) % 3;
        s.material.opacity = 0.2 + 0.4 * Math.sin((k / 3) * Math.PI) ** 2;
        s.position.y = s.userData.y0 + 0.8 * (k / 3);
      }
    },
  };
}
