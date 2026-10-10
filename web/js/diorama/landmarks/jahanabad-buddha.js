// Jahanabad Buddha (Manglawar): a rock face with the seated Buddha in relief, in local metres (x right, -z front).
// Sourced: the Jahan-Abad-i relief is 700 x 500 cm (Wikipedia, "Buddhist rock carving in Manglawar"), its throne 120 x 390 cm,
// its relief 11 cm deep, facing north west. Everything else (the rock's shape, the folds, halo, deck) is estimated.
import * as THREE from "three";

const RELIEF = 0.11;          // raised depth of the carving (source: D 11 cm)
const ROCK_TOP = 10;          // estimated: the face rises 10 m above the foot
const LIFT = 1.0;             // estimated: the throne's base sits 1 m above the foot of the face

export default function build(ctx) {
  const { group, M } = ctx;
  const rockMat = ctx.mat(0x9a8266, { roughness: 1 });
  const reliefMat = ctx.mat(0xbca084, { roughness: 0.95 });

  // The rock: a block whose front face (z = 0) is the carved face, its back cut into the slope behind.
  const geo = new THREE.BoxGeometry(9, 10, 7, 10, 10, 8);
  geo.translate(0, 0, 3.5);
  const pos = geo.attributes.position;
  const top = ctx.ground(0, 0) + ROCK_TOP;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const t = (y + 5) / 10;
    const base = ctx.ground(x, z) - 0.8;                 // the block sinks into the slope
    let yy = base + t * (top - base);
    if (z > 0.01) {                                      // back, sides and top: broken, not a smooth block
      x += (ctx.hash(i, 7, 3) - 0.5) * 0.7;
      z += (ctx.hash(i, 7, 5) - 0.5) * 0.7;
      yy += (ctx.hash(i, 7, 9) - 0.5) * 0.5;
    }
    pos.setXYZ(i, x, yy, z);
  }
  geo.computeVertexNormals();
  const rock = new THREE.Mesh(geo, rockMat);
  rock.castShadow = rock.receiveShadow = true;
  group.add(rock);

  // The relief: flat shapes extruded 0.11 m out of the face (z from -0.11 to 0), standing on yb.
  const yb = ctx.ground(0, 0) + LIFT;
  const slab = (shape) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: RELIEF, bevelEnabled: false, curveSegments: 20 });
    g.translate(0, 0, -RELIEF);
    const m = new THREE.Mesh(g, reliefMat);
    m.position.set(0, yb, 0);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  };
  const poly = (pts) => {
    const s = new THREE.Shape();
    s.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) s.lineTo(x, y);
    return s;
  };
  const mirror = (pts) => pts.map(([x, y]) => [-x, y]);
  const ellipse = (cx, cy, rx, ry) => { const s = new THREE.Shape(); s.absellipse(cx, cy, rx, ry, 0, Math.PI * 2, false, 0); return s; };
  const ring = (cx, cy, rxo, ryo, rxi, ryi) => {
    const s = ellipse(cx, cy, rxo, ryo);
    const h = new THREE.Path(); h.absellipse(cx, cy, rxi, ryi, 0, Math.PI * 2, true, 0);
    s.holes.push(h);
    return s;
  };

  // Throne (asana): two base ledges and the lotus seat, 3.9 m wide, 1.2 m high.
  slab(poly([[-2.2, 0], [2.2, 0], [2.2, 0.2], [-2.2, 0.2]]));
  slab(poly([[-2.0, 0.2], [2.0, 0.2], [2.0, 0.4], [-2.0, 0.4]]));
  slab(poly([[-1.95, 0.4], [1.95, 0.4], [1.95, 0.7], [1.6, 1.2], [-1.6, 1.2], [-1.95, 0.7]]));
  // Crossed legs and robe folds over the lap (concentric folds, estimated).
  slab(ellipse(0, 2.0, 1.85, 0.75));
  slab(ring(0, 2.0, 1.6, 0.55, 1.5, 0.45));
  slab(ring(0, 2.0, 1.2, 0.36, 1.1, 0.27));
  // Torso draped in the robe, shoulders to waist.
  slab(poly([[-1.25, 5.3], [1.25, 5.3], [1.4, 4.2], [1.0, 2.9], [-1.0, 2.9], [-1.4, 4.2]]));
  // Arms: upper arm and forearm down to the hands in the lap (both sides).
  const arm = [[0.95, 5.1], [1.55, 4.3], [1.45, 3.2], [0.5, 2.6], [0.2, 2.95], [0.9, 3.4], [1.05, 4.3], [0.85, 4.9]];
  slab(poly(arm));
  slab(poly(mirror(arm)));
  slab(ellipse(0, 2.75, 0.5, 0.22));                    // hands resting, one over the other
  // Neck, head, the ushnisha (the bump on the crown) and the halo (estimated).
  slab(poly([[-0.3, 5.1], [0.3, 5.1], [0.3, 5.5], [-0.3, 5.5]]));
  slab(ellipse(0, 6.0, 0.62, 0.72));
  slab(ellipse(0, 6.85, 0.26, 0.22));
  slab(ring(0, 6.1, 1.3, 1.3, 1.12, 1.12));

  // A timber viewing deck in front of the face (about 3.6 x 1.5 m, estimated from the photos), and a few boulders.
  const deckY = ctx.ground(0, -1.45) - 0.15;
  ctx.box(group, 3.6, 0.4, 1.5, M.wood, 0, deckY, -1.45);
  ctx.rocks(ctx, 3, -4.5, -2.5, 2.2, 0.6, M.schist, 3);

  ctx.batch(group);
}
