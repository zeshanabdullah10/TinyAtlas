// Lakes (triangulated rings at their level, shaded by a small shore-distance texture) and rivers (draped ribbons).
import * as THREE from "three";
import { shared, LIFT_GLSL } from "./material.js";
import { buildRibbon, ribbonMaterial, WATER_GLSL } from "./ribbon.js";

/** Real along-channel gradient (dh/ds, signed, smoothed over ~±75 m) per ribbon vertex, from the draped heights. */
function addSlope(g, exag) {
  const P = g.attributes.position.array, A = g.attributes.aAlong.array, n = A.length, out = new Float32Array(n);
  let s0 = 0;
  for (let i = 0; i <= n; i += 2) {
    if (i === n || (i > 0 && A[i] < A[i - 2])) {                      // a feature ends: pairs s0..i-2
      for (let q = s0; q < i; q += 2) {
        let a = q, b = q;
        while (a > s0 && A[q] - A[a - 2] < 75) a -= 2;
        while (b < i - 2 && A[b + 2] - A[q] < 75) b += 2;
        const v = b > a ? (P[b * 3 + 1] - P[a * 3 + 1]) / exag / (A[b] - A[a]) : 0;
        out[q] = out[q + 1] = v;
      }
      s0 = i;
    }
  }
  g.setAttribute("aSlope", new THREE.BufferAttribute(out, 1));
  return g;
}

/** Cut river polylines where they run inside a lake (lesson 6: the ribbon was drawn over the lake surface). */
function clipToLakes(items, lakes) {
  const polys = lakes.map((l) => {
    let x0 = 1e18, z0 = 1e18, x1 = -1e18, z1 = -1e18;
    for (const [x, z] of l.rings[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    return { rings: l.rings, x0, z0, x1, z1 };
  });
  const inRing = (r, x, z) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
  const wet = (x, z) => polys.some((q) => x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1 && inRing(q.rings[0], x, z) && !q.rings.slice(1).some((h) => inRing(h, x, z)));
  const out = [];
  for (const it of items) {
    const near = polys.some((q) => it.pts.some(([x, z]) => x >= q.x0 - 500 && x <= q.x1 + 500 && z >= q.z0 - 500 && z <= q.z1 + 500));
    if (!near) { out.push(it); continue; }
    let run = [];
    for (let i = 0; i < it.pts.length; i++) {
      const a = it.pts[Math.max(0, i - 1)], b = it.pts[i], n = i ? Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 12) : 1;
      for (let k = 1; k <= n; k++) {
        const t = k / n, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
        if (wet(x, z)) { if (run.length > 1) out.push({ ...it, pts: run }); run = []; }
        else run.push([x, z]);
      }
    }
    if (run.length > 1) out.push({ ...it, pts: run });
  }
  return out;
}

/** White water on the river ribbon: streaks drifting downstream where the channel is steep. */
function whiteWater(m) {
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace("varying float vSide, vAlong, vD;", "varying float vSide, vAlong, vD; attribute float aSlope; varying float vSlope;")
      .replace("vSide = aSide;", "vSide = aSide; vSlope = aSlope;");
    s.fragmentShader = s.fragmentShader.replace("varying float vSide, vAlong, vD;", "varying float vSide, vAlong, vD; varying float vSlope;")
      .replace("gl_FragColor = vec4(col, 1.0);", `{
            float st = smoothstep(0.03, 0.10, abs(vSlope)), dir = vSlope < 0.0 ? 1.0 : -1.0;
            float u = vAlong - dir * uTime * 5.0, near = 1.0 - smoothstep(2500.0, 9000.0, vD);
            float n = noised(vec2(u / 9.0, vSide * 1.6 + 2.0)).x * 0.65 + noised(vec2(u / 3.5, vSide * 3.1 - 5.0)).x * 0.35;
            float mid = 1.0 - s * s * 0.6;
            float foam = st * mid * mix(0.35, smoothstep(0.5, 0.78, n), near);              // far: a pale rapid tint; near: moving streaks
            col += near * 0.035 * (n - 0.5);                                                // a faint flow ripple everywhere
            col = mix(col, vec3(0.84, 0.92, 0.92), clamp(foam, 0.0, 1.0) * 0.85);
          }
          gl_FragColor = vec4(col, 1.0);`);
  };
  m.customProgramCacheKey = () => "atlas-river-ww";
  return m;
}


/** Shore distance texture (R8) for a polygon with holes: 0 at the shore, 255 at DMAX metres (or the deepest point).
 *  About 12 m per texel (32-192 px) so the shore line stays sharp on big lakes. */
const DMAX = 220;
function shoreTexture(rings, box) {
  const DF = Math.max(32, Math.min(192, Math.round(Math.max(box.w, box.h) / 12)));
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
  const dm = Math.min(mx, DMAX);
  for (let i = 0; i < data.length; i++) data[i] = Math.round(Math.min(1, dist[i] / dm) * 255);
  const t = new THREE.DataTexture(data, DF, DF, THREE.RedFormat, THREE.UnsignedByteType);
  t.magFilter = t.minFilter = THREE.LinearFilter; t.flipY = false; t.needsUpdate = true;
  t.userData.dm = dm;
  return t;
}

function lakeMaterial(tex, box) {
  const m = new THREE.ShaderMaterial({
    fog: true, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uDF: { value: tex }, uDm: { value: tex.userData.dm }, uBox: { value: new THREE.Vector4(box.x0, box.z0, box.w, box.h) } }]),
    vertexShader: `varying vec3 vWP;
      #include <fog_pars_vertex>
      ${LIFT_GLSL}
      void main() {
        vWP = position; vec4 mvPosition = liftToward(modelViewMatrix * vec4(position, 1.0)); gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `uniform sampler2D uDF, uShadow; uniform vec4 uBox, uGridUV; uniform float uDm, uPx; varying vec3 vWP;
      #include <fog_pars_fragment>
      ${WATER_GLSL}
      void main() {
        float t = texture2D(uDF, (vWP.xz - uBox.xy) / uBox.zw).r, m = t * uDm;      // metres from the shore
        float lit = texture2D(uShadow, (vWP.xz * uGridUV.x + uGridUV.y) / uGridUV.zw).r;
        vec3 col = waterShade(pow(1.0 - t, 1.6), vWP, lit);
        float d = length(cameraPosition - vWP), px = d * uPx;                       // metres per pixel here
        col = mix(col, col * vec3(0.55, 0.78, 0.86), smoothstep(40.0, 180.0, m) * 0.6);   // deep water: darker, bluer
        float wet = 1.0 - smoothstep(0.0, max(14.0, 3.0 * px), m);                       // pale shallow shelf
        col = mix(col, vec3(0.30, 0.62, 0.60), wet * 0.55);
        float line = 1.0 - smoothstep(0.0, max(2.5, 1.3 * px), m);                       // a thin bright shore line, >= ~1 px
        col = mix(col, vec3(0.86, 0.90, 0.84) * (0.75 + 0.25 * lit), line * 0.8 * (1.0 - smoothstep(6000.0, 20000.0, d)));
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`,
  });
  for (const k of ["uShadow", "uGridUV", "uSkyCol", "uSunCol", "uSunDir", "uTime", "uPx"]) m.uniforms[k] = shared[k];
  return m;
}

export class Water {
  constructor(pack, scene) {
    this.pack = pack; this.group = new THREE.Group(); scene.add(this.group);
    this.lakes = []; this.rivers = [];
    this.riverMat = whiteWater(ribbonMaterial({ kind: "river", minPx: 1.8, maxK: 3, legibD: 5000 }));
    this.streamMat = whiteWater(ribbonMaterial({ kind: "river", minPx: 1.0, maxK: 3, legibD: 5000 }));
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
      const items = clipToLakes(riv(kind).map((r) => ({ pts: r.pts, half: Math.max(1.5, (r.width_m ?? 6) / 2) })), (v.lakes || []).filter((l) => l.rings?.[0]?.length > 2));
      if (!items.length) continue;
      const mesh = new THREE.Mesh(addSlope(buildRibbon(p, items), p.exag), mat);
      mesh.renderOrder = 2; this.group.add(mesh); this.rivers.push(mesh);
    }
  }

  /** Exaggeration changed: lakes move, ribbons re-drape. */
  rebuild() { this.build(); }
}
