// Lakes (triangulated rings at their level, shaded by a small shore-distance texture) and rivers (draped ribbons).
import * as THREE from "three";
import { shared, LIFT_GLSL } from "./material.js";
import { buildRibbon, ribbonMaterial, WATER_GLSL } from "./ribbon.js";

const DF = 48;

/** Shore distance texture (R8) for a polygon with holes: 0 at the shore, 255 at the deepest point. */
function shoreTexture(rings, box) {
  const segs = [];
  for (const r of rings) {
    const step = Math.max(1, Math.floor(r.length / 140));
    const q = r.filter((_, i) => i % step === 0);
    for (let i = 0; i < q.length; i++) segs.push([q[i], q[(i + 1) % q.length]]);
  }
  const data = new Uint8Array(DF * DF), dist = new Float32Array(DF * DF);
  let mx = 1e-6;
  for (let j = 0; j < DF; j++) for (let i = 0; i < DF; i++) {
    const x = box.x0 + ((i + 0.5) / DF) * box.w, z = box.z0 + ((j + 0.5) / DF) * box.h;
    let inside = false, best = 1e18;
    for (const [a, b] of segs) {
      if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
      const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
      const d = Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
      if (d < best) best = d;
    }
    const v = inside ? best : 0;
    dist[j * DF + i] = v; if (v > mx) mx = v;
  }
  for (let i = 0; i < data.length; i++) data[i] = Math.round(Math.min(1, dist[i] / Math.min(mx, 220)) * 255);
  const t = new THREE.DataTexture(data, DF, DF, THREE.RedFormat, THREE.UnsignedByteType);
  t.magFilter = t.minFilter = THREE.LinearFilter; t.flipY = false; t.needsUpdate = true;
  return t;
}

function lakeMaterial(tex, box) {
  const m = new THREE.ShaderMaterial({
    fog: true, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uDF: { value: tex }, uBox: { value: new THREE.Vector4(box.x0, box.z0, box.w, box.h) } }]),
    vertexShader: `varying vec3 vWP;
      #include <fog_pars_vertex>
      ${LIFT_GLSL}
      void main() {
        vWP = position; vec4 mvPosition = liftToward(modelViewMatrix * vec4(position, 1.0)); gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `uniform sampler2D uDF, uShadow; uniform vec4 uBox, uGridUV; varying vec3 vWP;
      #include <fog_pars_fragment>
      ${WATER_GLSL}
      void main() {
        float t = texture2D(uDF, (vWP.xz - uBox.xy) / uBox.zw).r;
        float lit = texture2D(uShadow, (vWP.xz * uGridUV.x + uGridUV.y) / uGridUV.zw).r;
        gl_FragColor = vec4(waterShade(pow(1.0 - t, 1.6), vWP, lit), 1.0);
        #include <fog_fragment>
      }`,
  });
  for (const k of ["uShadow", "uGridUV", "uSkyCol", "uSunCol", "uSunDir", "uTime"]) m.uniforms[k] = shared[k];
  return m;
}

export class Water {
  constructor(pack, scene) {
    this.pack = pack; this.group = new THREE.Group(); scene.add(this.group);
    this.lakes = []; this.rivers = [];
    this.riverMat = ribbonMaterial({ kind: "river", minPx: 1.8, maxK: 3, legibD: 5000 });
    this.streamMat = ribbonMaterial({ kind: "river", minPx: 1.0, maxK: 3, legibD: 5000 });
    this.build();
  }

  build() {
    for (const m of [...this.group.children]) { this.group.remove(m); m.geometry.dispose(); if (m.material.uniforms?.uDF) { m.material.uniforms.uDF.value.dispose(); m.material.dispose(); } }
    const p = this.pack, v = p.vectors;
    for (const lake of v.lakes || []) {
      const rings = lake.rings.filter((r) => r.length > 2);
      if (!rings.length) continue;
      const outer = rings[0].map(([x, z]) => new THREE.Vector2(x, z));
      const holes = rings.slice(1).map((r) => r.map(([x, z]) => new THREE.Vector2(x, z)));
      const tris = THREE.ShapeUtils.triangulateShape(outer, holes);
      const pts = [...outer, ...holes.flat()];
      const y = p.yOf(lake.level_m) + 0.5;
      const pos = new Float32Array(pts.length * 3);
      let x0 = 1e18, z0 = 1e18, x1 = -1e18, z1 = -1e18;
      pts.forEach((q, i) => { pos.set([q.x, y, q.y], i * 3); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.y); z1 = Math.max(z1, q.y); });
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setIndex(tris.flat());
      g.computeBoundingSphere();
      const box = { x0, z0, w: x1 - x0, h: z1 - z0 };
      const mesh = new THREE.Mesh(g, lakeMaterial(shoreTexture(rings, box), box));
      mesh.userData.lake = lake; mesh.renderOrder = 1;
      this.group.add(mesh); this.lakes.push(mesh);
    }
    const riv = (kind) => (v.rivers || []).filter((r) => (kind === "river" ? r.kind === "river" || (r.width_m ?? 0) >= 12 : r.kind !== "river" && (r.width_m ?? 0) < 12));
    for (const [kind, mat] of [["river", this.riverMat], ["stream", this.streamMat]]) {
      const items = riv(kind).map((r) => ({ pts: r.pts, half: Math.max(1.5, (r.width_m ?? 6) / 2) }));
      if (!items.length) continue;
      const mesh = new THREE.Mesh(buildRibbon(p, items), mat);
      mesh.renderOrder = 2; this.group.add(mesh); this.rivers.push(mesh);
    }
  }

  /** Exaggeration changed: lakes move, ribbons re-drape. */
  rebuild() { this.build(); }
}
