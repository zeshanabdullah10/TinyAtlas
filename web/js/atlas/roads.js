// Road ribbons by class, the red dashed route overlay, and hero-scale buildings.
import * as THREE from "three";
import { buildRibbon, ribbonMaterial, PALETTE } from "./ribbon.js";

const CLASSES = {   // real width (m), pixel floor, dash period (m, 0 = solid)
  paved: { w: 9, px: 1.5, dash: 0 }, jeep: { w: 5, px: 1.0, dash: 0, opacity: 0.6, fade: [12000, 26000] }, track: { w: 2.5, px: 0.8, dash: 22, opacity: 0.35, maxD: 3000 },
  minor: { w: 2.2, px: 0.7, dash: 0, opacity: 0.3, maxD: 4000 }, path: { w: 2, px: 1.2, dash: 18, opacity: 0.4, maxD: 3000 },
};
const HERO = 2;
const lin = (hex) => new THREE.Color(hex);
const GREYS = [lin(0x9a958c), lin(0xa7a297), lin(0xb7b1a6), lin(0xa09a90)];           // flat concrete roofs
const ROOFS = [lin(0x8e3b2a), lin(0x3e7a78), lin(0x8c8c88), lin(0x5a4330)];       // rust, teal tin, grey tin, timber
const rnd = (n) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };

/** Unit-footprint (1 x 1, long side along x) house: walls to y=4 (and 2 below ground), gable or flat roof. aRoof = 1 on roof faces. */
function house(roof) {
  const P = [], R = [], I = [];
  const v = (x, y, z, r) => { P.push(x, y, z); R.push(r); return P.length / 3 - 1; };
  const w = 0.5, d = 0.5, h = 4;
  const a = [v(-w, -2, -d, 0), v(w, -2, -d, 0), v(w, -2, d, 0), v(-w, -2, d, 0)];
  const b = [v(-w, h, -d, 0), v(w, h, -d, 0), v(w, h, d, 0), v(-w, h, d, 0)];
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; I.push(a[i], a[j], b[j], a[i], b[j], b[i]); }
  if (roof === "gable") {
    const r1 = v(-w, h + 2.2, 0, 1), r2 = v(w, h + 2.2, 0, 1);
    const t = [v(-w, h, -d, 1), v(w, h, -d, 1), v(w, h, d, 1), v(-w, h, d, 1)];
    I.push(t[0], t[1], r2, t[0], r2, r1, t[3], r1, r2, t[3], r2, t[2]);
    I.push(b[0], r1, b[3], b[1], b[2], r2);                    // gable ends
  } else {
    const t = [v(-w, h + 0.5, -d, 1), v(w, h + 0.5, -d, 1), v(w, h + 0.5, d, 1), v(-w, h + 0.5, d, 1)];
    I.push(t[0], t[3], t[2], t[0], t[2], t[1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute("aRoof", new THREE.Float32BufferAttribute(R, 1));
  g.setIndex(I); g.computeVertexNormals();
  return g;
}

export class Roads {
  constructor(pack, scene) {
    this.pack = pack; this.group = new THREE.Group(); scene.add(this.group);
    this.roadGroup = new THREE.Group(); this.routeGroup = new THREE.Group(); this.houses = new THREE.Group();
    this.group.add(this.roadGroup, this.routeGroup, this.houses);
    this.mats = {};
    for (const [k, c] of Object.entries(CLASSES)) this.mats[k] = ribbonMaterial({ kind: "road", minPx: c.px, color: k === "track" ? [0.58, 0.5, 0.38] : k === "jeep" ? [0.70, 0.58, 0.42] : k === "minor" ? [0.62, 0.54, 0.42] : PALETTE[k], maxK: 3, legibD: 4500, dash: c.dash, fade: c.fade, opacity: c.opacity ?? 1, maxD: c.maxD ?? 1e9 });
    this.routeMat = ribbonMaterial({ kind: "road", minPx: 2.4, color: PALETTE.route, maxK: 3, legibD: 3000, dash: 40 });
    this.hmat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
    this.hmat.onBeforeCompile = (sh) => {            // instance colour = roof colour; walls are warm whitewash/tan with variation
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float aRoof; varying float vRoof;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvRoof = aRoof;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vRoof;").replace("#include <color_fragment>",
        "#include <color_fragment>\nvec3 wall = vec3(0.69, 0.59, 0.44) * (0.88 + 0.24 * fract(vColor.r * 57.3 + vColor.g * 31.1));\ndiffuseColor.rgb = mix(wall, vColor, vRoof);");
    };
    this.geo = { gable: house("gable"), flat: house("flat") };
    this.build();
  }

  build() {
    for (const g of [this.roadGroup, this.routeGroup, this.houses]) for (const m of [...g.children]) { g.remove(m); m.geometry.dispose?.(); if (m.dispose) m.dispose(); }
    const p = this.pack, v = p.vectors;
    for (const [k, c] of Object.entries(CLASSES)) {
      const items = (v.roads || []).filter((r) => (r.class || "track") === k).map((r) => ({ pts: r.pts, half: c.w / 2 }));
      if (!items.length) continue;
      const m = new THREE.Mesh(buildRibbon(p, items), this.mats[k]);
      m.renderOrder = 3 + (k === "paved" ? 1 : 0); this.roadGroup.add(m);
    }
    const pieces = (v.routes || []).flatMap((r) => (r.pieces || []).map((pts) => ({ pts, half: 4 })));
    if (pieces.length) { const m = new THREE.Mesh(buildRibbon(p, pieces), this.routeMat); m.renderOrder = 6; this.routeGroup.add(m); }
    // buildings at hero scale: footprint x3, height x3
    const B = v.buildings || [];
    for (const roof of ["gable", "flat"]) {
      const list = B.filter((b) => (b.roof || "gable") === roof);
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(this.geo[roof], this.hmat, list.length);
      const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), T = new THREE.Vector3();
      const col = new THREE.Color();
      list.forEach((b, i) => {
        const ang = (b.angle_deg * Math.PI) / 180, ca = Math.cos(ang), sa = Math.sin(ang);
        const area = b.w * (b.d ?? b.w * 0.7), hero = area > 600 ? 1 : HERO;           // big buildings are not enlarged
        const w = b.w * hero, d = (b.d ?? b.w * 0.7) * hero;
        Q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -ang);          // angle runs from +x toward +z; rotation about +y runs the other way
        let lo = 1e9;                                                  // sit on the lowest ground under the footprint
        for (const [u, v] of [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const lx = (u * w) / 2, lz = (v * d) / 2;
          lo = Math.min(lo, p.groundY(b.x + lx * ca - lz * sa, b.z + lx * sa + lz * ca));
        }
        M.compose(T.set(b.x, lo, b.z), Q, S.set(w, hero, d));
        im.setMatrixAt(i, M);
        const r = rnd(i * 3 + b.x);
        if (roof === "flat") col.copy(GREYS[Math.floor(r * 4) % 4]);                       // concrete greys
        else if (area < 150) col.copy(ROOFS[Math.floor(r * 4) % 4]);                       // rust / teal tin / grey tin / timber
        else col.copy(ROOFS[1 + (Math.floor(r * 3) % 3)]);                                 // big gables: no solid red
        col.multiplyScalar(0.92 + rnd(i + 9) * 0.16);
        im.setColorAt(i, col);
      });
      im.castShadow = true; im.receiveShadow = true;
      im.boundingSphere = new THREE.Sphere(new THREE.Vector3(p.W / 2, 2000, p.H / 2), Math.max(p.W, p.H));
      this.houses.add(im);
    }
    this.buildingCount = B.length;
    this.routeGroup.visible = this.routesOn ?? false;
  }

  rebuild() { this.build(); }
  setRoads(on) { this.roadGroup.visible = on; this.houses.visible = on; }
  setRoutes(on) { this.routesOn = on; this.routeGroup.visible = on; }
}
