import * as THREE from "three";

// Restrained model palette: white walls, teal roofs, brass details. Terrain supplies the colour.
const C = { wall: 0xf4efe3, stone: 0xcbbfa8, rock: 0x8f8577, snow: 0xffffff, ice: 0xcfe6ee, roof: 0x1f5c52,
  brass: 0xc2953a, wood: 0x7a5a3a, water: 0x5b9ec9, leaf: 0x5f8a4e, leaf2: 0x487340, red: 0xd2452b };

const mats = new Map();
const mat = (c) => {
  if (!mats.has(c)) mats.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0, flatShading: true }));
  return mats.get(c);
};

/** Model of a landmark kind, origin at its base, about 5 units tall; scale by S (metres per unit). */
export function makeModel(kind, S) {
  const g = new THREE.Group();
  const add = (geo, color, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat(color)); m.position.set(x * S, y * S, z * S); g.add(m); return m; };
  const box = (w, h, d, c, x, y, z) => add(new THREE.BoxGeometry(w * S, h * S, d * S), c, x, y + h / 2, z);
  const cyl = (rt, rb, h, c, x, y, z, seg = 10) => add(new THREE.CylinderGeometry(rt * S, rb * S, h * S, seg), c, x, y + h / 2, z);
  const cone = (r, h, c, x, y, z, seg = 10) => add(new THREE.ConeGeometry(r * S, h * S, seg), c, x, y + h / 2, z);
  const sphere = (r, c, x, y, z) => add(new THREE.SphereGeometry(r * S, 12, 10), c, x, y, z);

  switch (kind) {
    case "fort":
      box(3.2, 1.5, 3.2, C.wall, 0, 0, 0);
      for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
        cyl(0.5, 0.6, 2.7, C.stone, x, 0, z); cone(0.7, 0.8, C.roof, x, 2.7, z);
      }
      box(1.5, 1.8, 1.5, C.stone, 0, 1.5, 0); cone(1.1, 0.9, C.roof, 0, 3.3, 0, 4).rotation.y = Math.PI / 4;
      cyl(0.04, 0.04, 1.6, C.wood, 0, 4.2, 0, 6); box(0.9, 0.5, 0.05, C.red, 0.45, 5.4, 0);
      break;
    case "temple":
      box(3.4, 0.5, 3.4, C.stone, 0, 0, 0); box(2.6, 1.1, 2.6, C.wall, 0, 0.5, 0);
      cone(2.2, 0.8, C.roof, 0, 1.6, 0, 4).rotation.y = Math.PI / 4;
      box(1.6, 0.9, 1.6, C.wall, 0, 2.3, 0); cone(1.35, 0.7, C.roof, 0, 3.2, 0, 4).rotation.y = Math.PI / 4;
      cyl(0.05, 0.08, 1.4, C.brass, 0, 3.9, 0, 6);
      break;
    case "peak": // a summit marker, not a second mountain: cairn, pole, pennant (the real peak stays visible)
      cone(1.1, 0.9, C.rock, 0, 0, 0, 6); cone(0.6, 0.6, C.stone, 0, 0.7, 0, 6);
      cyl(0.05, 0.05, 4.2, C.brass, 0, 1.0, 0, 6);
      { const flag = box(1.3, 0.75, 0.05, C.roof, 0.7, 4.0, 0); flag.rotation.z = -0.08; }
      sphere(0.12, C.brass, 0, 5.3, 0);
      break;
    case "glacier":
      cone(0.8, 2.2, C.ice, -0.6, 0, 0, 4); cone(0.7, 1.7, C.snow, 0.6, 0, 0.4, 4); cone(0.55, 1.4, C.ice, 0.1, 0, -0.8, 4);
      cyl(0.05, 0.05, 3.6, C.brass, 0.1, 0.4, 0.2, 6); box(1.1, 0.65, 0.05, C.roof, 0.65, 3.4, 0.2);
      break;
    case "lake":
      cyl(2.3, 2.3, 0.18, C.water, 0, 0, 0, 24);
      cyl(0.03, 0.03, 1.6, C.wood, 0, 0.2, 0, 5); add(new THREE.ConeGeometry(0.65 * S, 1.3 * S, 3), C.wall, 0.33, 1.1, 0).rotation.z = -0.1;
      box(1.1, 0.16, 0.36, C.wood, 0, 0.18, 0);
      break;
    case "waterfall":
      box(3, 3.4, 1.4, C.rock, 0, 0, -0.6); box(0.7, 3.1, 0.15, C.snow, 0, 0.1, 0.18);
      cyl(1.6, 1.6, 0.14, C.water, 0, 0, 1.4, 20);
      break;
    case "bridge":
      for (const x of [-2.2, 2.2]) { cyl(0.16, 0.22, 2.6, C.wood, x, 0, 0, 6); box(0.7, 0.14, 0.7, C.brass, x, 2.6, 0); }
      box(4.8, 0.14, 0.55, C.wood, 0, 0.5, 0);
      { const cable = new THREE.Mesh(new THREE.TorusGeometry(2.2 * S, 0.05 * S, 5, 24, Math.PI), mat(0x444444)); cable.rotation.z = Math.PI; cable.position.y = 2.65 * S; g.add(cable); }
      break;
    case "museum":
      box(3.4, 1.7, 2.2, C.wall, 0, 0, 0);
      for (const x of [-1.2, -0.4, 0.4, 1.2]) cyl(0.14, 0.14, 1.5, C.stone, x, 0, 1.25, 8);
      box(3.6, 0.2, 2.5, C.stone, 0, 1.7, 0.05);
      { // gable roof: a 3-sided prism, axis along z, apex up, flattened to a shallow pitch
        const roof = add(new THREE.CylinderGeometry(1.95 * S, 1.95 * S, 2.5 * S, 3), C.roof, 0, 2.28, 0.05);
        roof.rotation.x = -Math.PI / 2; roof.scale.z = 0.35;
      }
      break;
    case "tower":
      cyl(0.55, 0.9, 4, C.wall, 0, 0, 0, 12); cyl(0.9, 0.7, 0.35, C.stone, 0, 4, 0, 12);
      cone(0.8, 1.1, C.roof, 0, 4.35, 0, 12); sphere(0.14, C.brass, 0, 5.55, 0);
      break;
    case "ruins":
      box(3.6, 0.35, 2.4, C.stone, 0, 0, 0);
      [[-1.3, 1.9], [-0.5, 1.2], [0.4, 2.3], [1.3, 0.9]].forEach(([x, hh], i) => cyl(0.24, 0.28, hh, C.wall, x, 0.35, i % 2 ? 0.5 : -0.5, 8));
      box(1.6, 0.7, 0.3, C.stone, 0.2, 0.35, -1); box(0.3, 0.9, 1.2, C.stone, -1.6, 0.35, 0.4);
      break;
    case "monument":
      box(2, 0.5, 2, C.stone, 0, 0, 0); box(1.3, 0.4, 1.3, C.wall, 0, 0.5, 0);
      cone(0.6, 3.6, C.wall, 0, 0.9, 0, 4).rotation.y = Math.PI / 4;
      break;
    case "park":
      [[-1.3, -0.6, 1], [0.2, 0.9, 1.25], [1.4, -0.8, 0.9], [-0.4, -1.4, 0.8], [0.9, 0.2, 1.05]].forEach(([x, z, s], i) => {
        cyl(0.1 * s, 0.14 * s, 0.7 * s, C.wood, x, 0, z, 5); cone(0.7 * s, 1.6 * s, i % 2 ? C.leaf : C.leaf2, x, 0.6 * s, z, 7); cone(0.5 * s, 1.1 * s, i % 2 ? C.leaf : C.leaf2, x, 1.4 * s, z, 7);
      });
      break;
    case "town":
      [[-1.4, -0.8, 1.2], [0.1, -1, 1.5], [1.4, -0.5, 1.1], [-0.8, 0.9, 1.3], [0.7, 0.9, 1.6]].forEach(([x, z, hh]) => {
        box(0.95, hh, 0.95, C.wall, x, 0, z); cone(0.85, 0.6, C.roof, x, hh, z, 4).rotation.y = Math.PI / 4;
      });
      break;
    case "rail":
      box(3.4, 0.9, 1, C.roof, 0, 0.35, 0); box(3.5, 0.15, 1.1, C.wall, 0, 1.25, 0);
      box(0.9, 0.5, 0.05, C.wall, -0.8, 0.7, 0.51); box(0.9, 0.5, 0.05, C.wall, 0.8, 0.7, 0.51);
      for (const x of [-1.2, 0, 1.2]) cyl(0.22, 0.22, 1.2, C.stone, x, 0, 0, 10).rotation.x = Math.PI / 2;
      cyl(0.05, 0.05, 1.6, C.brass, 0, 1.4, 0, 5);
      break;
    default: { // pin
      add(new THREE.ConeGeometry(0.75 * S, 2.4 * S, 10), C.roof, 0, 1.2, 0).rotation.x = Math.PI;
      sphere(0.95, C.roof, 0, 3.05, 0); sphere(0.36, C.wall, 0, 3.05, 0.7);
    }
  }
  return g;
}

/** Flat ring drawn on the ground around the selected landmark. */
export function selectionRing(S) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.2 * S, 0.11 * S, 6, 48), new THREE.MeshBasicMaterial({ color: C.red }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.15 * S;
  return ring;
}
